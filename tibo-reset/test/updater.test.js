import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedFeed, refreshWatch, scoreChangedPosts, SNAPSHOT_KEY, STATUS_KEY } from '../site/server/updater.js';

const asOf = '2026-10-18T06:00:00.000Z';
const post = { id: '1', author: 'thsottiaux', text: 'Synthetic reset announcement', createdAt: asOf };
const entry = { post, category: 'indirect_hint', confidence: .7 };
const report = { username: 'thsottiaux', target: 'codex', source: 'x-official-api', asOf, deadline: '2026-10-19T06:00:00.000Z',
  status: 'estimated', score: 60, rawModelProbability: .6, postCount: 1, evidence: [entry] };
const seed = { ...report, signalScoringVersion: 3, evidence: [{ ...entry,
  signalProbability: .9, signalKind: 'announced', signalKindConfidence: .95 }] };

class Bucket {
  records = new Map(); sequence = 0;
  async get(key) { const record = this.records.get(key); return record ? { etag: record.etag,
    json: async () => JSON.parse(record.body) } : null; }
  async head(key) { return this.records.get(key) ?? null; }
  async put(key, body, options = {}) {
    const before = this.records.get(key), condition = options.onlyIf;
    if (condition?.etagDoesNotMatch === '*' && before || condition?.etagMatches && condition.etagMatches !== before?.etag) return null;
    const record = { body, etag: String(++this.sequence) }; this.records.set(key, record); return record;
  }
  async delete(key) { this.records.delete(key); }
}
const setup = (bucket, extra = {}) => ({ bucket, seed, env: { OPENAI_API_KEY: 'fake-key', X_BEARER_TOKEN: 'fake-bearer' },
  now: () => new Date(asOf), makeClient: async () => ({}),
  collectPosts: async () => ({ username: 'thsottiaux', source: 'x-official-api', collectedAt: asOf, posts: [post] }),
  forecast: async () => structuredClone(report), ...extra });

test('post cache reuses content across horizons but invalidates edits, context, metric and target changes', async () => {
  const score = async (r) => ({ ...r, evidence: r.evidence.map(e => ({ ...e, signalProbability: .8, signalKind: 'hint', signalKindConfidence: .85 })) });
  const cached = await scoreChangedPosts(report, seed, () => { throw Error('Unchanged post must not be rescored'); });
  assert.equal(cached.evidence[0].signalProbability, .9);
  assert.equal(cached.rawModelProbability, .6);
  for (const changed of [{ ...report, evidence: [{ ...entry, post: { ...post, text: 'Edited' } }] },
    { ...report, evidence: [{ ...entry, post: { ...post, parent: post } }] }, { ...report, target: 'api-credit' }]) {
    const result = await scoreChangedPosts(changed, seed, score);
    assert.equal(result.evidence[0].signalProbability, .8);
  }
  assert.equal((await scoreChangedPosts(report, { ...seed, signalScoringVersion: 1 }, score)).evidence[0].signalProbability, .8);
});

test('an old-only cache miss is scored without blocking a fresh corpus or reusing its forecast', async () => {
  const historical = { ...entry, post: { ...post, id: '2', createdAt: '2026-10-08T06:00:00.000Z' } };
  const current = { ...report, postCount: 2, evidence: [entry, historical] };
  let calls = 0;
  const options = { apiKey: 'fake-key', fetchFn: async (_, init) => {
    calls++;
    const request = JSON.parse(init.body);
    assert.deepEqual(request.questions.map(q => q.name), ['signal_2', 'kind_2']);
    return new Response(JSON.stringify({ answers: [
      { name: 'signal_2', type: 'predicate', probability: .8 },
      { name: 'kind_2', type: 'choice', choice: 'completed', confidence: .9 },
    ] }));
  } };
  const scored = await scoreChangedPosts(current, seed, undefined, options);
  assert.equal(calls, 1);
  assert.equal(scored.rescoredPostCount, 1);
  assert.deepEqual(scored.evidence.map(e => e.signalProbability), [.9, .8]);
  assert.equal(scored.rawModelProbability, report.rawModelProbability);
  const stale = await scoreChangedPosts({ ...current, status: 'stale_data' }, seed, undefined, options);
  assert.equal(calls, 1);
  assert.equal(stale.rescoredPostCount, 0);
  assert.equal(stale.evidence[1].signalProbability, null);
});

test('an own follow-up invalidates the original meme score and is present when only changed posts are scored', async () => {
  const followUp = {...entry,post:{...post,id:'2',text:'Landing in two hours',replyToId:'1'}};
  const current = {...report,postCount:2,evidence:[entry,followUp]};
  let scoredIds, contextIds;
  await scoreChangedPosts(current, seed, async (input,options) => {
    scoredIds=input.evidence.map(entry=>entry.post.id);contextIds=options.contextPosts.map(post=>post.id);
    return {...input,evidence:input.evidence.map(entry=>({...entry,signalProbability:.95}))};
  });
  assert.deepEqual(scoredIds,['1','2']);assert.ok(contextIds.includes('2'));
});

test('successful cloud run persists readable snapshot and real history with no credential fields', async () => {
  const bucket = new Bucket();
  const result = await refreshWatch(setup(bucket));
  assert.equal(result.httpStatus, 200);
  const saved = await (await bucket.get(SNAPSHOT_KEY)).json();
  assert.equal(saved.asOf, asOf);
  assert.equal(saved.evidence[0].signalProbability, .9);
  assert.equal(saved.forecastHistory.length, 1);
  assert.equal((await (await bucket.get(STATUS_KEY)).json()).lastSuccessAt, asOf);
  assert.ok(!JSON.stringify(saved).includes('fake-'));
});

test('failed forecast leaves last good snapshot intact and releases lease for a later run', async () => {
  const bucket = new Bucket(); await bucket.put(SNAPSHOT_KEY, JSON.stringify(seed));
  const failed = await refreshWatch(setup(bucket, { forecast: async () => { throw Error('Decisions API failed (HTTP 429). secret must not escape'); } }));
  assert.equal(failed.errorCode, 'openai_rate_limit');
  assert.equal(failed.httpStatus, 503);
  assert.deepEqual(await (await bucket.get(SNAPSHOT_KEY)).json(), seed);
  assert.ok(!JSON.stringify(await (await bucket.get(STATUS_KEY)).json()).includes('secret'));
  assert.equal((await refreshWatch(setup(bucket, {now:()=>new Date('2026-10-18T07:00:00Z')}))).httpStatus, 200);
});

test('concurrent update is rejected before making duplicate upstream requests', async () => {
  const bucket = new Bucket(); let proceed; const gate = new Promise(resolve => { proceed = resolve; });
  let started; const waiting = new Promise(resolve => { started = resolve; });
  const run = refreshWatch(setup(bucket, { makeClient: async () => { started(); await gate; return {}; } }));
  await waiting;
  const second = await refreshWatch(setup(bucket, { makeClient: () => { throw Error('Must not call X'); } }));
  assert.equal(second.httpStatus, 409);
  proceed(); assert.equal((await run).httpStatus, 200);
});

test('duplicate public refreshes reuse the hourly result without repeating paid requests', async () => {
  const bucket = new Bucket(); let calls = 0;
  const options = setup(bucket, {makeClient:async()=>{calls++;return {};}});
  assert.equal((await refreshWatch(options)).status, 'updated');
  assert.equal((await refreshWatch(options)).status, 'current');
  assert.equal(calls, 1);
  assert.equal((await refreshWatch({...options,now:()=>new Date('2026-10-18T07:00:00Z')})).status, 'updated');
  assert.equal(calls, 2);
});

test('unconfigured cloud does not call upstream and preserves saved data', async () => {
  const bucket = new Bucket(); await bucket.put(SNAPSHOT_KEY, JSON.stringify(seed));
  const result = await refreshWatch(setup(bucket, { env: {}, makeClient: () => { throw Error('Must not call X'); } }));
  assert.equal(result.errorCode, 'openai_config');
  assert.deepEqual(await (await bucket.get(SNAPSHOT_KEY)).json(), seed);
});

test('migration hides legacy post copies and starts a new history from official data', async () => {
  const legacy = { ...seed, source: 'x-internal-api', forecastHistory: [{asOf:'2026-10-17T06:00:00Z',deadline:asOf,status:'estimated',probability:.9}] };
  const empty = { ...seed, source: 'import', evidence: [], postCount: 0 };
  const feed = publishedFeed(legacy, { state: 'ready' }, empty);
  assert.equal(feed.evidence.length, 0); assert.equal(feed.rawModelProbability, null);
  assert.equal(feed.operation.state, 'setup_required'); assert.equal(feed.forecastHistory.length, 0);
  const bucket = new Bucket(); await bucket.put(SNAPSHOT_KEY, JSON.stringify(legacy));
  const scored = async r => ({ ...r, evidence: r.evidence.map(e => ({...e,signalProbability:.7,signalKind:'hint',signalKindConfidence:.8})) });
  assert.equal((await refreshWatch(setup(bucket, {score:scored}))).httpStatus, 200);
  const current = await (await bucket.get(SNAPSHOT_KEY)).json();
  assert.equal(current.source, 'x-official-api'); assert.equal(current.forecastHistory.length, 1);
  assert.equal(current.evidence[0].signalProbability, .7);
});

test('official API billing failures preserve the last good feed and do not call Decisions', async () => {
  const bucket = new Bucket(); await bucket.put(SNAPSHOT_KEY, JSON.stringify(seed));
  const failure = Object.assign(new Error('X API credit balance (HTTP 402).'), { code: 'x_credits' });
  const result = await refreshWatch(setup(bucket, {collectPosts:async()=>{throw failure;},forecast:()=>{throw Error('Must not forecast');}}));
  assert.equal(result.errorCode, 'x_credits');
  assert.deepEqual(await (await bucket.get(SNAPSHOT_KEY)).json(), seed);
});

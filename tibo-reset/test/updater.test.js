import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshWatch, scoreChangedPosts, SNAPSHOT_KEY, STATUS_KEY } from '../site/server/updater.js';

const asOf = '2026-10-18T06:00:00.000Z';
const post = { id: '1', author: 'thsottiaux', text: 'Synthetic reset announcement', createdAt: asOf };
const entry = { post, category: 'indirect_hint', confidence: .7 };
const report = { username: 'thsottiaux', target: 'codex', asOf, deadline: '2026-10-19T06:00:00.000Z',
  status: 'estimated', score: 60, rawModelProbability: .6, postCount: 1, evidence: [entry] };
const seed = { ...report, signalScoringVersion: 2, evidence: [{ ...entry,
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
const setup = (bucket, extra = {}) => ({ bucket, seed, env: { OPENAI_API_KEY: 'fake-key', X_AUTH_TOKEN: 'fake-cookie', X_CT0: 'fake-csrf' },
  now: () => new Date(asOf), makeClient: async () => ({}),
  collectPosts: async () => ({ username: 'thsottiaux', source: 'x-internal-api', collectedAt: asOf, posts: [post] }),
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
  assert.equal((await refreshWatch(setup(bucket))).httpStatus, 200);
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

test('unconfigured cloud does not call upstream and preserves saved data', async () => {
  const bucket = new Bucket(); await bucket.put(SNAPSHOT_KEY, JSON.stringify(seed));
  const result = await refreshWatch(setup(bucket, { env: {}, makeClient: () => { throw Error('Must not call X'); } }));
  assert.equal(result.errorCode, 'openai_config');
  assert.deepEqual(await (await bucket.get(SNAPSHOT_KEY)).json(), seed);
});

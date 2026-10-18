import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSnapshot, selectEntries, viewStatus } from '../site/public/model.js';
import { enrichPostSignals } from '../src/decisions.js';

const asOf = '2026-10-18T06:00:00.000Z';
const report = () => ({ username: 'demo_account', target: 'codex', asOf,
  deadline: '2026-10-19T06:00:00.000Z', status: 'insufficient_evidence', score: null,
  source: 'x-internal-api', rawModelProbability: 0.09, evidenceSufficiency: 0,
  postCount: 2, requestedCount: 2,
  evidence: [
    { post: { id: '1', author: 'demo_account', text: 'Synthetic announcement', createdAt: '2026-10-18T05:00:00Z',
      url: 'javascript:alert(1)', parent: { id: '3', author: 'reader', text: 'Synthetic parent context', createdAt: '2026-10-18T04:00:00Z' } },
      category: 'indirect_hint', confidence: 0.75, signalProbability: 0.8 },
    { post: { id: '2', author: 'demo_account', text: 'Synthetic historical reset', createdAt: '2026-10-18T05:30:00Z' },
      category: 'already_reset', confidence: 0.98, signalProbability: 0.01 },
  ],
});

test('Site export allowlists public fields, rebuilds URLs, separates metrics and retains context', () => {
  const data = publicSnapshot({ ...report(), OPENAI_API_KEY: 'fake-private-key', X_AUTH_TOKEN: 'fake-cookie',
    unrelated: { password: 'not-for-export' } });
  const json = JSON.stringify(data);
  assert.ok(!json.includes('fake-private-key') && !json.includes('fake-cookie') && !json.includes('password'));
  assert.equal(data.evidence[0].post.url, 'https://x.com/demo_account/status/1');
  assert.equal(data.evidence[0].signalProbability, 0.8);
  assert.equal(data.evidence[0].confidence, 0.75);
  assert.equal(data.rawModelProbability, 0.09);
  assert.equal(data.score, null);
  assert.equal(data.evidence[0].post.parent.text, 'Synthetic parent context');
});

test('export roundtrip preserves null scores and does not treat zero as missing', () => {
  const data = report(); data.evidence[0].signalProbability = 0;
  const first = publicSnapshot(data);
  assert.equal(publicSnapshot(first).evidence[0].signalProbability, 0);
  assert.equal(publicSnapshot(first).rawModelProbability, 0.09);
  assert.equal(publicSnapshot(first).score, null);
});

test('dashboard filters probability, historical category and parent text independently', () => {
  const entries = publicSnapshot(report()).evidence;
  assert.deepEqual(selectEntries(entries, { filter: 'signal' }).map((e) => e.post.id), ['1']);
  assert.deepEqual(selectEntries(entries, { filter: 'already_reset' }).map((e) => e.post.id), ['2']);
  assert.deepEqual(selectEntries(entries, { search: 'parent context' }).map((e) => e.post.id), ['1']);
  assert.deepEqual(selectEntries(entries, { sort: 'newest' }).map((e) => e.post.id), ['2', '1']);
});

test('v2 content categories stay distinct from the forecast-window classification', () => {
  const data = report(); data.signalScoringVersion = 2;
  data.signalMetric = 'probability_post_announces_or_reports_reset';
  Object.assign(data.evidence[0], { category: 'irrelevant', signalKind: 'completed',
    signalKindConfidence: 0.96, signalProbability: 0.99 });
  Object.assign(data.evidence[1], { category: 'already_reset', signalKind: 'discussion', signalProbability: 0.01 });
  const snapshot = publicSnapshot(data);
  assert.equal(snapshot.signalScoringVersion, 2);
  assert.equal(snapshot.evidence[0].signalKindConfidence, 0.96);
  assert.deepEqual(selectEntries(snapshot.evidence, { filter: 'already_reset' }).map((entry) => entry.post.id), ['1']);
  assert.equal(snapshot.rawModelProbability, 0.09);
});

test('stored forecasts expire and stale source data never appears current', () => {
  const data = publicSnapshot(report());
  assert.equal(viewStatus(data, Date.parse(asOf)), 'insufficient_evidence');
  assert.equal(viewStatus(data, Date.parse('2026-10-20T00:00:00Z')), 'expired');
  data.newestPostAt = '2025-11-19T23:45:08Z';
  assert.equal(viewStatus(data, Date.parse(asOf)), 'stale_data');
});

test('invalid imports cannot inject URL schemes or probabilities outside 0–1', () => {
  const data = report(); data.evidence[0].signalProbability = 7;
  assert.equal(publicSnapshot(data).evidence[0].signalProbability, null);
  data.evidence[0].post.author = '<script>';
  assert.throws(() => publicSnapshot(data), /形式/);
  assert.throws(() => publicSnapshot({ input: 'request rather than report' }), /レポート/);
});

test('post signal scoring is a predicate separate from global forecast and classification confidence', async () => {
  const data = report();
  const enriched = await enrichPostSignals(data, { apiKey: 'fake-key', fetchFn: async (_, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.questions.length, 4);
    assert.equal(request.questions[0].type, 'predicate');
    assert.match(request.questions[0].instructions, /NOT the probability the future event will occur/);
    assert.match(request.questions[0].instructions, /does not depend on the forecast interval/);
    assert.match(request.questions[0].instructions, /completed reset qualifies/);
    return new Response(JSON.stringify({ answers: [
      { name: 'signal_1', type: 'predicate', probability: 0.62 },
      { name: 'kind_1', type: 'choice', choice: 'completed', confidence: 0.9 },
      { name: 'signal_2', type: 'refusal' },
      { name: 'kind_2', type: 'choice', choice: 'unrelated', confidence: 0.95 },
    ] }));
  } });
  assert.equal(enriched.rawModelProbability, 0.09);
  assert.equal(enriched.evidence[0].confidence, 0.75);
  assert.equal(enriched.evidence[0].signalProbability, 0.62);
  assert.equal(enriched.evidence[0].signalKind, 'completed');
  assert.equal(enriched.signalScoringVersion, 2);
  assert.equal(enriched.evidence[1].signalProbability, null);
});

test('large signal batches stay within the Decisions 200-question limit', async () => {
  const data = report();
  data.evidence = Array.from({ length: 190 }, (_, index) => ({ ...data.evidence[0],
    post: { ...data.evidence[0].post, id: String(index + 1) } }));
  data.postCount = 190;
  const counts = [];
  const enriched = await enrichPostSignals(data, { apiKey: 'fake', fetchFn: async (_, init) => {
    const request = JSON.parse(init.body); counts.push(request.questions.length);
    const answers = request.questions.map((q) => q.type === 'predicate'
      ? { name: q.name, type: 'predicate', probability: 0.95 }
      : { name: q.name, type: 'choice', choice: 'announced', confidence: 0.9 });
    return new Response(JSON.stringify({ answers }));
  } });
  assert.deepEqual(counts, [200, 180]);
  assert.equal(enriched.evidence.length, 190);
});

test('incomplete per-post scores fail rather than silently reusing classification confidence', async () => {
  await assert.rejects(enrichPostSignals(report(), { apiKey: 'fake-key', fetchFn: async () =>
    new Response(JSON.stringify({ answers: [{ name: 'signal_1', type: 'predicate', probability: 0.5 }] })) }), /Incomplete/);
});

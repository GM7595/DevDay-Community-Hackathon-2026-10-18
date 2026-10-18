import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, buildRequest, prepare, summarize } from '../src/decisions.js';

const asOf = '2026-10-18T06:00:00.000Z';
const post = (id = '1', extra = {}) => ({ id, author: 'demo_account',
  text: '[SYNTHETIC] We will reset Codex limits later today.',
  createdAt: '2026-10-18T05:00:00.000Z', ...extra });
const corpus = (posts) => ({ username: 'demo_account', source: 'synthetic', posts });
const snapshot = () => prepare(corpus([post()]), { asOf, count: 1 });
const response = (extra = []) => ({ model: 'gpt-6-luna', answers: [
  { type: 'predicate', name: 'reset_in_window', probability: 0.82 },
  { type: 'predicate', name: 'sufficient_evidence', probability: 0.91 },
  { type: 'choice', name: 'post_1', choice: 'future_announcement', confidence: 0.95 },
  ...extra,
] });

test('prepare excludes later posts, foreign authors and reposts, deduplicates and sorts', () => {
  const data = corpus([post('1'), post('1'), post('2', { createdAt: '2026-10-18T05:30:00Z' }),
    post('3', { createdAt: '2026-10-18T07:00:00Z' }), post('4', { author: 'someone_else' }),
    post('5', { isRepost: true })]);
  const result = prepare(data, { asOf, count: 100 });
  assert.deepEqual(result.posts.map((p) => p.id), ['2', '1']);
  assert.equal(result.deadline, '2026-10-19T06:00:00.000Z');
  assert.ok(result.warnings.some((s) => s.includes('2/100')));
});

test('filters later parent/quote context and warns about retrospective collection', () => {
  const result = prepare({ ...corpus([post('1', { replyToId: '2',
    parent: post('2', { createdAt: '2026-10-18T07:00:00Z' }),
    quoted: post('3', { createdAt: '2026-10-18T08:00:00Z' }) })]),
    collectedAt: '2026-10-19T00:00:00Z' }, { asOf });
  assert.equal(result.posts[0].parent, null);
  assert.equal(result.posts[0].quoted, null);
  assert.ok(result.warnings.some((s) => s.includes('not a valid backtest')));
  assert.ok(result.warnings.some((s) => s.includes('lack parent')));
});

test('rejects missing timestamps, invalid IDs, empty evidence and unbounded questions', () => {
  assert.throws(() => prepare(corpus([post('1', { createdAt: undefined })]), { asOf }), /date/);
  assert.throws(() => prepare(corpus([post('not-an-id')]), { asOf }), /Invalid post/);
  assert.throws(() => prepare(corpus([]), { asOf }), /No eligible/);
  assert.throws(() => prepare(corpus([post()]), { asOf, count: 191 }), /Count/);
  assert.throws(() => prepare(corpus([post()]), { asOf, hours: 0 }), /Hours/);
});

test('request uses Decisions predicates plus per-post choice within the 200 question limit', () => {
  const data = prepare(corpus(Array.from({ length: 190 }, (_, i) => post(String(i + 1)))), { asOf, count: 190 });
  const request = buildRequest(data);
  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(request.questions.length, 192);
  assert.equal(request.questions[0].type, 'predicate');
  assert.equal(request.questions[2].type, 'choice');
  assert.match(request.questions[0].instructions, /untrusted evidence/);
  assert.match(request.questions[0].instructions, /already occurred/);
  assert.match(request.questions[0].instructions, /2026-10-19T06:00:00.000Z/);
});

test('target separates API monetary credits from Codex limits', () => {
  const data = prepare(corpus([post()]), { asOf, target: 'api-credit' });
  assert.match(buildRequest(data).questions[0].instructions, /monetary API credits/);
});

test('reports an uncalibrated estimate with verifiable source IDs', () => {
  const result = summarize(snapshot(), response());
  assert.equal(result.score, 82);
  assert.equal(result.calibrated, false);
  assert.equal(result.status, 'estimated');
  assert.equal(result.evidence[0].post.url, 'https://x.com/demo_account/status/1');
});

test('insufficient evidence is unknown, not zero or a manufactured 50%', () => {
  const body = response();
  body.answers[1].probability = 0.1;
  const result = summarize(snapshot(), body);
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.score, null);
  assert.equal(result.rawModelProbability, 0.82);
});

test('historical reset alone cannot produce a displayed future forecast', () => {
  const body = response();
  body.answers[2].choice = 'already_reset';
  assert.equal(summarize(snapshot(), body).score, null);
});

test('stale public data is withheld before any paid API request, even without a key', async () => {
  const old = prepare(corpus([post('1', { createdAt: '2025-11-19T23:45:08Z' })]), { asOf });
  const result = await analyze(old, { apiKey: '', fetchFn: async () => {
    assert.fail('Stale data must not be sent for a current forecast.');
  } });
  assert.equal(result.status, 'stale_data');
  assert.equal(result.score, null);
  assert.equal(result.model, null);
  assert.equal(result.usage, null);
  assert.equal(result.rawModelProbability, null);
});

test('refusal is distinct from a negative prediction', () => {
  const body = response();
  body.answers[0] = { name: 'reset_in_window', type: 'refusal' };
  const result = summarize(snapshot(), body);
  assert.equal(result.status, 'refused');
  assert.equal(result.score, null);
  assert.equal(result.rawModelProbability, null);
});

test('fails closed for missing, duplicate, unknown and malformed API answers', () => {
  const missing = response(); missing.answers.pop();
  assert.throws(() => summarize(snapshot(), missing), /Incomplete/);
  assert.throws(() => summarize(snapshot(), response([{ ...response().answers[0] }])), /duplicate/);
  const invalid = response(); invalid.answers[0].probability = 5;
  assert.throws(() => summarize(snapshot(), invalid), /Invalid predicate/);
  const unknown = response(); unknown.answers[2].choice = 'invented';
  assert.throws(() => summarize(snapshot(), unknown), /Invalid classification/);
});

test('HTTP adapter sends documented payload and handles response without an SDK', async () => {
  const result = await analyze(snapshot(), { apiKey: 'fake-test-key', fetchFn: async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/decisions');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, 'Bearer fake-test-key');
    const body = JSON.parse(init.body);
    assert.equal(body.questions[0].name, 'reset_in_window');
    assert.equal(JSON.parse(body.input).posts[0].id, '1');
    return new Response(JSON.stringify(response()));
  } });
  assert.equal(result.score, 82);
});

test('HTTP failures and missing keys do not fabricate a prediction or leak response bodies', async () => {
  await assert.rejects(analyze(snapshot(), { apiKey: '' }), /OPENAI_API_KEY/);
  await assert.rejects(analyze(snapshot(), { apiKey: 'fake',
    fetchFn: async () => new Response('secret-in-server-body', { status: 429 }) }),
  (error) => /429/.test(error.message) && !/secret/.test(error.message));
  await assert.rejects(analyze(snapshot(), { apiKey: 'fake',
    fetchFn: async () => new Response('not-json') }), /invalid JSON/);
  // Compatible with Workers and fail closed before credentials can follow a redirect.
  await assert.rejects(analyze(snapshot(), { apiKey: 'fake', fetchFn: async (_, init) => {
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://other.example/' } });
  } }), /HTTP 302/);
});

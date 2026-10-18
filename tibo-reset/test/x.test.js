import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/common.js';
import { collect, createXClient, normalize, xFetch } from '../src/x.js';

const entry = (id, extra = {}) => ({
  tweet: { restId: String(id), legacy: { fullText: '[SYNTHETIC] A test post',
    createdAt: `2026-10-18T0${id}:00:00Z`, userIdStr: '100', conversationIdStr: String(id) } },
  user: { restId: '100', core: { screenName: 'demo_account' } },
  replies: [], ...extra,
});
const page = (entries, cursor) => ({ data: { data: entries,
  cursor: cursor ? { bottom: { value: cursor } } : {} } });
function mockClient(pages, details = {}) {
  const calls = [];
  const api = {
    getUserTweetsAndReplies: async (params) => { calls.push(params); return pages.shift(); },
    getTweetDetail: async ({ focalTweetId }) => {
      const detail = details[focalTweetId];
      if (detail instanceof Error) throw detail;
      return page(detail ?? []);
    },
  };
  return { calls,
    getUserApi: () => ({ getUserByScreenName: async () => ({ data: { user: { restId: '100' } } }) }),
    getTweetApi: () => api,
  };
}

test('normalizes camelCase SDK objects, expanded note text and quote authorship', () => {
  const data = entry(1);
  data.tweet.noteTweet = { noteTweetResults: { result: { text: 'Full long text' } } };
  data.quoted = entry(2, { user: { restId: '200', legacy: { screenName: 'other_author' } } });
  const result = normalize(data);
  assert.equal(result.text, 'Full long text');
  assert.equal(result.quoted.author, 'other_author');
  assert.equal(result.createdAt, '2026-10-18T01:00:00.000Z');
  assert.equal(normalize({ ...data, promotedMetadata: {} }), null);
});

test('paginates, deduplicates, retains own replies and avoids old pinned-post displacement', async () => {
  const foreign = entry(4, { user: { restId: '200', core: { screenName: 'other_author' } } });
  const client = mockClient([
    page([entry(1), entry(3, { replies: [entry(2), foreign] })], 'cursor-1'),
    page([entry(3), entry(5), entry(6, { retweeted: entry(4) })]),
  ]);
  const result = await collect({ client, username: 'demo_account', count: 3,
    wait: async () => {}, contextLimit: 0 });
  assert.deepEqual(result.posts.map((p) => p.id), ['5', '3', '2']);
  assert.equal(result.pages, 2);
  assert.equal(client.calls[1].cursor, 'cursor-1');
});

test('reply parent lookup attaches context without counting it as a target post', async () => {
  const reply = entry(2); reply.tweet.legacy.inReplyToStatusIdStr = '1';
  const parent = entry(1, { user: { restId: '200', core: { screenName: 'other_author' } } });
  const client = mockClient([page([reply])], { '1': [parent] });
  const result = await collect({ client, username: 'demo_account', count: 1, wait: async () => {} });
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].parent.author, 'other_author');
  assert.equal(result.contextRequests, 1);
});

test('records short timelines and missing context instead of inventing 100 posts', async () => {
  const reply = entry(2); reply.tweet.legacy.inReplyToStatusIdStr = '1';
  const result = await collect({ client: mockClient([page([reply])]),
    username: 'demo_account', count: 100, contextLimit: 0, wait: async () => {} });
  assert.ok(result.warnings.some((s) => s.includes('obtained 1')));
  assert.ok(result.warnings.some((s) => s.includes('reply parents missing')));
  assert.equal(result.posts[0].parent, null);
});

test('repeated pagination cursor terminates collection', async () => {
  const result = await collect({ client: mockClient([
    page([entry(1)], 'same'), page([entry(1)], 'same')]),
  username: 'demo_account', count: 100, wait: async () => {} });
  assert.equal(result.pages, 2);
  assert.equal(result.stopReason, 'repeated_cursor');
});

test('rate limit stops context collection and authentication errors are actionable', async () => {
  const reply = entry(2); reply.tweet.legacy.inReplyToStatusIdStr = '1';
  await assert.rejects(collect({ client: mockClient([page([reply])], { '1': new AppError('HTTP 429') }),
    username: 'demo_account', count: 1, wait: async () => {} }), /429/);
  await assert.rejects(createXClient({ env: {} }), /X_AUTH_TOKEN/);
});

test('allows the guest bootstrap manual 307 redirect and stops on 429', async () => {
  const redirect = await xFetch('https://x.com/home', { redirect: 'manual' },
    async () => new Response(null, { status: 307 }));
  assert.equal(redirect.status, 307);
  await assert.rejects(xFetch('https://x.com/i/api/graphql/example', {},
    async () => new Response(null, { status: 429 })), /429/);
});

test('stops trying additional reply parents after an authentication rejection', async () => {
  const first = entry(2); first.tweet.legacy.inReplyToStatusIdStr = '1';
  const second = entry(4); second.tweet.legacy.inReplyToStatusIdStr = '3';
  const result = await collect({ client: mockClient([page([first, second])],
    { '3': new AppError('HTTP 401'), '1': new Error('Should not request another parent') }),
  username: 'demo_account', count: 2, wait: async () => {} });
  assert.equal(result.contextRequests, 1);
  assert.ok(result.warnings.some((s) => s.includes('further detail requests stopped')));
});

test('does not send session credentials to public metadata hosts or unknown hosts', async () => {
  const noFetch = async () => { assert.fail('A blocked request must never be sent.'); };
  await assert.rejects(xFetch('https://raw.githubusercontent.com/fa0311/example',
    { headers: { cookie: 'fake-test-cookie' } }, noFetch), /outside X/);
  await assert.rejects(xFetch('https://untrusted.example/', {}, noFetch), /Unexpected host/);
});

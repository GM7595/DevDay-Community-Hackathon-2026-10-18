import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMedia, mediaUrl, visualInput } from '../src/media.js';
import { enrichPostSignals } from '../src/decisions.js';

const asOf = '2026-10-18T06:00:00.000Z';
const media = key => ({ key, type: 'photo', url: `https://pbs.twimg.com/media/${key}.jpg`, altText: 'Synthetic reset meme' });
const post = (id, extra = {}) => ({ id, author: 'demo_account', text: 'Synthetic short meme caption', createdAt: asOf, ...extra });
const snapshot = posts => ({ username: 'demo_account', target: 'codex', source: 'x-official-api', asOf,
  deadline: '2026-10-19T06:00:00.000Z', posts });
const image = () => new Response('synthetic-image-bytes', { headers: { 'content-type': 'image/jpeg' } });

test('image allowlist removes arbitrary hosts, schemes, credentials, paths, queries and base64 from exported media', () => {
  for (const url of ['http://pbs.twimg.com/media/demo.jpg', 'https://evil.example/media/demo.jpg',
    'https://pbs.twimg.com.evil.example/media/demo.jpg', 'https://secret@pbs.twimg.com/media/demo.jpg',
    'https://pbs.twimg.com/profile_images/demo.jpg', 'data:image/png;base64,private', 'https://pbs.twimg.com/media/a.svg'])
    assert.equal(mediaUrl(url), null);
  assert.equal(mediaUrl('https://pbs.twimg.com/media/demo?format=jpg&name=orig&secret=private'), 'https://pbs.twimg.com/media/demo?format=jpg');
  assert.deepEqual(cleanMedia([{ ...media('a'), OPENAI_API_KEY: 'must-not-export' }])[0], media('a'));
});

test('visual input attributes own, parent and quoted memes by post ID, inlines images and reuses a bounded cache', async () => {
  const data = snapshot([post('1', { media: [media('a')], parent: post('2', { media: [media('b')] }),
    quoted: post('3', { media: [media('a')] }) })]);
  let calls = 0; const imageCache = new Map();
  const fetchFn = async (url, init) => {
    calls++; assert.equal(new URL(url).hostname, 'pbs.twimg.com');
    assert.equal(init.headers.Authorization, undefined); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual');
    return image();
  };
  const first = await visualInput(data, { fetchFn, imageCache });
  assert.equal(first.analysis.imageCount, 2); assert.equal(first.analysis.missingImageCount, 0);
  assert.equal(first.input[0].role, 'user');
  assert.equal(first.input[0].content.filter(part => part.type === 'input_image').length, 2);
  assert.match(first.input[0].content[1].text, /1, 3/);
  assert.match(first.input[0].content[2].image_url, /^data:image\/jpeg;base64,/);
  await visualInput(data, { fetchFn, imageCache }); assert.equal(calls, 2);
});

test('unavailable or oversized images remain unknown and cannot exceed image/request limits', async () => {
  const data = snapshot([post('1', { media: [media('a'), media('b')] })]);
  const limited = await visualInput(data, { fetchFn: async () => image(), maxImages: 1 });
  assert.equal(limited.analysis.imageCount, 1); assert.deepEqual(limited.analysis.missingPostIds, ['1']);
  const oversized = await visualInput(data, { fetchFn: async () => image(), maxTotalBytes: 3 });
  assert.equal(oversized.analysis.imageCount, 0); assert.equal(oversized.analysis.missingImageCount, 2);
  const redirect = await visualInput(data, { fetchFn: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }) });
  assert.equal(redirect.analysis.imageCount, 0); assert.equal(typeof redirect.input, 'string');
});

test('failed image input withholds a per-post score instead of turning an unread meme into zero', async () => {
  const data = { ...snapshot(), postCount: 1, evidence: [{ post: post('1', { media: [media('a')] }), category: 'irrelevant' }] };
  let requests = 0;
  const result = await enrichPostSignals(data, { apiKey: 'fake-key', mediaFetchFn: async () => new Response(null, { status: 404 }),
    fetchFn: async () => { requests++; return new Response(JSON.stringify({ answers: [
      { type: 'predicate', name: 'signal_1', probability: 0 },
      { type: 'choice', name: 'kind_1', choice: 'unrelated', confidence: .99 },
    ] })); } });
  assert.equal(requests, 1); assert.equal(result.evidence[0].signalProbability, null);
  assert.equal(result.evidence[0].signalKind, null); assert.equal(result.evidence[0].signalStatus, 'image_unavailable');
});

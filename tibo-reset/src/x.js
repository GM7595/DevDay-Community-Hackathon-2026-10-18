import { AppError, handle, integer, iso, sleep } from './common.js';
import { cleanMedia } from './media.js';

const ORIGIN = 'https://api.x.com';
const FIELDS = {
  'post.fields': 'created_at,conversation_id,note_post,attachments',
  expansions: 'author_id,referenced_posts,username,attachments.media_keys',
  'user.fields': 'username,protected',
  'media.fields': 'media_key,type,url,preview_image_url,alt_text',
};
function fail(message, code, status = null) {
  const error = new AppError(message); error.code = code; error.status = status; return error;
}
function id(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw fail('Invalid X post or user ID.', 'x_response');
  return value;
}

// Only the three official, read-only v2 endpoints below can receive this token.
// No cookie authentication, guest mode, dynamic endpoint discovery or fallback.
export function createXClient({ env = process.env, fetchFn = fetch } = {}) {
  const token = env.X_BEARER_TOKEN?.trim();
  if (!token || /[\r\n]/.test(token)) throw fail('X_BEARER_TOKEN is required. Set the app-only Bearer Token from X Developer Console.', 'x_config');
  async function get(path, params = {}) {
    const url = new URL(path, ORIGIN);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchFn(url.href, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    } catch { throw fail('X API network request failed or timed out.', 'x_network'); }
    if (!response.ok) {
      const status = response.status;
      const errors = {
        401: ['X API authentication failed (HTTP 401). Check X_BEARER_TOKEN.', 'x_auth'],
        402: ['X API billing or credit balance prevents access (HTTP 402). Check X Developer Console.', 'x_credits'],
        403: ['X API access denied (HTTP 403). Check the app\'s API access and read permissions.', 'x_access'],
        404: ['X API resource unavailable (HTTP 404).', 'x_not_found'],
        429: ['X API rate limit reached (HTTP 429). No automatic retry was made.', 'x_rate_limit'],
      };
      const [message, code] = errors[status] ?? [`X API request failed (HTTP ${status}).`, 'x_request'];
      const error = fail(message, code, status);
      const reset = Number(response.headers.get('x-rate-limit-reset'));
      if (status === 429 && Number.isSafeInteger(reset) && reset > 0 && reset < 10_000_000_000) error.retryAt = new Date(reset * 1000).toISOString();
      // Never expose upstream bodies, request headers or credentials.
      throw error;
    }
    let body;
    try { body = await response.json(); } catch { throw fail('X API returned invalid JSON.', 'x_response'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Unexpected X API response.', 'x_response');
    return body;
  }
  return {
    getUserByUsername: (username) => get(`/2/users/by/username/${handle(username)}`, { 'user.fields': 'protected' }),
    getUserPosts: (userId, { maxResults = 100, paginationToken } = {}) => get(`/2/users/${id(userId)}/tweets`, {
      ...FIELDS, exclude: 'retweets', max_results: integer(maxResults, 'maxResults', 5, 100), pagination_token: paginationToken,
    }),
    getPosts: (ids) => {
      if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw fail('X lookup requires 1–100 post IDs.', 'x_request');
      return get('/2/tweets', { ...FIELDS, ids: [...new Set(ids.map(id))].join(',') });
    },
  };
}

function ingest(body, tweets, users, media, warnings) {
  if (body.data !== undefined && !Array.isArray(body.data)) throw fail('Unexpected X post lookup response.', 'x_response');
  if (body.errors?.length) warnings.push(`X API reported ${body.errors.length} unavailable or partial resources.`);
  for (const user of body.includes?.users ?? []) if (user?.id) users.set(user.id, { ...users.get(user.id), ...user });
  for (const item of body.includes?.media ?? []) if (item?.media_key) media.set(item.media_key, item);
  // Expansion objects can omit fields. They must not replace a complete timeline
  // record with a partial copy when a context batch references that same post.
  for (const tweet of body.includes?.posts ?? body.includes?.tweets ?? []) if (tweet?.id) tweets.set(tweet.id, { ...tweet, ...tweets.get(tweet.id) });
  for (const tweet of body.data ?? []) if (tweet?.id) tweets.set(tweet.id, { ...tweets.get(tweet.id), ...tweet });
}

export function normalize(tweet, { tweets, users, media = new Map() }, depth = 0, seen = new Set()) {
  const user = users.get(tweet?.author_id) ?? (tweet?.username ? { username: tweet.username } : null);
  if (!tweet || !user || user.protected || !/^[a-zA-Z0-9_]{1,15}$/.test(user.username ?? '') ||
      !/^\d+$/.test(tweet.id ?? '') || !Number.isFinite(Date.parse(tweet.created_at)) || seen.has(tweet.id)) return null;
  const text = tweet.note_post?.text ?? tweet.note_tweet?.text ?? tweet.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  const references = tweet.referenced_posts ?? tweet.referenced_tweets ?? [];
  const replyToId = references.find((ref) => ref.type === 'replied_to')?.id ?? null;
  const quoteId = references.find((ref) => ref.type === 'quoted')?.id;
  const nextSeen = new Set([...seen, tweet.id]);
  const context = (postId) => depth < 2 && postId && tweets.has(postId) ? normalize(tweets.get(postId), { tweets, users, media }, depth + 1, nextSeen) : null;
  return { id: tweet.id, author: user.username, authorId: tweet.author_id, text,
    createdAt: iso(tweet.created_at, 'post date'), url: `https://x.com/${user.username}/status/${tweet.id}`,
    replyToId, conversationId: tweet.conversation_id ?? tweet.id, isRepost: references.some((ref) => ref.type === 'retweeted'),
    media: cleanMedia((tweet.attachments?.media_keys ?? []).map(key => {
      const item = media.get(key);
      return { key, type: item?.type, url: item?.type === 'photo' ? item.url : item?.preview_image_url, altText: item?.alt_text };
    })), parent: context(replyToId), quoted: context(quoteId) };
}

export async function collect({ client, username = 'thsottiaux', count = 100, contextLimit = 20,
  wait = sleep, now = () => new Date(), onProgress = () => {} }) {
  const screenName = handle(username);
  integer(count, 'count', 1, 190); integer(contextLimit, 'contextLimit', 0, 100);
  const userResponse = await client.getUserByUsername(screenName);
  const user = userResponse.data;
  if (!user?.id || !user.username || user.username.toLowerCase() !== screenName.toLowerCase()) throw fail('X user not found or unavailable.', 'x_not_found');
  if (user.protected) throw fail('Only public X accounts are supported.', 'x_access');
  const users = new Map([[user.id, user]]), tweets = new Map(), media = new Map(), ownIds = new Set(), cursors = new Set(), warnings = [];
  let paginationToken, pages = 0, eligibleCount = 0, stopReason = 'page_limit';
  while (pages < 20) {
    const result = await client.getUserPosts(user.id, { maxResults: Math.min(100, Math.max(5, count - eligibleCount)), paginationToken });
    pages++;
    if (!Array.isArray(result.data) && !(result.meta?.result_count === 0 && !result.errors?.length)) throw fail('Unexpected X timeline response.', 'x_response');
    ingest(result, tweets, users, media, warnings);
    for (const post of result.data ?? []) {
      if (post.author_id === user.id && !(post.referenced_posts ?? post.referenced_tweets ?? []).some((ref) => ref.type === 'retweeted')) ownIds.add(post.id);
    }
    eligibleCount = [...ownIds].filter(postId => normalize(tweets.get(postId), { tweets, users, media })).length;
    onProgress(`Collected ${eligibleCount} eligible authored posts (${pages} official API pages).`);
    if (eligibleCount >= count) { stopReason = 'requested_count'; break; }
    const next = result.meta?.next_token;
    if (!next || cursors.has(next)) { stopReason = next ? 'repeated_cursor' : 'end_of_timeline'; break; }
    cursors.add(next); paginationToken = next; await wait(1000);
  }
  // Expansions usually supply replies/quotes in the same response. Batch only missing
  // context, and cap additional *post IDs* (not HTTP requests) to control read usage.
  const orderedIds = [...ownIds].filter(postId => normalize(tweets.get(postId), { tweets, users, media }))
    .sort((a,b) => (tweets.get(b).created_at ?? '').localeCompare(tweets.get(a).created_at ?? '')).slice(0,count);
  const attempted = new Set(); let contextRequests = 0, contextPostCount = 0, frontier = orderedIds;
  for (let depth = 0; depth < 2 && contextPostCount < contextLimit; depth++) {
    const candidates = new Set(), nextFrontier = new Set();
    for (const postId of frontier) for (const ref of tweets.get(postId)?.referenced_posts ?? tweets.get(postId)?.referenced_tweets ?? []) {
      if (!['replied_to','quoted'].includes(ref.type) || attempted.has(ref.id)) continue;
      nextFrontier.add(ref.id);
      const saved = tweets.get(ref.id);
      if (!saved || !users.has(saved.author_id) || saved.attachments?.media_keys?.some(key => !media.has(key))) candidates.add(ref.id);
    }
    // Prioritize already-visible context with missing media over unrelated missing
    // replies, so a reset meme expansion gets its pixels within the same read cap.
    const ids = [...candidates].sort((a, b) => Number(!!tweets.get(b)?.attachments?.media_keys?.length) - Number(!!tweets.get(a)?.attachments?.media_keys?.length))
      .slice(0, contextLimit - contextPostCount);
    if (ids.length) {
      for (const postId of ids) attempted.add(postId);
      await wait(1000); contextRequests++; contextPostCount += ids.length;
      // Auth, billing, rate-limit and transport failures stop the update; no partial forecast.
      const response = await client.getPosts(ids);
      ingest(response, tweets, users, media, warnings);
    }
    frontier = [...nextFrontier].filter(postId => tweets.has(postId));
    if (!frontier.length) break;
  }
  const posts = orderedIds.map(postId => normalize(tweets.get(postId), { tweets, users, media })).filter(Boolean);
  if (!posts.length) throw fail('X API returned no eligible public authored posts.', 'x_empty');
  if (posts.length < count) warnings.push(`Requested ${count} posts, obtained ${posts.length} (${stopReason}).`);
  if (['page_limit','repeated_cursor'].includes(stopReason)) warnings.push(`Pagination stopped: ${stopReason}; coverage may be incomplete.`);
  const missing = posts.filter(post => post.replyToId && !post.parent).length;
  if (missing) warnings.push(`${missing} reply parents missing; additional context capped at ${contextLimit} post IDs.`);
  return { version: 1, source: 'x-official-api', username: screenName, collectedAt: iso(now()), requestedCount: count,
    pages, contextRequests, contextPostCount, stopReason, warnings, posts };
}

import { AppError, handle, iso, sleep } from './common.js';

export function flatten(entries) {
  return entries.flatMap((entry) => [entry, ...flatten(entry.replies ?? [])]);
}

export function normalize(entry, depth = 0) {
  if (!entry?.tweet || !entry?.user || entry.promotedMetadata) return null;
  const { tweet, user } = entry;
  const legacy = tweet.legacy ?? {};
  const author = user.core?.screenName ?? user.legacy?.screenName;
  const text = tweet.noteTweet?.noteTweetResults?.result?.text ?? legacy.fullText;
  if (!author || !text || !tweet.restId || !legacy.createdAt) return null;
  const post = {
    id: tweet.restId,
    author,
    authorId: user.restId,
    text,
    createdAt: iso(legacy.createdAt, 'post date'),
    url: `https://x.com/${author}/status/${tweet.restId}`,
    replyToId: legacy.inReplyToStatusIdStr ?? null,
    conversationId: legacy.conversationIdStr ?? tweet.restId,
    quoted: depth < 2 ? normalize(entry.quoted, depth + 1) : null,
    isRepost: Boolean(entry.retweeted || legacy.retweetedStatusResult),
  };
  return post;
}

// The dependency downloads public endpoint metadata. Never send session headers to those hosts.
export async function xFetch(url, init = {}, fetchFn = fetch) {
  const target = new URL(typeof url === 'string' ? url : url.url ?? String(url));
  const allowed = ['x.com', 'api.x.com', 'raw.githubusercontent.com'];
  if (target.protocol !== 'https:' || !allowed.includes(target.hostname)) {
    throw new AppError('Unexpected host in X library request.');
  }
  const headers = new Headers(init.headers);
  if (target.hostname === 'raw.githubusercontent.com' &&
      ['cookie', 'authorization', 'x-csrf-token'].some((key) => headers.has(key))) {
    throw new AppError('Refusing to send session headers outside X.');
  }
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetchFn(url, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  const manualRedirect = init.redirect === 'manual' && response.status >= 300 && response.status < 400;
  if (!response.ok && !manualRedirect) {
    throw new AppError(response.status === 429
      ? 'X rate limit reached (429). Wait before collecting again; collection was stopped.'
      : `X collection failed (HTTP ${response.status}). Check session cookies and upstream library compatibility.`);
  }
  return response;
}

export async function createXClient({ guest = false, env = process.env } = {}) {
  if (!guest && (!env.X_AUTH_TOKEN || !env.X_CT0)) {
    throw new AppError('X_AUTH_TOKEN and X_CT0 are required in .env. See README.md. Use --guest only to try public access.');
  }
  const { TwitterOpenApi } = await import('twitter-openapi-typescript');
  TwitterOpenApi.fetchApi = xFetch;
  const api = new TwitterOpenApi();
  if (env.X_PLATFORM) {
    if (!['macOS', 'Windows', 'Linux'].includes(env.X_PLATFORM)) {
      throw new AppError('X_PLATFORM must be macOS, Windows, or Linux.');
    }
    const platform = { 'sec-ch-ua-platform': JSON.stringify(env.X_PLATFORM) };
    api.setAdditionalApiHeaders(platform);
    api.setAdditionalBrowserHeaders(platform);
  }
  return guest ? api.getGuestClient() : api.getClientFromCookies({
    auth_token: env.X_AUTH_TOKEN,
    ct0: env.X_CT0,
  });
}

export async function collect({ client, username = 'thsottiaux', count = 100,
  guest = false, contextLimit = 20, wait = sleep, now = () => new Date(), onProgress = () => {} }) {
  const screenName = handle(username);
  const warnings = guest ? ['Guest mode: replies may be unavailable; timeline coverage is limited.'] : [];
  const userResponse = await client.getUserApi().getUserByScreenName({ screenName });
  const user = userResponse.data?.user;
  if (!user?.restId) throw new AppError('X user not found or unavailable.');
  if (user.privacy?.protected || user.legacy?.protected) {
    throw new AppError('Only public accounts are supported.');
  }
  const tweetApi = client.getTweetApi();
  const all = new Map();
  const own = new Map();
  const cursors = new Set();
  let cursor;
  let pages = 0;
  let stopReason = 'page_limit';
  // Fetch an extra page after reaching count so an old pinned post cannot displace a recent post.
  let reachedAt = null;
  while (pages < 20) {
    const params = { userId: user.restId, count: 40, ...(cursor ? { cursor } : {}) };
    const result = await (guest ? tweetApi.getUserTweets(params) : tweetApi.getUserTweetsAndReplies(params));
    pages += 1;
    if (!Array.isArray(result.data?.data)) throw new AppError('Unexpected X timeline response.');
    for (const entry of flatten(result.data.data)) {
      const post = normalize(entry);
      if (!post) continue;
      all.set(post.id, post);
      if (post.authorId === user.restId && !post.isRepost) own.set(post.id, post);
    }
    onProgress(`Collected ${own.size} authored posts (${pages} pages).`);
    const next = result.data.cursor?.bottom?.value;
    if (!next || cursors.has(next)) { stopReason = next ? 'repeated_cursor' : 'end_of_timeline'; break; }
    if (reachedAt !== null && pages > reachedAt) { stopReason = 'requested_count'; break; }
    if (own.size >= count) reachedAt = pages;
    cursors.add(next);
    cursor = next;
    await wait(1000);
  }
  const posts = [...own.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, count);
  if (!posts.length) throw new AppError('X returned no public authored posts; authentication or endpoint changes may be responsible.');
  if (posts.length < count) warnings.push(`Requested ${count} posts, obtained ${posts.length} (${stopReason}).`);
  if (stopReason === 'page_limit' || stopReason === 'repeated_cursor') warnings.push(`Pagination stopped: ${stopReason}; coverage may be incomplete.`);

  let contextRequests = 0;
  let contextBlocked = false;
  for (const post of posts) {
    if (!post.replyToId) continue;
    if (!all.has(post.replyToId) && !contextBlocked && contextRequests < contextLimit) {
      contextRequests += 1;
      await wait(1000);
      try {
        const detail = await tweetApi.getTweetDetail({ focalTweetId: post.replyToId });
        for (const entry of flatten(detail.data?.data ?? [])) {
          const context = normalize(entry);
          if (context) all.set(context.id, context);
        }
      } catch (error) {
        if (error instanceof AppError && /429/.test(error.message)) throw error;
        if (error instanceof AppError && /HTTP (401|403)/.test(error.message)) {
          contextBlocked = true;
          warnings.push('Reply context access requires a valid authenticated session; further detail requests stopped.');
        } else {
          warnings.push(`Reply parent unavailable for post ${post.id}.`);
        }
      }
    }
    post.parent = all.get(post.replyToId) ?? null;
  }
  const missing = posts.filter((p) => p.replyToId && !p.parent).length;
  if (missing) warnings.push(`${missing} reply parents missing (additional context requests limited to ${contextLimit}).`);
  return {
    version: 1,
    source: 'x-internal-api',
    username: screenName,
    collectedAt: iso(now()),
    requestedCount: count,
    pages,
    contextRequests,
    stopReason,
    warnings,
    posts,
  };
}

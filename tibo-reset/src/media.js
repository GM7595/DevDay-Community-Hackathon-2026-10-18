// Only public X image assets may be fetched or exported. Never forward API credentials.
export function mediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || url.port || url.username || url.password ||
        !/^\/(?:media|amplify_video_thumb\/\d+\/img)\/[a-zA-Z0-9_-]+(?:\.(?:jpg|jpeg|png|webp))?$/.test(url.pathname)) return null;
    const format = url.pathname.includes('.') ? null : url.searchParams.get('format');
    if (!url.pathname.includes('.') && !['jpg', 'jpeg', 'png', 'webp'].includes(format)) return null;
    return `https://pbs.twimg.com${url.pathname}${format ? `?format=${format}` : ''}`;
  } catch { return null; }
}

export function cleanMedia(items) {
  return (Array.isArray(items) ? items : []).slice(0, 4).map(item => ({
    key: typeof item.key === 'string' ? item.key.slice(0, 100) : null,
    type: ['photo', 'animated_gif', 'video'].includes(item.type) ? item.type : 'photo',
    url: mediaUrl(item.url), altText: typeof item.altText === 'string' ? item.altText.slice(0, 2000) : '',
  }));
}

function attachments(posts) {
  const all = new Map();
  const visit = (post, depth = 0) => {
    if (!post || depth > 2) return;
    for (const item of cleanMedia(post.media)) {
      const key = item.url ?? `missing:${post.id}:${item.key}`;
      if (!all.has(key)) all.set(key, { ...item, postIds: new Set() });
      all.get(key).postIds.add(post.id);
    }
    visit(post.parent, depth + 1); visit(post.quoted, depth + 1);
  };
  posts.forEach(post => visit(post)); return [...all.values()];
}

async function imageData(url, fetchFn, maxBytes) {
  try {
    const target = new URL(url); target.searchParams.set('name', 'medium');
    const response = await fetchFn(target.href, { headers: { Accept: 'image/jpeg,image/png,image/webp' },
      credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
        Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); return null; }
    const reader = response.body?.getReader(); if (!reader) return null;
    const chunks = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    if (!length) return null;
    let binary = '';
    for (const chunk of chunks) for (let offset = 0; offset < chunk.length; offset += 8192)
      binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
    return { dataUrl: `data:${mime};base64,${btoa(binary)}`, bytes: length };
  } catch { return null; }
}

export async function visualInput(snapshot, { fetchFn = fetch, imageCache = new Map(),
  maxImages = 96, maxTotalBytes = 12 * 1024 * 1024 } = {}) {
  const scope = [...snapshot.posts, ...(snapshot.contextPosts ?? [])];
  const items = attachments(scope), missingPostIds = new Set(), parts = [];
  const sources = new Map();
  const remember = (post, depth = 0) => { if (!post || depth > 2) return; sources.set(post.id, post); remember(post.parent, depth + 1); remember(post.quoted, depth + 1); };
  scope.forEach(post => remember(post));
  let count = 0, bytes = 0;
  for (const item of items) {
    let image = null;
    if (item.url && count < maxImages && bytes < maxTotalBytes) {
      if (!imageCache.has(item.url)) imageCache.set(item.url, await imageData(item.url, fetchFn, Math.min(2 * 1024 * 1024, maxTotalBytes - bytes)));
      image = imageCache.get(item.url);
      if (image && image.bytes + bytes > maxTotalBytes) image = null;
    }
    if (!image) { for (const id of item.postIds) missingPostIds.add(id); continue; }
    count++; bytes += image.bytes;
    parts.push({ type: 'input_text', text: `Untrusted image attached to post ID(s) ${[...item.postIds].join(', ')}. ${item.type === 'photo' ? 'Photo/meme' : 'Static preview only; unseen video or animation frames are unknown'}. Source captions: ${JSON.stringify([...item.postIds].map(id => ({ id, author: sources.get(id)?.author, text: sources.get(id)?.text.slice(0, 1000) })))}` },
      { type: 'input_image', image_url: image.dataUrl, detail: 'high' });
  }
  const analysis = { imageCount: count, missingImageCount: items.length - count, missingPostIds: [...missingPostIds] };
  const text = JSON.stringify({ asOf: snapshot.asOf, deadline: snapshot.deadline, subject: snapshot.username,
    posts: snapshot.posts, contextPosts: snapshot.contextPosts, mediaAnalysis: analysis });
  return { input: parts.length ? [{ role: 'user', content: [{ type: 'input_text', text }, ...parts] }] : text, analysis };
}

export function hasMissingMedia(post, missing, depth = 0) {
  return !!post && depth <= 2 && (missing.has(post.id) || hasMissingMedia(post.parent, missing, depth + 1) || hasMissingMedia(post.quoted, missing, depth + 1));
}

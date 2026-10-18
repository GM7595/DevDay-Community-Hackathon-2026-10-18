const SNAPSHOT_URL = "https://tibo-reset-watch.soumame.chatgpt.site/snapshot.json";
const SOURCES = new Set(["x-official-api", "x-internal-api"]);
const CACHE_HEADERS = { "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=0, s-maxage=60", "x-content-type-options": "nosniff" };

function date(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function probability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function publicSnapshot(input) {
  if (!input || input.username?.toLowerCase() !== "thsottiaux" || input.target !== "codex"
    || !SOURCES.has(input.source) || !date(input.asOf) || !Array.isArray(input.evidence)
    || input.evidence.length > 190) throw new Error("invalid_snapshot");
  const evidence = input.evidence.map((item) => {
    const post = item?.post;
    if (!post || typeof post.id !== "string" || !/^\d+$/.test(post.id)
      || typeof post.author !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(post.author)
      || !date(post.createdAt)) throw new Error("invalid_snapshot");
    return {
      post: { id: post.id, author: post.author, createdAt: date(post.createdAt),
        text: typeof post.text === "string" ? post.text.slice(0, 20_000) : "",
        url: `https://x.com/${post.author}/status/${post.id}`, isRepost: post.isRepost === true },
      category: ["future_announcement", "already_reset", "denial", "indirect_hint", "irrelevant", "refusal"].includes(item.category) ? item.category : "irrelevant",
      confidence: probability(item.confidence), signalProbability: probability(item.signalProbability),
      signalKind: ["announced", "completed", "hint", "denied", "discussion", "unrelated"].includes(item.signalKind) ? item.signalKind : null,
      signalKindConfidence: probability(item.signalKindConfidence),
      signalStatus: ["scored", "refused", "image_unavailable"].includes(item.signalStatus) ? item.signalStatus : null,
    };
  });
  // Only the public fields needed by the game cross this boundary. In
  // particular, no request headers, environment variables or arbitrary
  // upstream properties are forwarded to the browser.
  return { version: 1, username: "thsottiaux", target: "codex", source: input.source,
    asOf: date(input.asOf), collectedAt: date(input.collectedAt), deadline: date(input.deadline),
    generatedAt: date(input.generatedAt), signalScoredAt: date(input.signalScoredAt),
    signalScoringVersion: [2, 3].includes(input.signalScoringVersion) ? input.signalScoringVersion : 1,
    status: ["estimated", "insufficient_evidence", "stale_data", "refused"].includes(input.status) ? input.status : "insufficient_evidence",
    score: typeof input.score === "number" && Number.isFinite(input.score) && input.score >= 0 && input.score <= 100 ? input.score : null,
    rawModelProbability: probability(input.rawModelProbability), evidenceSufficiency: probability(input.evidenceSufficiency),
    ...(Object.hasOwn(input, "forecastConfidence") ? { forecastConfidence: probability(input.forecastConfidence) } : {}),
    calibrated: false, newestPostAt: date(input.newestPostAt), oldestPostAt: date(input.oldestPostAt),
    postCount: Number.isInteger(input.postCount) && input.postCount >= 0 && input.postCount <= 190 ? input.postCount : evidence.length,
    evidence, warnings: Array.isArray(input.warnings) ? input.warnings.filter((item) => typeof item === "string").slice(0, 50).map((item) => item.slice(0, 500)) : [],
  };
}

async function readBounded(response, maxBytes, controller) {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes) {
    controller.abort();
    throw new Error("snapshot_too_large");
  }
  if (!response.body) throw new Error("invalid_snapshot");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        controller.abort();
        void reader.cancel().catch(() => {});
        throw new Error("snapshot_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Dependency injection is for isolated tests; the upstream URL is fixed. */
export function createResetWatchHandler({ fetchFn = fetch, now = Date.now,
  timeoutMs = 10_000, maxBytes = 2_000_000, cacheMs = 60_000 } = {}) {
  let cached = null, pending = null;
  async function load() {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("snapshot_timeout")); }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchFn(SNAPSHOT_URL, { method: "GET", headers: { accept: "application/json" },
          credentials: "omit", redirect: "error", signal: controller.signal });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("snapshot_upstream_error");
        }
        const text = await readBounded(response, maxBytes, controller);
        let parsed;
        try { parsed = JSON.parse(text); }
        catch { throw new Error("invalid_snapshot"); }
        return JSON.stringify(publicSnapshot(parsed));
      })()]);
    } finally {
      clearTimeout(timer);
    }
  }
  return async function handleResetWatch(request = { method: "GET" }) {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CACHE_HEADERS, "cache-control": "no-store", allow: "GET, HEAD" } });
    try {
      if (!cached || now() >= cached.expiresAt) {
        pending ??= load().then((body) => {
          cached = { body, expiresAt: now() + cacheMs };
          return body;
        }).finally(() => { pending = null; });
        await pending;
      }
      return new Response(method === "HEAD" ? null : cached.body, { headers: CACHE_HEADERS });
    } catch {
      // Never replace a failed refresh with fabricated data or an expired
      // snapshot. The client keeps its last confirmed simulation timestamp.
      return new Response(method === "HEAD" ? null : JSON.stringify({ error: "Reset watch is temporarily unavailable" }), {
        status: 502, headers: { ...CACHE_HEADERS, "cache-control": "no-store" } });
    }
  };
}

export const handleResetWatch = createResetWatchHandler();

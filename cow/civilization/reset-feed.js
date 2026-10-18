// This adapter recognizes model-classified public announcements. It never
// verifies or changes anyone's real Codex quota.
const AUTHOR = "thsottiaux";
const TARGET = "codex";
const MIN_CONFIDENCE = 0.8;
const FRESH_FOR_MS = 2 * 60 * 60 * 1000;
const TRUSTED_SOURCES = new Set(["x-internal-api", "x-official-api"]);

function timestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function probability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function author(value) {
  return typeof value === "string" ? value.replace(/^@/, "").toLowerCase() : "";
}

function postRecord(post, asOf, now) {
  const at = timestamp(post?.createdAt);
  if (typeof post?.id !== "string" || !/^\d+$/.test(post.id)
    || author(post.author) !== AUTHOR || post.isRepost || at === null || at > asOf || at > now) return null;
  return { eventId: `x:${post.id}`, postId: post.id, publishedAt: at,
    sourceUrl: `https://x.com/${AUTHOR}/status/${post.id}`,
    sourceAuthor: AUTHOR, target: TARGET };
}

function cachedNotices(previous, born, now) {
  const result = new Map();
  for (const notice of Array.isArray(previous?.notices) ? previous.notices : []) {
    if (notice?.sourceAuthor !== AUTHOR || notice?.target !== TARGET
      || notice?.status !== "confirmed_notice" || !probability(notice.confidence)
      || notice.confidence < MIN_CONFIDENCE) continue;
    const record = postRecord({ id: notice.postId, author: notice.sourceAuthor,
      createdAt: notice.publishedAt }, now, now);
    if (!record || record.publishedAt <= born || notice.eventId !== record.eventId) continue;
    result.set(record.eventId, { ...record, status: "confirmed_notice", confidence: notice.confidence,
      classificationSource: ["signal-v2", "signal-v3"].includes(notice.classificationSource) ? notice.classificationSource : "category-v1" });
  }
  return result;
}

function forecastOf(report, now) {
  const asOf = timestamp(report?.asOf), deadline = timestamp(report?.deadline);
  if (report?.status !== "estimated" || asOf === null || asOf > now
    || deadline === null || deadline <= now || deadline <= asOf) return null;
  const p = probability(report.rawModelProbability) ? report.rawModelProbability
    : typeof report.score === "number" && report.score >= 0 && report.score <= 100 ? report.score / 100 : null;
  return p === null ? null : { probability: p, asOf, deadline, calibrated: false };
}

/**
 * Normalize the teammate's public report without fetching it.
 *
 * Persist the entire result as `previous`. `notices` is a cumulative ledger,
 * not a list of rewards to apply now: replay by eventId/publishedAt in the
 * simulation. A report's rolling window must reach the last covered instant.
 * `confirmedThrough` means continuous observed snapshot coverage under the
 * game's classification rules, not proof of complete X or Codex backend data.
 * All returned timestamps are epoch milliseconds.
 */
export function normalizeResetFeed(report, { now = Date.now(), previous = null, createdAt } = {}) {
  const currentTime = timestamp(now);
  if (currentTime === null) throw new TypeError("now must be a valid timestamp");
  const born = timestamp(createdAt) ?? timestamp(previous?.createdAt) ?? currentTime;
  const priorThrough = timestamp(previous?.confirmedThrough);
  const confirmedThrough = priorThrough !== null && priorThrough <= currentTime && priorThrough >= born ? priorThrough : null;
  const priorAsOf = timestamp(previous?.lastAsOf);
  const notices = cachedNotices(previous, born, currentTime);
  const base = { version: 1, createdAt: born, notices: [...notices.values()], uncertain: [],
    confirmedThrough, lastAsOf: priorAsOf, status: "unavailable", reason: "missing_snapshot",
    forecast: forecastOf(previous?.forecast ? { status: "estimated", asOf: previous.forecast.asOf,
      deadline: previous.forecast.deadline, rawModelProbability: previous.forecast.probability } : null, currentTime),
    coverageBasis: previous?.coverageBasis ?? null };
  if (!report || typeof report !== "object") return base;
  if (author(report.username) !== AUTHOR || report.target !== TARGET) {
    return { ...base, reason: "wrong_subject_or_target", forecast: null };
  }
  // The parent supplies the known public endpoint. This marker is a provenance
  // check, not authentication of an arbitrary user-uploaded JSON document.
  if (!TRUSTED_SOURCES.has(report.source)) {
    return { ...base, status: "unverified", reason: "collection_unverified", forecast: null };
  }
  const asOf = timestamp(report.asOf);
  if (asOf === null || asOf > currentTime || !Array.isArray(report.evidence)) {
    return { ...base, reason: "invalid_snapshot" };
  }
  if (priorAsOf !== null && asOf < priorAsOf) {
    return { ...base, status: "stale", reason: "older_snapshot" };
  }

  const modernSignals = [2, 3].includes(report.signalScoringVersion);
  const uncertain = new Map(), observed = [], grouped = new Map();
  for (const entry of report.evidence) {
    const record = postRecord(entry?.post, asOf, currentTime);
    if (!record) continue;
    observed.push(record.publishedAt);
    if (!grouped.has(record.eventId)) grouped.set(record.eventId, []);
    grouped.get(record.eventId).push({ entry, record });
  }
  for (const [id, copies] of grouped) {
    const signatures = new Set(copies.map(({ entry, record }) => JSON.stringify([
      record.publishedAt, modernSignals ? entry.signalKind : entry.category,
      modernSignals ? entry.signalKindConfidence : entry.confidence,
      modernSignals ? entry.signalStatus : null,
    ])));
    const { entry, record } = copies[0];
    if (record.publishedAt <= born) continue;
    if (signatures.size > 1) {
      uncertain.set(id, { ...record, reason: "conflicting_duplicate" });
      continue;
    }
    const v2 = modernSignals;
    const completed = v2 ? entry.signalKind === "completed" : entry.category === "already_reset";
    const confidence = v2 ? entry.signalKindConfidence : entry.confidence;
    const signalRefused = v2 && ["refused", "image_unavailable"].includes(entry.signalStatus);
    if (completed && probability(confidence) && confidence >= MIN_CONFIDENCE && !signalRefused) {
      // Preserve the first accepted timestamp for a stable post ID.
      if (!notices.has(id)) notices.set(id, { ...record, status: "confirmed_notice", confidence,
        classificationSource: v2 ? `signal-v${report.signalScoringVersion}` : "category-v1" });
    } else if (completed || signalRefused || (v2 && !entry.signalKind && entry.category === "already_reset")) {
      uncertain.set(id, { ...record, reason: signalRefused ? entry.signalStatus : "classification_uncertain" });
    }
  }
  const next = { ...base,
    notices: [...notices.values()].sort((a, b) => a.publishedAt - b.publishedAt || a.eventId.localeCompare(b.eventId)),
    uncertain: [...uncertain.values()].sort((a, b) => a.publishedAt - b.publishedAt),
    lastAsOf: asOf, forecast: forecastOf(report, currentTime) };
  const collectedAt = timestamp(report.collectedAt);
  const through = collectedAt === null ? asOf : Math.min(asOf, collectedAt);
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const incomplete = warnings.some((warning) => typeof warning === "string"
    && /guest mode|coverage.*(?:limited|incomplete)|pagination stopped|timeline completeness are not verified/i.test(warning));
  if (incomplete || collectedAt === null || collectedAt > currentTime) {
    return { ...next, status: "unverified", reason: "collection_unverified" };
  }
  if (!observed.length || observed.length < report.evidence.length
    || (Number.isInteger(report.postCount) && report.postCount > observed.length)) {
    return { ...next, status: "unverified", reason: "incomplete_evidence" };
  }
  // If metadata and actual evidence disagree, use the narrower window.
  const oldest = Math.max(Math.min(...observed), timestamp(report.oldestPostAt) ?? 0);
  const anchor = confirmedThrough ?? born;
  if (oldest > anchor && through > anchor) {
    return { ...next, status: "gap", reason: "rolling_window_gap", oldestPostAt: oldest };
  }
  const covered = through >= anchor ? Math.max(anchor, through) : confirmedThrough;
  const stale = currentTime - through > FRESH_FOR_MS;
  return { ...next, confirmedThrough: covered, oldestPostAt: oldest,
    coverageBasis: collectedAt === null ? "snapshot_asOf" : "collectedAt",
    status: stale ? "stale" : "current", reason: stale ? "snapshot_stale" : null };
}

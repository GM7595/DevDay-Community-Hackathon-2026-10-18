import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResetFeed } from "../civilization/reset-feed.js";

const born = Date.parse("2026-10-18T00:00:00Z");
const hour = 3_600_000;
const iso = (value) => new Date(value).toISOString();
const entry = (id, at, extra = {}) => ({ post: { id, author: "thsottiaux", createdAt: iso(at),
  url: "javascript:invalid", text: "Synthetic fixture" }, category: "already_reset", confidence: 0.95,
  signalKind: "completed", signalKindConfidence: 0.96, signalStatus: "scored", ...extra });
const snapshot = (extra = {}) => ({ username: "thsottiaux", target: "codex", source: "x-internal-api",
  asOf: iso(born + hour), collectedAt: iso(born + hour), deadline: iso(born + 25 * hour),
  signalScoringVersion: 2, status: "estimated", rawModelProbability: 0.7,
  evidence: [entry("1", born - hour), entry("2", born + hour / 2)], ...extra });
const options = (extra = {}) => ({ now: born + hour, createdAt: born, ...extra });

test("completed v2 announcement is a game notice with reconstructed URL, not a future probability", () => {
  const result = normalizeResetFeed(snapshot(), options());
  assert.equal(result.notices.length, 1);
  assert.deepEqual(result.notices[0], { eventId: "x:2", postId: "2", publishedAt: born + hour / 2,
    sourceUrl: "https://x.com/thsottiaux/status/2", sourceAuthor: "thsottiaux", target: "codex",
    status: "confirmed_notice", confidence: 0.96, classificationSource: "signal-v2" });
  assert.equal(result.confirmedThrough, born + hour);
  assert.equal(result.forecast.probability, 0.7);
});

test("forecast, positive signal probability and announced category never replenish quotas", () => {
  const result = normalizeResetFeed(snapshot({ rawModelProbability: 1, evidence: [entry("1", born - hour),
    entry("2", born + hour / 2, { signalKind: "announced", signalProbability: 1 })] }), options());
  assert.equal(result.notices.length, 0);
});

test("v2 cannot fall back over contradictory, refused or uncertain content classification", () => {
  for (const extra of [{ signalKind: "discussion" }, { signalKindConfidence: 0.79 },
    { signalKindConfidence: null }, { signalKind: null }, { signalStatus: "refused" }]) {
    const result = normalizeResetFeed(snapshot({ evidence: [entry("1", born - hour),
      entry("2", born + hour / 2, extra)] }), options());
    assert.equal(result.notices.length, 0);
    if (extra.signalKind !== "discussion") assert.equal(result.uncertain.length, 1);
  }
});

test("legacy report uses category confidence only when v2 is absent", () => {
  const result = normalizeResetFeed(snapshot({ signalScoringVersion: 1 }), options());
  assert.equal(result.notices[0].classificationSource, "category-v1");
  assert.equal(result.notices[0].confidence, 0.95);
});

test("official API v3 vision signals preserve completed semantics and unavailable images cannot refill", () => {
  const third = { source: "x-official-api", signalScoringVersion: 3 };
  const valid = normalizeResetFeed(snapshot(third), options());
  assert.equal(valid.status, "current");
  assert.equal(valid.notices[0].classificationSource, "signal-v3");
  const uncertain = normalizeResetFeed(snapshot({ ...third,
    evidence: [entry("1", born - hour), entry("2", born + hour / 2, { signalStatus: "image_unavailable" })] }), options());
  assert.equal(uncertain.notices.length, 0);
  assert.equal(uncertain.uncertain[0].reason, "image_unavailable");
  assert.equal(normalizeResetFeed(null, options({ previous: valid })).notices[0].classificationSource, "signal-v3");
});

test("another account, another product, reposts and future posts do not refill", () => {
  for (const extra of [{ username: "someone" }, { target: "api-credit" }]) {
    const result = normalizeResetFeed(snapshot(extra), options());
    assert.equal(result.notices.length, 0);
    assert.equal(result.confirmedThrough, null);
  }
  for (const post of [{ author: "someone" }, { isRepost: true }, { createdAt: iso(born + 2 * hour) }]) {
    const candidate = entry("2", born + hour / 2);
    Object.assign(candidate.post, post);
    assert.equal(normalizeResetFeed(snapshot({ evidence: [candidate] }), options()).notices.length, 0);
  }
  assert.equal(normalizeResetFeed(snapshot({ asOf: iso(born + 2 * hour) }), options()).notices.length, 0);
});

test("repeated polling and reload preserve a sorted event ledger without repeated rewards", () => {
  const first = normalizeResetFeed(snapshot(), options());
  const reloaded = JSON.parse(JSON.stringify(first));
  const second = normalizeResetFeed(snapshot({ evidence: [entry("3", born + hour * 0.75),
    entry("2", born + hour / 2), entry("2", born + hour / 2), entry("1", born - hour)] }), options({ previous: reloaded }));
  assert.deepEqual(second.notices.map((notice) => notice.eventId), ["x:2", "x:3"]);
  assert.equal(normalizeResetFeed(snapshot(), options({ previous: second })).notices.length, 2);
  assert.deepEqual(normalizeResetFeed(null, options({ previous: second })).notices, second.notices);
});

test("conflicting copies of one post cannot manufacture a completed notice", () => {
  const result = normalizeResetFeed(snapshot({ evidence: [entry("1", born - hour),
    entry("2", born + hour / 2), entry("2", born + hour / 2, { signalKind: "discussion" })] }), options());
  assert.equal(result.notices.length, 0);
  assert.equal(result.uncertain[0].reason, "conflicting_duplicate");
});

test("a fresh collection of old posts advances coverage even without recent posts", () => {
  const result = normalizeResetFeed(snapshot({ status: "stale_data", evidence: [entry("1", born - 72 * hour)] }), options());
  assert.equal(result.status, "current");
  assert.equal(result.confirmedThrough, born + hour);
  assert.equal(result.forecast, null);
});

test("rolling window gaps do not advance the prior confirmed timestamp", () => {
  const first = normalizeResetFeed(snapshot(), options());
  const next = normalizeResetFeed(snapshot({ asOf: iso(born + 4 * hour), collectedAt: iso(born + 4 * hour),
    oldestPostAt: iso(born + 2 * hour), evidence: [entry("3", born + 2 * hour)] }), options({ now: born + 4 * hour, previous: first }));
  assert.equal(next.status, "gap");
  assert.equal(next.confirmedThrough, first.confirmedThrough);
  assert.deepEqual(next.notices.map((notice) => notice.eventId), ["x:2", "x:3"]);
  const repaired = normalizeResetFeed(snapshot({ asOf: iso(born + 4 * hour), collectedAt: iso(born + 4 * hour),
    evidence: [entry("1", born - hour), entry("3", born + 2 * hour)] }), options({ now: born + 4 * hour, previous: next }));
  assert.equal(repaired.confirmedThrough, born + 4 * hour);
});

test("first visit does not grant a historical notice and gap needs earlier evidence", () => {
  const first = normalizeResetFeed(snapshot(), { now: born + hour });
  assert.equal(first.notices.length, 0);
  assert.equal(first.createdAt, born + hour);
  const gap = normalizeResetFeed(snapshot({ evidence: [entry("2", born + hour / 2)] }), options());
  assert.equal(gap.status, "gap");
  assert.equal(gap.confirmedThrough, null);
});

test("reanalysis cannot advance coverage beyond actual collection time", () => {
  const result = normalizeResetFeed(snapshot({ asOf: iso(born + 4 * hour) }), options({ now: born + 4 * hour }));
  assert.equal(result.confirmedThrough, born + hour);
  assert.equal(result.status, "stale");
});

test("incomplete, imported or missing data cannot certify an absence of resets", () => {
  for (const extra of [{ source: "manual-import" }, { warnings: ["Guest mode: timeline coverage is limited."] },
    { warnings: ["Pagination stopped: page_limit; coverage may be incomplete."] }, { evidence: [] }, { postCount: 100 }]) {
    const result = normalizeResetFeed(snapshot(extra), options());
    assert.equal(result.status, "unverified");
    assert.equal(result.confirmedThrough, null);
  }
  for (const source of ["import", "manual-import", "synthetic", null, undefined]) {
    const result = normalizeResetFeed(snapshot({ source }), options());
    assert.equal(result.notices.length, 0);
    assert.equal(result.forecast, null);
  }
  assert.equal(normalizeResetFeed(snapshot({ collectedAt: null }), options()).confirmedThrough, null);
});

test("older snapshots do not move coverage backward or overwrite newer forecast", () => {
  const first = normalizeResetFeed(snapshot(), options());
  const older = normalizeResetFeed(snapshot({ asOf: iso(born), collectedAt: iso(born), rawModelProbability: 0.01 }), options({ previous: first }));
  assert.equal(older.confirmedThrough, first.confirmedThrough);
  assert.equal(older.forecast.probability, 0.7);
  assert.equal(older.reason, "older_snapshot");
  assert.equal(normalizeResetFeed(null, options({ now: born + 26 * hour, previous: first })).forecast, null);
});

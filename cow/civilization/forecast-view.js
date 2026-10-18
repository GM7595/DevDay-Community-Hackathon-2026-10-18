const MAX_COLLECTION_AGE = 2 * 60 * 60 * 1000;
const SOURCES = new Set(["x-official-api", "x-internal-api"]);

function timestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function probability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Display a stored model forecast, independently of game quota and reset eligibility. */
export function deriveForecastView(report, now = Date.now()) {
  const unavailable = { probability: null, confidence: null, status: "unavailable",
    asOf: null, deadline: null, label: "予測を取得できません" };
  const currentTime = timestamp(now);
  if (!report || typeof report !== "object" || currentTime === null
    || typeof report.username !== "string" || report.username.toLowerCase() !== "thsottiaux"
    || report.target !== "codex" || !SOURCES.has(report.source)) return unavailable;

  const asOf = timestamp(report.asOf), deadline = timestamp(report.deadline);
  const collectedAt = timestamp(report.collectedAt);
  const empty = { ...unavailable, asOf, deadline };
  if (asOf === null || deadline === null || collectedAt === null || deadline <= asOf
    || asOf > currentTime || collectedAt > currentTime) return empty;
  if (deadline <= currentTime) return { ...empty, status: "expired", label: "予測の期限が切れています" };
  if (currentTime - collectedAt > MAX_COLLECTION_AGE || report.status === "stale_data") {
    return { ...empty, status: "stale", label: "予測データの更新を待っています" };
  }
  if (!["estimated", "insufficient_evidence"].includes(report.status)) return empty;
  const predicted = probability(report.rawModelProbability);
  if (predicted === null) return empty;
  // An explicit null means confidence could not be assessed (for example,
  // missing images). Do not replace it with another, differently named metric.
  const confidence = Object.hasOwn(report, "forecastConfidence")
    ? probability(report.forecastConfidence) : probability(report.evidenceSufficiency);
  return { probability: predicted, confidence,
    status: report.status === "estimated" ? "estimated" : "reference", asOf, deadline,
    label: report.status === "estimated" ? "リセットの推定確率" : "根拠不足 · 参考値" };
}

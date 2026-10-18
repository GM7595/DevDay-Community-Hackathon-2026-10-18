import test from "node:test";
import assert from "node:assert/strict";
import { deriveForecastView } from "../civilization/forecast-view.js";

const asOf = Date.parse("2026-10-18T06:00:00Z");
const hour = 3_600_000;
const report = (extra = {}) => ({ username: "thsottiaux", target: "codex", source: "x-official-api",
  asOf: new Date(asOf).toISOString(), collectedAt: new Date(asOf).toISOString(),
  deadline: new Date(asOf + 24 * hour).toISOString(), status: "estimated", rawModelProbability: 0.7,
  evidenceSufficiency: 0.4, forecastConfidence: 0.6, ...extra });

test("forecast probability and confidence remain separate, including valid zero values", () => {
  assert.deepEqual(deriveForecastView(report(), asOf), { probability: 0.7, confidence: 0.6,
    status: "estimated", asOf, deadline: asOf + 24 * hour, label: "リセットの推定確率" });
  const zero = deriveForecastView(report({ rawModelProbability: 0, forecastConfidence: 0 }), asOf);
  assert.equal(zero.probability, 0);
  assert.equal(zero.confidence, 0);
});

test("insufficient evidence can show the actual raw estimate only as a labeled reference", () => {
  const view = deriveForecastView(report({ status: "insufficient_evidence", rawModelProbability: 0.13 }), asOf);
  assert.equal(view.status, "reference");
  assert.equal(view.probability, 0.13);
  assert.match(view.label, /根拠不足/);
});

test("explicit unknown confidence never falls back; legacy reports may use evidence sufficiency", () => {
  assert.equal(deriveForecastView(report({ forecastConfidence: null }), asOf).confidence, null);
  const legacy = report(); delete legacy.forecastConfidence;
  assert.equal(deriveForecastView(legacy, asOf).confidence, 0.4);
  assert.equal(deriveForecastView(report({ forecastConfidence: 7 }), asOf).confidence, null);
});

test("expired and stale collections hide the number without inventing 0%", () => {
  const expired = deriveForecastView(report(), asOf + 24 * hour);
  assert.equal(expired.status, "expired");
  assert.equal(expired.probability, null);
  const stale = deriveForecastView(report(), asOf + 2 * hour + 1);
  assert.equal(stale.status, "stale");
  assert.equal(stale.probability, null);
  assert.equal(stale.confidence, null);
  assert.equal(deriveForecastView(report(), asOf + 2 * hour).status, "estimated");
  assert.equal(deriveForecastView(report({ status: "stale_data" }), asOf).status, "stale");
});

test("refusals, unknown statuses and invalid or absent estimates cannot become live forecasts", () => {
  for (const extra of [{ status: "refused" }, { status: "unknown" }, { rawModelProbability: null },
    { rawModelProbability: 7 }, { rawModelProbability: "0.9" }, { rawModelProbability: NaN },
    { rawModelProbability: undefined, score: 99 }]) {
    const view = deriveForecastView(report(extra), asOf);
    assert.equal(view.status, "unavailable");
    assert.equal(view.probability, null);
  }
});

test("future dates, bad windows and missing collection dates fail closed", () => {
  for (const extra of [{ asOf: asOf + 1 }, { collectedAt: asOf + 1 }, { collectedAt: null },
    { deadline: asOf - 1 }, { asOf: "invalid" }]) {
    assert.equal(deriveForecastView(report(extra), asOf).status, "unavailable");
  }
});

test("only the expected author, Codex target and known collection sources are displayed", () => {
  for (const extra of [{ username: "another" }, { target: "api-credit" }, { source: "import" }, { source: null }]) {
    const view = deriveForecastView(report(extra), asOf);
    assert.equal(view.probability, null);
    assert.equal(view.status, "unavailable");
  }
  assert.equal(deriveForecastView(report({ source: "x-internal-api" }), asOf).status, "estimated");
  assert.equal(deriveForecastView(null, asOf).status, "unavailable");
});

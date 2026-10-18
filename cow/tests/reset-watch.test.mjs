import test from "node:test";
import assert from "node:assert/strict";
import { createResetWatchHandler } from "../src/reset-watch.js";

const fixture = () => ({ username: "thsottiaux", target: "codex", source: "x-official-api",
  asOf: "2026-10-18T06:00:00Z", collectedAt: "2026-10-18T06:00:00Z", deadline: "2026-10-19T06:00:00Z",
  signalScoringVersion: 3, status: "estimated", rawModelProbability: 0.7,
  evidence: [{ post: { id: "123", author: "thsottiaux", createdAt: "2026-10-18T05:00:00Z", text: "Synthetic fixture" },
    category: "already_reset", confidence: 0.8, signalKind: "completed", signalKindConfidence: 0.9, signalStatus: "scored" }] });
const json = (data) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

test("fixed public endpoint receives no caller credentials and output contains only public fields", async () => {
  const data = fixture(); data.OPENAI_API_KEY = "fake-private-key";
  data.evidence[0].post.password = "fake-private-value";
  const handle = createResetWatchHandler({ fetchFn: async (url, options) => {
    assert.equal(url, "https://tibo-reset-watch.soumame.chatgpt.site/snapshot.json");
    assert.deepEqual(options.headers, { accept: "application/json" });
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    return json(data);
  } });
  const response = await handle({ method: "GET", url: "/api/reset-watch?url=https://evil.invalid", headers: { authorization: "fake-caller-secret" } });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes("fake-"));
  assert.equal(JSON.parse(text).evidence[0].post.url, "https://x.com/thsottiaux/status/123");
  assert.equal(JSON.parse(text).signalScoringVersion, 3);
  assert.match(response.headers.get("cache-control"), /s-maxage=60/);
});

test("non-GET methods do not contact the upstream; HEAD has no response body", async () => {
  let calls = 0;
  const handle = createResetWatchHandler({ fetchFn: async () => { calls += 1; return json(fixture()); } });
  assert.equal((await handle({ method: "POST" })).status, 405);
  assert.equal(calls, 0);
  const response = await handle({ method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("concurrent reads share one request and the cache expires after one minute", async () => {
  let calls = 0, time = 0;
  const handle = createResetWatchHandler({ now: () => time, fetchFn: async () => { calls += 1; return json(fixture()); } });
  const results = await Promise.all([handle(), handle(), handle()]);
  assert.equal(calls, 1);
  assert.ok(results.every((response) => response.status === 200));
  time = 59_999; await handle(); assert.equal(calls, 1);
  time = 60_000; await handle(); assert.equal(calls, 2);
});

test("failed refresh never returns expired cached data and the next read can retry", async () => {
  let time = 0, fail = false;
  const handle = createResetWatchHandler({ now: () => time, fetchFn: async () => {
    if (fail) return new Response("private upstream error", { status: 503 });
    return json(fixture());
  } });
  assert.equal((await handle()).status, 200);
  time = 60_000; fail = true;
  const failed = await handle();
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.ok(!(await failed.text()).includes("private"));
  fail = false; assert.equal((await handle()).status, 200);
});

test("malformed JSON, wrong source, wrong subject and excessive evidence fail closed", async () => {
  const bad = ["not json", { ...fixture(), source: "import" }, { ...fixture(), target: "api-credit" },
    { ...fixture(), username: "another_account" }, { ...fixture(), evidence: Array(191).fill(fixture().evidence[0]) },
    { ...fixture(), evidence: [{ post: { id: "javascript:bad" } }] }];
  for (const value of bad) {
    const handle = createResetWatchHandler({ fetchFn: async () => typeof value === "string" ? new Response(value) : json(value) });
    assert.equal((await handle()).status, 502);
  }
});

test("advertised and actual body size are bounded", async () => {
  const advertised = createResetWatchHandler({ maxBytes: 100, fetchFn: async () => new Response("{}", { headers: { "content-length": "101" } }) });
  assert.equal((await advertised()).status, 502);
  const streamed = createResetWatchHandler({ maxBytes: 100, fetchFn: async () => new Response(" ".repeat(101)) });
  assert.equal((await streamed()).status, 502);
});

test("timeouts abort even an unresponsive fetch and do not poison future retries", async () => {
  let calls = 0, signal;
  const handle = createResetWatchHandler({ timeoutMs: 10, fetchFn: async (_, options) => {
    calls += 1; signal = options.signal;
    if (calls === 1) return new Promise(() => {});
    return json(fixture());
  } });
  assert.equal((await handle()).status, 502);
  assert.equal(signal.aborted, true);
  assert.equal((await handle()).status, 200);
});

test("a stored old snapshot keeps its real asOf rather than inventing a fresh timestamp", async () => {
  const handle = createResetWatchHandler({ now: () => Date.parse("2026-10-22T00:00:00Z"), fetchFn: async () => json(fixture()) });
  const result = await (await handle()).json();
  assert.equal(result.asOf, "2026-10-18T06:00:00.000Z");
  assert.equal(result.collectedAt, result.asOf);
});

test("proxy preserves explicit null and zero forecast confidence while legacy absence stays absent", async () => {
  for (const confidence of [null, 0, 0.72, undefined]) {
    const data = fixture();
    data.evidenceSufficiency = 0.9;
    if (confidence !== undefined) data.forecastConfidence = confidence;
    const handle = createResetWatchHandler({ fetchFn: async () => json(data) });
    const result = await (await handle()).json();
    assert.equal(Object.hasOwn(result, "forecastConfidence"), confidence !== undefined);
    assert.equal(result.forecastConfidence, confidence);
  }
});

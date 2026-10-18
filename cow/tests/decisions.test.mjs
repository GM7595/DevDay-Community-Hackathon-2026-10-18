import assert from "node:assert/strict";
import test from "node:test";
import { handleDecision } from "../src/decisions.js";

const ids = ["medical", "transit", "factory", "delivery", "romance", "entertainment"];
const state = () => ({ elapsed: 40, agents: ids.map((id) => ({ id, quota: 45, taskProgress: 0.5, deadlineSeconds: 12 })) });
const answers = () => ids.map((id, index) => ({ type: "choice", name: `mode_${id}`, choice: ["conserve", "standard", "sprint"][index % 3] }));

test("Decisions endpoint contract without network access", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  let fetchCount = 0;
  let upstream = async () => { throw new Error("Unexpected upstream request in isolated test"); };
  t.mock.method(globalThis, "fetch", async (...args) => { fetchCount += 1; return upstream(...args); });
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  const post = (body = state(), ip = "isolated-test") => handleDecision({ method: "POST", body, ip });

  await t.test("without a key returns six local modes and makes no upstream call", async () => {
    delete process.env.OPENAI_API_KEY;
    assert.equal((await (await handleDecision({ method: "GET" })).json()).mode, "local");
    const result = await (await post()).json();
    assert.equal(result.mode, "local");
    assert.deepEqual(Object.keys(result.modes).sort(), [...ids].sort());
    assert.equal(fetchCount, 0);
  });

  process.env.OPENAI_API_KEY = "isolated-test-placeholder";
  await t.test("key presence is configured, not a successful model response", async () => {
    assert.equal((await (await handleDecision({ method: "GET" })).json()).mode, "configured");
    assert.equal(fetchCount, 0);
  });

  await t.test("rejects malformed, oversized, duplicated and mistyped state before API work", async () => {
    assert.equal((await post("{")).status, 400);
    assert.equal((await post(" ".repeat(32_001))).status, 413);
    for (const elapsed of [null, "40", false, -1, 121, NaN]) {
      assert.equal((await post({ ...state(), elapsed })).status, 400);
    }
    const duplicate = state(); duplicate.agents[1].id = "medical";
    assert.equal((await post(duplicate)).status, 400);
    const badQuota = state(); badQuota.agents[0].quota = 101;
    assert.equal((await post(badQuota)).status, 400);
    assert.equal((await post({ ...state(), event: { id: "emergency", requiredAgentIds: ["factory"], remainingSeconds: 5 } })).status, 400);
    assert.equal(fetchCount, 0);
  });

  await t.test("complete replies preserve all six choices and include validated project context", async () => {
    upstream = async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/decisions");
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, "gpt-6-luna");
      assert.equal(payload.questions.length, 6);
      assert.match(payload.input, /emergency/);
      assert.match(payload.input, /0\.72/);
      return Response.json({ answers: answers().reverse() });
    };
    const result = await (await post({ ...state(), event: { id: "emergency", requiredAgentIds: ["medical"], remainingSeconds: 7, progress: { medical: 0.72 } } })).json();
    assert.equal(result.mode, "decisions");
    assert.equal(result.decisionCount, 6);
    assert.equal(result.modes.medical, "conserve");
    assert.equal(result.modes.factory, "sprint");
  });

  await t.test("missing, refused, duplicate, invalid and extra answers never claim live decisions", async () => {
    const duplicate = answers(); duplicate[5] = duplicate[0];
    const refusal = answers(); refusal[0] = { type: "refusal", name: "mode_medical" };
    const unknown = answers(); unknown[0].choice = "reset";
    const wrongName = answers(); wrongName[0].name = "mode_unknown";
    for (const result of [null, {}, { answers: "invalid" }, { answers: answers().slice(1) }, { answers: duplicate }, { answers: refusal }, { answers: unknown }, { answers: wrongName }, { answers: [...answers(), answers()[0]] }]) {
      upstream = async () => Response.json(result);
      const fallback = await (await post()).json();
      assert.equal(fallback.mode, "fallback");
      assert.equal(fallback.reason, "invalid_response");
      assert.equal(Object.keys(fallback.modes).length, 6);
    }
  });

  await t.test("HTTP failure, broken JSON and network failure keep the game running locally", async () => {
    for (const [response, reason] of [
      [async () => new Response("upstream failure", { status: 503 }), "upstream_error"],
      [async () => new Response("not json"), "invalid_response"],
      [async () => { throw new TypeError("offline"); }, "network_error"],
    ]) {
      upstream = response;
      const result = await (await post(state(), `failure-${reason}`)).json();
      assert.equal(result.mode, "fallback");
      assert.equal(result.reason, reason);
      assert.equal(Object.keys(result.modes).length, 6);
    }
  });

  await t.test("upstream work stops at the five-second timeout", async (timeoutTest) => {
    timeoutTest.mock.timers.enable({ apis: ["setTimeout"] });
    upstream = async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const pending = post(state(), "timeout-client");
    timeoutTest.mock.timers.tick(5_000);
    const result = await (await pending).json();
    assert.equal(result.mode, "fallback");
    assert.equal(result.reason, "timeout");
  });

  await t.test("request cap rejects a seventeenth upstream call from the same client", async () => {
    upstream = async () => Response.json({ answers: answers() });
    const before = fetchCount;
    for (let i = 0; i < 16; i += 1) assert.equal((await post(state(), "limited-client")).status, 200);
    const limited = await post(state(), "limited-client");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal(fetchCount - before, 16);
  });
});

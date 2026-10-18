import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the real game functions with inert DOM and animation adapters so a
// complete two-minute session remains a fast, deterministic regression check.
const source = readFileSync(new URL("../game.js", import.meta.url), "utf8");
const engine = source.slice(0, source.indexOf('el("reset-button").addEventListener'));

function makeGame(fetch = async () => ({ ok: true, json: async () => ({ mode: "local" }) })) {
  const nodes = new Map();
  function node() {
    return {
      textContent: "", innerHTML: "", style: { setProperty() {} }, dataset: {}, disabled: false,
      classList: { toggle() {}, add() {}, remove() {} }, lastChild: { textContent: "" },
      setAttribute() {}, append() {}, replaceChildren() {}, insertAdjacentElement() {},
      remove() {}, querySelector: node, querySelectorAll: () => [],
      showModal() { this.open = true; }, close() { this.open = false; },
    };
  }
  const sandbox = {
    document: {
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
      createElement: node, createTextNode: (text) => ({ text }), querySelectorAll: () => [],
    },
    window: { setTimeout: () => 0, scrollTo() {} },
    clearTimeout() {}, performance: { now: () => 0 }, requestAnimationFrame() {},
    AbortController, fetch,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${engine}\nresetAgents();
    globalThis.game = { state, resetAll, startNewRun, frame, runAgent,
      startScheduledEvent, requestModes, checkApiStatus, nearestDeadline, nodes: agentNodes };
  `, sandbox);
  sandbox.game.elements = nodes;
  return sandbox.game;
}

function play(schedule) {
  const game = makeGame();
  game.resetAll();
  let cursor = 0;
  for (let tick = 1; tick <= 2402; tick += 1) {
    if (cursor < schedule.length && game.state.elapsed >= schedule[cursor]) {
      game.resetAll();
      cursor += 1;
    }
    game.frame(tick * 50);
  }
  return game;
}

test("spaced resets outperform immediately spending all tickets", () => {
  const unused = play([]).state;
  const rushed = play([0, 20.1, 40.2]).state;
  const planned = play([32, 65, 98]).state;
  assert.equal(planned.status, "finished");
  assert.equal(planned.resets, 3);
  assert.ok(planned.score > rushed.score, `${planned.score} vs ${rushed.score}`);
  assert.ok(planned.score > unused.score);
  assert.ok(unused.agents.every((agent) => agent.quota === 0), "an unaided city eventually stops");
  assert.ok(planned.completedEvents > unused.completedEvents);
});

test("cooldown prevents a second reset and exactly three charges are available", () => {
  const game = makeGame();
  game.resetAll();
  assert.equal(game.state.charges, 3, "starting is free");
  game.resetAll();
  game.resetAll();
  assert.equal(game.state.charges, 2);
  for (let tick = 1; tick <= 402; tick += 1) game.frame(tick * 50);
  assert.equal(game.state.cooldown, 0);
  game.resetAll();
  assert.equal(game.state.charges, 1);
  assert.equal(game.state.resetHistory.length, 2);
});

test("projects start at zero and upcoming starts do not masquerade as deadlines", () => {
  const game = makeGame();
  game.state.elapsed = 13;
  assert.equal(game.nearestDeadline("factory"), 107);
  game.state.elapsed = 14;
  game.startScheduledEvent();
  assert.equal(game.state.activeEvent.progress.factory, 0);
  assert.equal(game.state.activeEvent.progress.transit, 0);
  assert.equal(game.nearestDeadline("factory"), 23);
});

test("completed task log refers to the work actually finished", () => {
  const game = makeGame();
  const doctor = game.state.agents[0];
  const originalTask = doctor.task;
  doctor.taskProgress = 0.999;
  game.runAgent(doctor, 0.05, 1);
  assert.ok(game.state.messages.some((item) => item.text.includes(originalTask)));
  assert.notEqual(doctor.task, originalTask);
});

test("finishing leaves a working replay button even after the result dialog closes", () => {
  const game = play([32, 65, 98]);
  game.elements.get("result-dialog").close();
  assert.equal(game.elements.get("reset-button").disabled, false);
  game.resetAll();
  assert.equal(game.state.status, "running");
  assert.equal(game.state.charges, 3);
  assert.equal(game.state.run, 2);
});

test("configured is not live use; failed decisions recover on the next request", async () => {
  let calls = 0;
  const modes = Object.fromEntries(["medical", "transit", "factory", "delivery", "romance", "entertainment"].map((id) => [id, "standard"]));
  const game = makeGame(async (_, options) => ({ ok: true, json: async () => {
    if (!options?.method) return { mode: "configured" };
    calls += 1;
    return calls === 1 ? { mode: "fallback", modes } : { mode: "decisions", modes, decisionCount: 6 };
  } }));
  await game.checkApiStatus();
  assert.equal(game.state.apiDecisions, 0);
  assert.equal(game.state.apiMode, "available");
  game.state.status = "running";
  await game.requestModes(true);
  assert.equal(game.state.apiMode, "fallback");
  assert.equal(game.state.apiDecisions, 0);
  await game.requestModes(true);
  assert.equal(calls, 2);
  assert.equal(game.state.apiMode, "decisions");
  assert.equal(game.state.apiDecisions, 6);
});

test("incomplete purported AI choices cannot increase the live-use count", async () => {
  const game = makeGame(async () => ({ ok: true, json: async () => ({ mode: "decisions", modes: { medical: "sprint" } }) }));
  game.state.status = "running";
  game.state.apiConfigured = true;
  await game.requestModes(true);
  assert.equal(game.state.apiDecisions, 0);
  assert.equal(game.state.apiMode, "fallback");
});

if (process.env.REPORT_BALANCE === "1") {
  for (const resets of [[], [0, 20.1, 40.2], [25, 55, 85], [32, 65, 98], [38, 73, 105]]) {
    const { state } = play(resets);
    console.log(JSON.stringify({ resets, score: state.score, projects: state.completedEvents,
      uptime: Math.round(100 - state.agents.reduce((sum, a) => sum + a.stoppedFor, 0) / 7.2),
      efficiency: state.resets ? Math.round(state.resetHistory.reduce((sum, item) => sum + item.restored, 0) / (state.resets * 6)) : null }));
  }
}

const MODES = new Set(["conserve", "standard", "sprint"]);
const IDS = new Set(["medical", "transit", "factory", "delivery", "romance", "entertainment"]);
const EVENT_DEPARTMENTS = {
  bridge: ["factory", "transit"],
  emergency: ["medical"],
  market: ["delivery", "entertainment"],
  wedding: ["romance", "delivery"],
};
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 16;
const MAX_CLIENTS = 2_048;
const MAX_BODY_BYTES = 32_000;
const requestCounts = new Map();

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function cleanAgents(input) {
  if (!Array.isArray(input) || input.length !== IDS.size) return null;
  const found = new Set();
  const agents = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || !IDS.has(item.id) || found.has(item.id)) return null;
    found.add(item.id);
    if (!Number.isFinite(item.quota) || item.quota < 0 || item.quota > 100) return null;
    if (!Number.isFinite(item.taskProgress) || item.taskProgress < 0 || item.taskProgress > 1) return null;
    if (!Number.isFinite(item.deadlineSeconds) || item.deadlineSeconds < 0 || item.deadlineSeconds > 120) return null;
    agents.push({
      id: item.id,
      quota: Math.round(item.quota),
      taskProgress: Math.round(item.taskProgress * 100) / 100,
      deadlineSeconds: Math.round(item.deadlineSeconds),
    });
  }
  return found.size === IDS.size ? agents : null;
}

function localFallback(agents) {
  return Object.fromEntries(agents.map((agent) => {
    let mode = "standard";
    if (agent.quota < 24 || (agent.quota < 44 && agent.deadlineSeconds > 11)) mode = "conserve";
    else if (agent.deadlineSeconds <= 10 && agent.quota > 18) mode = "sprint";
    else if (agent.taskProgress > 0.83 && agent.quota > 40) mode = "sprint";
    return [agent.id, mode];
  }));
}

function cleanEvent(input) {
  if (input == null) return null;
  if (typeof input !== "object" || !Object.hasOwn(EVENT_DEPARTMENTS, input.id)) return false;
  const required = EVENT_DEPARTMENTS[input.id];
  if (!Array.isArray(input.requiredAgentIds) || input.requiredAgentIds.length !== required.length
    || required.some((id) => !input.requiredAgentIds.includes(id))) return false;
  if (!Number.isFinite(input.remainingSeconds) || input.remainingSeconds < 0 || input.remainingSeconds > 120) return false;
  let progress;
  if (input.progress !== undefined) {
    if (!input.progress || typeof input.progress !== "object" || Array.isArray(input.progress)
      || Object.keys(input.progress).length !== required.length
      || required.some((id) => !Number.isFinite(input.progress[id]) || input.progress[id] < 0 || input.progress[id] > 1)) return false;
    progress = Object.fromEntries(required.map((id) => [id, Math.round(input.progress[id] * 100) / 100]));
  }
  return { id: input.id, requiredAgentIds: required, remainingSeconds: Math.round(input.remainingSeconds), ...(progress ? { progress } : {}) };
}

function allowRequest(ip) {
  const now = Date.now();
  for (const [address, record] of requestCounts) {
    if (now - record.startedAt >= WINDOW_MS) requestCounts.delete(address);
  }
  const record = requestCounts.get(ip);
  if (!record) {
    if (requestCounts.size >= MAX_CLIENTS) return false;
    requestCounts.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (record.count >= MAX_PER_WINDOW) return false;
  record.count += 1;
  return true;
}

function cleanAnswers(result) {
  if (!Array.isArray(result?.answers) || result.answers.length !== IDS.size) return null;
  const modes = {};
  for (const answer of result.answers) {
    if (answer?.type !== "choice" || typeof answer.name !== "string" || !MODES.has(answer.choice)) return null;
    const match = /^mode_([a-z]+)$/.exec(answer.name);
    if (!match || !IDS.has(match[1]) || Object.hasOwn(modes, match[1])) return null;
    modes[match[1]] = answer.choice;
  }
  return modes;
}

function requestAddress(request) {
  // Only use the immediate peer address. X-Forwarded-For is client-spoofable
  // outside trusted hosting and must not grant a new anonymous quota.
  return request.ip || "local";
}

export async function handleDecision(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS" } });
  if (request.method === "GET") {
    return json({ mode: process.env.OPENAI_API_KEY?.trim() ? "configured" : "local" });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "GET, POST, OPTIONS" });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  let body;
  try {
    if (typeof request.body === "string" && Buffer.byteLength(request.body, "utf8") > MAX_BODY_BYTES) {
      return json({ error: "Request too large" }, 413);
    }
    body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const agents = cleanAgents(body?.agents);
  const event = cleanEvent(body?.event);
  const elapsed = body?.elapsed;
  if (!agents || event === false || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 120) return json({ error: "Invalid simulation state" }, 400);
  if (!apiKey) return json({ mode: "local", modes: localFallback(agents) });

  if (!allowRequest(requestAddress(request))) return json({ error: "Please wait before asking the agents again." }, 429, { "retry-after": "60" });

  const labels = {
    medical: "Medical rescue",
    transit: "Transit and signals",
    factory: "Factory and city building",
    delivery: "Food and package delivery",
    romance: "Social connection and community",
    entertainment: "Arts and recreation",
  };
  const personalities = {
    medical: "careful, with attention on the emergency in front of the clinic",
    transit: "cautious, with attention on keeping the whole city moving",
    factory: "ambitious, eager to finish the city's next landmark",
    delivery: "practical, focused on getting daily essentials to residents",
    romance: "optimistic, trying to bring neighbors together",
    entertainment: "playful, making time for rest and celebration",
  };
  const input = [
    "A six-agent city simulation. Choose one sustainable work mode for each department for the next ten seconds.",
    "The player controls only when to reset everyone's capacity; never choose a reset or alter game rules.",
    "Balance completing urgent work against keeping departments active for the remaining two-minute run. All departments share the player's limited reset opportunities, so avoid exhausting one department unnecessarily early.",
    "Relative capacity consumption is 0.48 for conserve, 1 for standard, and 1.72 for sprint. Work per second is 0.046, 0.077, and 0.125 respectively. Zero capacity stops work until the player resets it.",
    "Make each department's choice independently from the same observed city state; do not assume that another answer has already been chosen. Respect its role and personality. The fixed game engine calculates speed, capacity use, rewards, and failure.",
    event ? `Current city project: ${JSON.stringify(event)}. All listed departments must finish their required share before its timer expires; project progress takes priority over their routine tasks.` : "No timed city project is active. Departments' deadlines are the end of the run.",
    `Simulation elapsed: ${Math.round(elapsed)} seconds. Departments: ${agents.map((a) => `${labels[a.id]} (${personalities[a.id]}; id=${a.id}, capacity=${a.quota}%, task=${Math.round(a.taskProgress * 100)}%, deadline=${a.deadlineSeconds}s)`).join("; ")}`,
  ].join("\n");

  const questions = agents.map((agent) => ({
    type: "choice",
    name: `mode_${agent.id}`,
    instructions: `Select a work mode for ${labels[agent.id]} for the next ten seconds. Consider its role, remaining capacity (${agent.quota}%), progress, deadline (${agent.deadlineSeconds}s), and the other departments' observed capacity. Prioritize feasible urgent work without spending scarce capacity on work that can safely wait.`,
    choices: [
      { value: "conserve", description: "Preserve more capacity; complete work more slowly." },
      { value: "standard", description: "Balanced capacity use and progress." },
      { value: "sprint", description: "Complete work faster while using capacity much faster." },
    ],
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-6-luna", input, questions }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      console.error("Decisions API returned HTTP", response.status);
      return json({ mode: "fallback", reason: "upstream_error", modes: localFallback(agents) });
    }
    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      return json({ mode: "fallback", reason: "invalid_response", modes: localFallback(agents) });
    }
    const modes = cleanAnswers(result);
    if (!modes) return json({ mode: "fallback", reason: "invalid_response", modes: localFallback(agents) });
    return json({ mode: "decisions", decisionCount: IDS.size, modes });
  } catch (error) {
    const reason = controller.signal.aborted ? "timeout" : "network_error";
    console.error("Decisions API request failed", reason);
    return json({ mode: "fallback", reason, modes: localFallback(agents) });
  } finally {
    clearTimeout(timer);
  }
}

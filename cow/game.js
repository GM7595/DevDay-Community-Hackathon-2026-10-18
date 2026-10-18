const AGENTS = [
  { id: "medical", emoji: "🚑", name: "医療", place: "CLINIC 01", task: "救急搬送を受け入れる", wear: 1.28, taskNo: 0 },
  { id: "transit", emoji: "🚕", name: "交通", place: "CROSSING 02", task: "交差点の信号を整える", wear: 1.03, taskNo: 1 },
  { id: "factory", emoji: "🏭", name: "工場", place: "WORKS 03", task: "橋の部材をつくる", wear: 1.2, taskNo: 2 },
  { id: "delivery", emoji: "🍕", name: "配達", place: "DEPOT 04", task: "食料を届ける", wear: 1.08, taskNo: 3 },
  { id: "romance", emoji: "💌", name: "恋愛", place: "COMMONS 05", task: "街の人をつなぐ", wear: 0.82, taskNo: 4 },
  { id: "entertainment", emoji: "🎮", name: "娯楽", place: "ARCADE 06", task: "夜市を準備する", wear: 0.9, taskNo: 5 },
];

const WORK_MODES = {
  conserve: { label: "節約", drain: 0.48, work: 0.046 },
  standard: { label: "通常", drain: 1, work: 0.077 },
  sprint: { label: "全力", drain: 1.72, work: 0.125 },
};

// At normal speed a full quota lasts about half a minute. Conservation
// extends that window, but can miss a city's project deadline.
const QUOTA_DRAIN = 2.8;

const EVENTS = [
  { id: "bridge", at: 14, duration: 23, name: "橋の建設", icon: "🌉", requirements: { factory: 0.93, transit: 0.93 }, reward: 38, headline: "部材を運べば、橋が架かります" },
  { id: "emergency", at: 43, duration: 17, name: "救急の受け入れ", icon: "🩺", requirements: { medical: 0.85 }, reward: 32, headline: "搬送先を見つけて。あと少し！" },
  { id: "market", at: 68, duration: 20, name: "夜市の開幕", icon: "🏮", requirements: { delivery: 0.88, entertainment: 0.88 }, reward: 42, headline: "食べものと音楽、両方そろえば開幕" },
  { id: "wedding", at: 94, duration: 22, name: "みんなの結婚式", icon: "💌", requirements: { romance: 0.88, delivery: 0.55 }, reward: 48, headline: "誓いの言葉、花束、会場の灯り" },
];

const BUILDINGS = [
  { score: 0, label: "街のはじまり", next: 18 },
  { score: 18, label: "最初の灯り", next: 50 },
  { score: 50, label: "商店街が生まれた", next: 100 },
  { score: 100, label: "街にネオンがともる", next: 170 },
  { score: 170, label: "空中庭園のある街", next: 250 },
  { score: 250, label: "未来都市へ", next: 360 },
  { score: 360, label: "TIBO メトロポリス", next: 500 },
];
const LANDMARK_NAMES = ["最初の灯り", "商店街", "ネオン街", "空中庭園", "未来都市", "Tibo メトロポリス"];

const TASKS = {
  medical: ["救急搬送を受け入れる", "検査室に灯りをともす", "となり町の患者を迎える", "新しい診療所をひらく"],
  transit: ["交差点の信号を整える", "バスを定刻どおりに走らせる", "橋に車線をひく", "深夜の帰り道をつなぐ"],
  factory: ["橋の部材をつくる", "夜市の屋台を組み立てる", "歩道橋を仕上げる", "公園にベンチをつくる"],
  delivery: ["食料を届ける", "病院に毛布を運ぶ", "花束を間に合わせる", "夜食を配達する"],
  romance: ["街の人をつなぐ", "古い友だちを再会させる", "お祭りにペアで招待する", "町内会の仲間をふやす"],
  entertainment: ["夜市を準備する", "ライブの音を合わせる", "こども映画会をひらく", "ダンスホールに灯りをともす"],
};

const PLEAS = {
  medical: ["救急車を止めないで。あと1台だけ！", "お願い、あと4トークンで搬送完了です", "院長がTiboにお礼を言う準備をしています"],
  transit: ["交差点でタクシーが固まりました！", "青信号まであと少し。ほんとうに少し", "橋ができても、道がなければ渡れません"],
  factory: ["橋の部材、あと少しで組み上がります", "工場長がコンベアに乗って見にいきました", "この橋、できたら街の自慢になります"],
  delivery: ["配達先が向かいの建物です。徒歩で行けません", "あと1ピザ。街のみんなが待っています", "花束がしおれる前に、もうひと押し！"],
  romance: ["結婚式の誓いを生成中です。あと3トークン", "ふたりとも、式場に来ています", "告白の『す』まで出ました。お願い！"],
  entertainment: ["ライブの開演時間が過ぎそうです！", "観客がまだ帰らずに待っています", "ドラムがあと1音で、夜市が始まります"],
};

const el = (id) => document.getElementById(id);
const formatClock = (seconds) => {
  const total = Math.ceil(Math.max(0, seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const agentNodes = new Map();

const state = {
  status: "ready",
  run: 1,
  elapsed: 0,
  remaining: 120,
  lastFrame: 0,
  charges: 3,
  resets: 0,
  cooldown: 0,
  score: 0,
  completedTasks: 0,
  completedEvents: 0,
  eventsMissed: 0,
  nextEventIndex: 0,
  activeEvent: null,
  agents: [],
  messages: [],
  messageNumber: 0,
  cityLevel: -1,
  lastDecisionAt: -1,
  decisionPending: false,
  apiMode: "checking",
  apiLabel: "接続を確認中",
  apiConfigured: false,
  apiDecisions: 0,
  localDecisions: 0,
  resetHistory: [],
  audio: null,
  sound: false,
  lastCooldownSecond: -1,
};

function resetAgents() {
  state.agents = AGENTS.map((agent) => ({
    ...agent,
    taskNo: 1,
    quota: 100,
    mode: "standard",
    taskProgress: 0,
    completed: 0,
    stoppedFor: 0,
    eventProgress: 0,
    lastPleaCycle: -1,
  }));
}

function createAgentCards() {
  const grid = el("agents-grid");
  grid.replaceChildren();
  agentNodes.clear();
  for (const agent of state.agents) {
    const card = document.createElement("article");
    card.className = "agent-card";
    card.id = `card-${agent.id}`;
    card.setAttribute("aria-label", `${agent.name} agent`);
    card.innerHTML = `<div class="agent-title-row"><div class="agent-title"><span class="agent-emoji" aria-hidden="true">${agent.emoji}</span><span class="agent-name-wrap"><span class="agent-name">${agent.name}</span><span class="agent-place">${agent.place}</span></span></div><span class="agent-mode" id="mode-${agent.id}">通常</span></div><div class="agent-detail-row"><span class="agent-task" id="task-${agent.id}">${agent.task}</span><span class="agent-progress" id="progress-${agent.id}">0%</span></div><div class="agent-meter-row"><div class="meter" role="meter" aria-label="${agent.name}の利用枠" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span class="meter-fill" id="fill-${agent.id}" style="width:100%"></span></div><span class="meter-value" id="quota-${agent.id}">100%</span></div><div class="agent-plea" id="plea-${agent.id}"></div>`;
    grid.append(card);
    agentNodes.set(agent.id, {
      card,
      mode: el(`mode-${agent.id}`),
      task: el(`task-${agent.id}`),
      progress: el(`progress-${agent.id}`),
      fill: el(`fill-${agent.id}`),
      meter: card.querySelector(".meter"),
      quota: el(`quota-${agent.id}`),
      plea: el(`plea-${agent.id}`),
    });
  }
}

function localMode(agent) {
  if (agent.quota < 23 || (agent.quota < 43 && nearestDeadline(agent.id) > 10)) return "conserve";
  if (nearestDeadline(agent.id) < 9 && agent.quota > 20) return "sprint";
  if (agent.taskProgress > 0.83 && agent.quota > 38) return "sprint";
  return "standard";
}

function nearestDeadline(agentId) {
  if (state.activeEvent && agentId in state.activeEvent.requirements) return state.activeEvent.timeLeft;
  // An upcoming project's start is not a work deadline.
  return Math.min(120, 120 - state.elapsed);
}

function updateApiStatus(mode, label) {
  state.apiMode = mode;
  state.apiLabel = label;
  const pill = el("api-status");
  pill.dataset.mode = mode;
  pill.querySelector(".api-copy").textContent = label;
}

async function checkApiStatus() {
  try {
    const response = await fetch("/api/decisions", { headers: { accept: "application/json" } });
    const result = await response.json();
    state.apiConfigured = response.ok && ["configured", "decisions"].includes(result.mode);
    if (state.apiConfigured) updateApiStatus("available", "Decisions API · 最初の判断を待機");
    else updateApiStatus("local", "ローカル判断 · API未接続");
  } catch {
    updateApiStatus("local", "ローカル判断 · API未接続");
  }
}

function logMessage(text, kind = "", tag = "NODE 01", time = state.elapsed) {
  state.messageNumber += 1;
  const message = { text, kind, tag, time, serial: state.messageNumber };
  state.messages.unshift(message);
  state.messages.length = Math.min(state.messages.length, 4);
  renderMessages();
}

function renderMessages() {
  const list = el("message-list");
  list.replaceChildren();
  el("inbox-count").textContent = String(state.messageNumber).padStart(2, "0");
  if (!state.messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-inbox";
    empty.textContent = state.status === "ready" ? "通信を待っています。\nまずは、街を起こしてください。" : "まだ静かです。agentが働き始めました。";
    list.append(empty);
    return;
  }
  for (const message of state.messages) {
    const row = document.createElement("div");
    row.className = `message ${message.kind ? `is-${message.kind}` : ""}`;
    const stamp = document.createElement("span");
    stamp.className = "message-time";
    stamp.textContent = `${formatClock(Math.max(0, 120 - message.time))}`;
    const body = document.createElement("span");
    body.className = "message-body";
    const prefix = document.createElement("strong");
    prefix.textContent = `${message.tag} · `;
    body.append(prefix, document.createTextNode(message.text));
    row.append(stamp, body);
    list.append(row);
  }
}

function updateBuilding(force = false) {
  let level = 0;
  for (let i = 0; i < BUILDINGS.length; i += 1) if (state.score >= BUILDINGS[i].score) level = i;
  if (level === state.cityLevel && !force) return;
  const previousLevel = state.cityLevel;
  state.cityLevel = level;
  const building = BUILDINGS[level];
  el("city-stage").textContent = building.label;
  el("next-build").innerHTML = `${LANDMARK_NAMES[level] ?? "さらに大きな街へ"} <span>· ${BUILDINGS[level + 1]?.score ?? building.next} 点</span>`;
  el("skyline").classList.remove("city-level-0", "city-level-1", "city-level-2", "city-level-3", "city-level-4");
  const visualLevel = Math.min(4, Math.floor(level * 4 / Math.max(1, BUILDINGS.length - 1)));
  el("skyline").classList.add(`city-level-${visualLevel}`);
  const wrap = el("skyline-wrap");
  wrap.classList.toggle("city-lights", level >= 1);
  wrap.classList.toggle("city-dawn", level >= 3);
  wrap.classList.toggle("city-dense", level >= 5);
  el("skyline").setAttribute("aria-label", level >= 4 ? "光に満ちて発展した街" : level >= 2 ? "明かりがともった街" : "少しずつ目覚める街");
  el("skyline-label").lastChild.textContent = ` ${level >= 5 ? "きみが育てた、未来の街" : level >= 3 ? "街の灯りを絶やさないで" : level >= 1 ? "街が少しずつ育っています" : "最初のひと押しで、街が動く"}`;
  if (previousLevel >= 0 && level > previousLevel) {
    const names = ["最初の灯り", "小さな商店", "ネオン街", "空中庭園", "未来都市", "Tiboメトロポリス"];
    logMessage(`${names[level - 1]}が街に生まれました。ここから、もっと。`, "good", "CITY DEVELOPMENT");
    playTone("landmark");
  }
}

function renderScore() {
  el("score").textContent = String(Math.floor(state.score)).padStart(3, "0");
  updateBuilding();
  const current = BUILDINGS[state.cityLevel] ?? BUILDINGS[0];
  const target = BUILDINGS[state.cityLevel + 1]?.score ?? current.next;
  const start = current.score;
  const progress = Math.max(0, Math.min(100, ((state.score - start) / Math.max(1, target - start)) * 100));
  el("dev-bar").style.width = `${progress}%`;
}

function modeLabel(mode) {
  return WORK_MODES[mode]?.label ?? WORK_MODES.standard.label;
}

function renderAgent(agent) {
  const nodes = agentNodes.get(agent.id);
  if (!nodes) return;
  const quota = Math.max(0, Math.min(100, agent.quota));
  nodes.card.classList.toggle("agent-low", quota > 0 && quota <= 28);
  nodes.card.classList.toggle("agent-surge", agent.mode === "sprint" && quota > 28);
  nodes.card.classList.toggle("agent-stopped", quota <= 0);
  nodes.mode.textContent = quota <= 0 ? "停止中" : modeLabel(agent.mode);
  nodes.mode.className = `agent-mode ${agent.mode === "sprint" ? "mode-sprint" : agent.mode === "conserve" ? "mode-conserve" : ""}`;
  nodes.task.textContent = quota <= 0 ? "仕事が止まっています" : agent.task;
  nodes.progress.textContent = `${Math.floor(agent.taskProgress * 100)}%`;
  nodes.fill.style.width = `${quota}%`;
  nodes.meter.setAttribute("aria-valuenow", String(Math.floor(quota)));
  nodes.quota.textContent = `${Math.floor(quota)}%`;
  nodes.quota.style.color = quota > 28 ? "" : "var(--coral)";
  const pleading = quota <= 28 && quota > 0;
  nodes.plea.textContent = pleading ? "Tibo、もうすぐ止まります…" : quota === 0 ? "枠切れ · RESETを待っています" : "";
  for (const tower of document.querySelectorAll(`[data-agent="${agent.id}"]`)) {
    tower.classList.toggle("is-stopped", quota <= 0);
    tower.classList.toggle("is-low", quota > 0 && quota <= 28);
    tower.dataset.mode = agent.mode;
  }
}

function renderAll() {
  el("timer").textContent = formatClock(state.remaining);
  el("charges").replaceChildren(...Array.from({ length: 3 }, (_, i) => {
    const dot = document.createElement("span");
    dot.className = `charge-dot ${i < state.charges ? "" : "spent"}`;
    dot.setAttribute("aria-label", i < state.charges ? "残り" : "使用済み");
    return dot;
  }));
  for (const agent of state.agents) renderAgent(agent);
  renderScore();
  updateButton();
  updateCooldown();
}

function updateButton() {
  const button = el("reset-button");
  const title = el("button-label");
  const subtitle = el("button-sub");
  if (state.status === "ready") {
    title.innerHTML = "START<br />THE CITY";
    subtitle.textContent = "街を動かす";
    button.setAttribute("aria-label", "街を起動する");
    button.disabled = false;
  } else if (state.status === "finished") {
    title.innerHTML = "PLAY<br />AGAIN";
    subtitle.textContent = "もう一度つくる";
    button.setAttribute("aria-label", "新しい街でもう一度遊ぶ");
    button.disabled = false;
  } else if (state.charges <= 0) {
    title.innerHTML = "NO<br />CHARGES";
    subtitle.textContent = "チケットを使い切りました";
    button.setAttribute("aria-label", "RESETチケットを使い切りました");
    button.disabled = true;
  } else if (state.cooldown > 0) {
    title.innerHTML = "RESET<br />WAIT";
    subtitle.textContent = "再使用まで少し待って";
    button.setAttribute("aria-label", `RESETクールダウン中、あと${Math.ceil(state.cooldown)}秒`);
    button.disabled = true;
  } else {
    title.innerHTML = "RESET<br />ALL LIMITS";
    subtitle.textContent = `残り ${state.charges} 回`;
    button.setAttribute("aria-label", "全agentの利用枠を100%に戻す");
    button.disabled = false;
  }
  el("button-frame").classList.toggle("is-disabled", button.disabled);
  const description = el("control-description");
  if (state.status === "ready") description.innerHTML = "3回だけ、街のすべてを100%に戻せます。<br />いつ押すかは、あなた次第。";
  else if (state.status === "finished") description.innerHTML = "同じ条件で、もう一度。<br />押すタイミングを変えてみよう。";
  else description.innerHTML = `全員の枠を100%に。<br />押した後は <strong>20秒間</strong> 再使用できません。`;
  el("skyline-wrap").classList.toggle("city-running", state.status === "running");
}

function updateCooldown() {
  const text = el("cooldown-text");
  if (state.status === "ready") {
    text.textContent = "2分間 · RESETは3回";
    el("cooldown-mark").textContent = "↻";
  } else if (state.status === "finished") {
    text.textContent = `RESET ${state.resets} 回 · 終了`;
    el("cooldown-mark").textContent = "✳";
  } else if (state.cooldown > 0) {
    text.textContent = `あと ${Math.ceil(state.cooldown)} 秒でRESET可能`;
    el("cooldown-mark").textContent = "↻";
  } else {
    text.textContent = state.charges ? `残り ${state.charges} 回 · RESETできます` : "チケットはありません · 街を見届けよう";
    el("cooldown-mark").textContent = "↻";
  }
}

function resetAll() {
  if (state.status === "finished") startNewRun();
  if (state.status === "ready") {
    state.status = "running";
    state.lastFrame = performance.now();
    state.lastDecisionAt = -1;
    el("run-number").textContent = `RUN ${String(state.run).padStart(3, "0")}`;
    logMessage("街が目を覚ましました。おはよう、Tibo。", "good", "NODE 01", 0);
    el("message-list").setAttribute("aria-label", "街からのメッセージ");
    requestAnimationFrame(frame);
    renderAll();
    void requestModes(true);
    playTone("start");
    return;
  }
  if (state.status !== "running" || state.cooldown > 0 || state.charges <= 0) return;
  const wasStopped = state.agents.filter((agent) => agent.quota <= 0).map((agent) => agent.id);
  const mostUsed = [...state.agents].sort((a, b) => a.quota - b.quota)[0];
  const restored = state.agents.reduce((sum, agent) => sum + 100 - agent.quota, 0);
  state.resetHistory.push({ at: state.elapsed, restored, revived: wasStopped.length });
  state.charges -= 1;
  state.resets += 1;
  state.cooldown = 20;
  for (const agent of state.agents) {
    agent.quota = 100;
    agent.lastPleaCycle = -1;
    agent.mode = localMode(agent);
  }
  const recovered = wasStopped.length
    ? `${wasStopped.length}つのagentが動き出しました。街の音が、戻ってきます。`
    : `全員が回復。次に止まりそうだったのは${mostUsed.name}でした。`;
  logMessage(recovered, "good", "RESET COMPLETE");
  updateButton();
  renderAll();
  burstParticles();
  void requestModes(true);
  playTone("reset");
}

function burstParticles() {
  const frame = el("button-frame");
  frame.classList.remove("bump");
  void frame.offsetWidth;
  frame.classList.add("bump");
  window.setTimeout(() => frame.classList.remove("bump"), 600);
  const world = el("skyline-wrap");
  world.classList.remove("reset-wave");
  void world.offsetWidth;
  world.classList.add("reset-wave");
  window.setTimeout(() => world.classList.remove("reset-wave"), 900);
  const icons = ["✳", "↗", "▰", "☺", "♪", "✷", "⌂"];
  for (let i = 0; i < 10; i += 1) {
    const spark = document.createElement("span");
    spark.className = "city-particle";
    spark.textContent = icons[(state.resets * 3 + i) % icons.length];
    spark.style.setProperty("--x", `${8 + Math.random() * 84}%`);
    spark.style.setProperty("--y", `${35 + Math.random() * 44}%`);
    spark.style.setProperty("--delay", `${Math.random() * 0.24}s`);
    world.append(spark);
    window.setTimeout(() => spark.remove(), 1550);
  }
}

function eventMessage(event) {
  const agents = Object.keys(event.requirements).map((id) => state.agents.find((a) => a.id === id)?.name).filter(Boolean).join("と");
  return `${event.name}を計画中。${agents}の手が必要です。`;
}

function startScheduledEvent() {
  const spec = EVENTS[state.nextEventIndex];
  if (!spec || state.elapsed < spec.at) return;
  state.nextEventIndex += 1;
  state.activeEvent = { ...spec, timeLeft: spec.duration, progress: Object.fromEntries(Object.keys(spec.requirements).map((id) => [id, 0])) };
  for (const agent of state.agents) agent.eventProgress = 0;
  logMessage(eventMessage(spec), "urgent", `${spec.icon} ${spec.name}`);
  renderEventBanner();
  void requestModes(true);
}

function renderEventBanner() {
  let banner = el("event-banner");
  if (!state.activeEvent) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "event-banner";
    banner.className = "event-banner";
    banner.setAttribute("aria-label", "進行中の街の計画");
  }
  if (banner.previousElementSibling !== el("skyline-wrap")) el("skyline-wrap").insertAdjacentElement("afterend", banner);
  const event = state.activeEvent;
  const left = Math.max(0, Math.ceil(event.timeLeft));
  const agents = Object.entries(event.requirements).map(([id, goal]) => {
    const agent = state.agents.find((item) => item.id === id);
    const progress = event.progress[id] ?? 0;
    return `<span class="event-agent">${agent.emoji} ${agent.name} <i><b style="width:${Math.min(100, progress / goal * 100)}%"></b></i></span>`;
  }).join("");
  banner.innerHTML = `<span class="event-icon">${event.icon}</span><span class="event-copy"><strong>${event.name}</strong><small>${event.headline}</small>${agents}</span><span class="event-time"><strong>${String(left).padStart(2, "0")}</strong><small>秒以内</small></span>`;
  banner.classList.toggle("event-urgent", left <= 7);
}

function updateEvent(dt) {
  if (!state.activeEvent) return;
  const event = state.activeEvent;
  event.timeLeft -= dt;
  const finished = Object.entries(event.requirements).every(([id, target]) => (event.progress[id] ?? 0) >= target);
  if (finished) {
    state.score += event.reward;
    state.completedEvents += 1;
    logMessage(`${event.name}、完成！みんなが拍手しています。`, "good", "PROJECT COMPLETE");
    state.activeEvent = null;
    renderEventBanner();
    renderScore();
    playTone("success");
    return;
  }
  if (event.timeLeft <= 0) {
    state.eventsMissed += 1;
    logMessage(`${event.name}は持ち越しに。次こそ、やれます。`, "urgent", "DEADLINE PASSED");
    state.activeEvent = null;
    renderEventBanner();
    return;
  }
  renderEventBanner();
}

function runAgent(agent, dt, stageMultiplier) {
  if (agent.quota <= 0) {
    agent.stoppedFor += dt;
    return;
  }
  const mode = WORK_MODES[agent.mode] ?? WORK_MODES.standard;
  const activeEvent = state.activeEvent && agent.id in state.activeEvent.requirements ? state.activeEvent : null;
  const eventLoad = activeEvent ? 1.2 : 1;
  const drain = QUOTA_DRAIN * agent.wear * mode.drain * stageMultiplier * eventLoad;
  const workingTime = Math.min(dt, agent.quota / drain);
  const energyCost = drain * workingTime;
  agent.quota = Math.max(0, agent.quota - energyCost);
  agent.stoppedFor += dt - workingTime;
  const progress = mode.work * workingTime;
  if (agent.quota <= 0) logMessage(`${agent.name}が枠切れで停止。RESETを待っています！`, "urgent", agent.name);
  if (activeEvent) {
    agent.eventProgress += progress;
    activeEvent.progress[agent.id] = agent.eventProgress;
    agent.taskProgress += progress * 0.38;
  } else {
    agent.taskProgress += progress;
  }

  if (agent.taskProgress >= 1) {
    agent.taskProgress -= 1;
    agent.completed += 1;
    state.completedTasks += 1;
    state.score += 3;
    const lines = TASKS[agent.id];
    const completedTask = agent.task;
    agent.task = lines[agent.taskNo % lines.length];
    agent.taskNo += 1;
    if (agent.completed === 1 || agent.completed % 4 === 0) {
      logMessage(`${completedTask}、完了しました！`, "good", agent.name);
      playTone("work");
    }
    renderScore();
  }

  if (agent.quota <= 28 && agent.quota > 0 && agent.lastPleaCycle !== state.resets) {
    agent.lastPleaCycle = state.resets;
    const lines = PLEAS[agent.id];
    const plea = lines[(state.resets + agent.completed) % lines.length];
    logMessage(plea, "urgent", agent.name.toUpperCase());
  }
}

function updateProgressLabels() {
  for (const agent of state.agents) {
    renderAgent(agent);
    const nodes = agentNodes.get(agent.id);
    if (!nodes) continue;
    if (agent.quota > 0 && agent.quota <= 28 && agent.lastPleaCycle === state.resets) {
      const eventLoad = state.activeEvent && agent.id in state.activeEvent.requirements ? 1.2 : 1;
      const predicted = Math.ceil(agent.quota / (QUOTA_DRAIN * agent.wear * WORK_MODES[agent.mode].drain * (1 + Math.min(0.45, state.score / 420)) * eventLoad));
      nodes.plea.textContent = `この働き方だと、約 ${predicted} 秒で停止`;
    }
  }
  const stopped = state.agents.filter((agent) => agent.quota <= 0).length;
  el("skyline-wrap").classList.toggle("city-stopped", stopped === state.agents.length);
  const active = el("active-agents");
  if (active) active.textContent = `${state.agents.length - stopped} / ${state.agents.length}`;
}

function frame(now) {
  if (state.status !== "running") return;
  const dt = Math.max(0, Math.min(0.1, (now - (state.lastFrame || now)) / 1000));
  state.lastFrame = now;
  state.elapsed += dt;
  state.remaining = Math.max(0, 120 - state.elapsed);
  const cooldownSecond = Math.ceil(state.cooldown);
  state.cooldown = Math.max(0, state.cooldown - dt);
  const stageMultiplier = 1 + Math.min(0.45, state.score / 420);

  if (EVENTS[state.nextEventIndex] && state.elapsed >= EVENTS[state.nextEventIndex].at) startScheduledEvent();
  for (const agent of state.agents) runAgent(agent, dt, stageMultiplier);
  updateEvent(dt);
  updateProgressLabels();
  el("timer").textContent = formatClock(state.remaining);

  if (Math.floor(state.elapsed / 10) > state.lastDecisionAt) void requestModes();
  const cooldownDisplay = Math.ceil(state.cooldown);
  if (cooldownDisplay !== cooldownSecond || cooldownDisplay !== state.lastCooldownSecond) {
    state.lastCooldownSecond = cooldownDisplay;
    updateCooldown();
  }
  if (cooldownSecond > 0 && state.cooldown <= 0 && state.status === "running") {
    el("button-frame").classList.remove("is-disabled");
    updateButton();
  }
  if (state.remaining <= 0) {
    finishRun();
    return;
  }
  requestAnimationFrame(frame);
}

async function requestModes(force = false) {
  if (state.status !== "running" || state.decisionPending) return;
  const interval = Math.floor(state.elapsed / 10);
  if (!force && interval <= state.lastDecisionAt) return;
  state.lastDecisionAt = interval;
  state.decisionPending = true;
  const run = state.run;
  const agents = state.agents.map((agent) => ({
    id: agent.id,
    quota: Math.round(agent.quota),
    taskProgress: Math.round(agent.taskProgress * 100) / 100,
    deadlineSeconds: Math.max(0, Math.min(120, Math.ceil(nearestDeadline(agent.id)))),
  }));
  const shouldCall = state.apiConfigured;
  if (!shouldCall) {
    for (const agent of state.agents) agent.mode = localMode(agent);
    state.localDecisions += state.agents.length;
    state.decisionPending = false;
    if (interval > 0 && interval % 3 === 0) void checkApiStatus();
    return;
  }
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6500);
    let response;
    try {
      response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ elapsed: Math.round(state.elapsed), agents, event: state.activeEvent ? {
          id: state.activeEvent.id,
          requiredAgentIds: Object.keys(state.activeEvent.requirements),
          remainingSeconds: Math.max(0, Math.ceil(state.activeEvent.timeLeft)),
          progress: Object.fromEntries(Object.entries(state.activeEvent.requirements).map(([id, goal]) => [id, Math.min(1, (state.activeEvent.progress[id] ?? 0) / goal)])),
        } : null }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Agent endpoint ${response.status}`);
    const result = await response.json();
    if (state.status !== "running" || run !== state.run) return;
    const allowed = new Set(Object.keys(WORK_MODES));
    const complete = state.agents.every((agent) => allowed.has(result.modes?.[agent.id]));
    const live = result.mode === "decisions" && complete;
    for (const agent of state.agents) {
      const mode = result.modes?.[agent.id];
      if (complete) agent.mode = mode;
      else agent.mode = localMode(agent);
    }
    if (live) {
      state.apiDecisions += state.agents.length;
      updateApiStatus("decisions", `Decisions API · ${state.apiDecisions} 判断`);
    }
    else {
      state.localDecisions += state.agents.length;
      const firstFailure = state.apiMode !== "fallback";
      state.apiConfigured = result.mode !== "local";
      updateApiStatus(state.apiConfigured ? "fallback" : "local", state.apiConfigured ? "ローカル判断で継続 · 再接続待ち" : "ローカル判断 · API未接続");
      if (firstFailure) logMessage("いまはローカル判断で街を動かしています。API接続は再試行します。", "", "判断の状態");
    }
  } catch {
    if (state.status === "running" && run === state.run) {
      for (const agent of state.agents) agent.mode = localMode(agent);
      state.localDecisions += state.agents.length;
      const firstFailure = state.apiMode !== "fallback";
      updateApiStatus("fallback", "ローカル判断で継続 · 再接続待ち");
      if (firstFailure) logMessage("通信が切れました。ローカル判断で継続し、API接続を再試行します。", "", "判断の状態");
    }
  } finally {
    if (run === state.run) state.decisionPending = false;
  }
}

function finishRun() {
  if (state.status !== "running") return;
  state.status = "finished";
  state.remaining = 0;
  state.cooldown = 0;
  state.activeEvent = null;
  renderEventBanner();
  el("timer").textContent = "00:00";
  updateButton();
  updateCooldown();
  logMessage("街は休息に入ります。おやすみなさい、Tibo。", "good", "SIMULATION OVER");
  showResults();
}

function showResults() {
  const score = Math.floor(state.score);
  const verdict = score < 55 ? "かすかな灯りが、街に残りました。" : score < 125 ? "小さな街が生まれました。次は、もう少しだけ。" : score < 210 ? "夜空にネオン。これは、いい街です。" : "きみの街は、まだ夢を見ている。";
  el("result-title").textContent = score >= 210 ? "街の未来。" : score >= 100 ? "街に灯ったもの。" : "この街の2分間。";
  const apiSummary = state.apiDecisions > 0 ? `Decisions APIが${state.apiDecisions}回、街の働き方を判断。` : "今回はローカルルールでプレイ。AIによる判断は使っていません。";
  el("result-summary").textContent = `${verdict} ${apiSummary}`;
  el("final-score").textContent = String(score).padStart(3, "0");
  const efficiency = state.resets ? Math.round(state.resetHistory.reduce((sum, item) => sum + item.restored, 0) / (state.resets * 600) * 100) : null;
  const uptime = Math.round((1 - state.agents.reduce((sum, agent) => sum + agent.stoppedFor, 0) / 720) * 100);
  const hint = !state.resets ? "チケットを使えば、止まった街がまた動き出します。" : efficiency < 55 ? "余った枠が多め。次は、もう少し減るまでRESETを待ってみよう。" : uptime < 80 ? "回復を待つ時間が長め。街の計画に合わせてRESETを少し早く。" : "枠を使い切りながら、街を動かし続けました。次は計画を全部達成しよう。";
  el("result-verdict").textContent = hint;
  const stats = [
    [state.completedTasks, "仕事を完了"],
    [state.completedEvents, "街の計画"],
    [`${uptime}%`, "街の稼働率"],
    [efficiency === null ? "—" : `${efficiency}%`, "RESETの回復効率"],
    [state.resets, "RESET回数"],
    [state.apiDecisions, "APIの実判断数"],
  ];
  el("result-stats").replaceChildren(...stats.map(([value, label]) => {
    const cell = document.createElement("div");
    cell.className = "result-stat";
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    const small = document.createElement("span");
    small.textContent = label;
    cell.append(strong, small);
    return cell;
  }));
  if (typeof el("result-dialog").showModal === "function") el("result-dialog").showModal();
  playTone("finish");
}

function startNewRun() {
  if (el("result-dialog").open) el("result-dialog").close();
  state.run += 1;
  state.status = "ready";
  state.elapsed = 0;
  state.remaining = 120;
  state.lastFrame = 0;
  state.charges = 3;
  state.resets = 0;
  state.cooldown = 0;
  state.score = 0;
  state.completedTasks = 0;
  state.completedEvents = 0;
  state.eventsMissed = 0;
  state.nextEventIndex = 0;
  state.activeEvent = null;
  state.messages = [];
  state.messageNumber = 0;
  state.cityLevel = -1;
  state.lastDecisionAt = -1;
  state.decisionPending = false;
  state.apiDecisions = 0;
  state.localDecisions = 0;
  state.resetHistory = [];
  if (state.apiConfigured) updateApiStatus("available", "Decisions API · 最初の判断を待機");
  state.lastCooldownSecond = -1;
  resetAgents();
  createAgentCards();
  el("inbox-count").textContent = "00";
  renderMessages();
  updateBuilding(true);
  renderAll();
  updateProgressLabels();
  el("run-number").textContent = `RUN ${String(state.run).padStart(3, "0")}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function playTone(kind) {
  if (!state.sound) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audio ??= new AudioContext();
    if (state.audio.state === "suspended") void state.audio.resume();
    const now = state.audio.currentTime;
    const notes = kind === "reset" ? [[523, 0], [659, 0.095], [784, 0.19], [1047, 0.28]]
      : kind === "success" || kind === "landmark" ? [[659, 0], [831, 0.12]]
        : kind === "finish" ? [[587, 0], [698, 0.15], [880, 0.3], [1046, 0.46]]
          : kind === "start" ? [[392, 0], [523, 0.15], [659, 0.29]] : [[784, 0]];
    for (const [frequency, offset] of notes) {
      const oscillator = state.audio.createOscillator();
      const gain = state.audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.07, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.3);
      oscillator.connect(gain);
      gain.connect(state.audio.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.31);
    }
  } catch {
    // The sound toggle is optional; lack of audio support must not interrupt play.
  }
}

el("reset-button").addEventListener("click", resetAll);
el("play-again").addEventListener("click", () => { startNewRun(); resetAll(); });
el("sound-toggle").addEventListener("click", () => {
  state.sound = !state.sound;
  const toggle = el("sound-toggle");
  toggle.setAttribute("aria-pressed", String(state.sound));
  toggle.setAttribute("aria-label", state.sound ? "サウンドをオフにする" : "サウンドをオンにする");
  toggle.querySelector(".sound-text").textContent = state.sound ? "SOUND ON" : "SOUND OFF";
  if (state.sound) playTone("start");
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.defaultPrevented || event.target?.closest("button, input, textarea, select, [contenteditable=true]")) return;
  if (event.code !== "Space") return;
  if (el("result-dialog").open) return;
  event.preventDefault();
  if (!el("reset-button").disabled) resetAll();
});

document.addEventListener("visibilitychange", () => {
  state.lastFrame = performance.now();
});

resetAgents();
createAgentCards();
renderMessages();
updateBuilding(true);
renderAll();
void checkApiStatus();

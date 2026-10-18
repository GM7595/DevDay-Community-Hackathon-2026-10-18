import { createCivilization, changePolicy, projectCivilization, rebirthCivilization, POLICIES, ERAS } from "./engine.js";
import { createScene } from "./scene.js";

const STORAGE_KEY = "tibo-civilization:v1";
const HOUR = 3_600_000;
const DEMO_SECONDS = 120;
const DEMO_HOURS_PER_SECOND = 3;
const RESET_HOURS = [96, 192, 288];

function validJournal(value) {
  if (!value || value.version !== 1 || typeof value.id !== "string" || !value.id
    || typeof value.name !== "string" || value.name.length > 64
    || !Number.isInteger(value.generation) || value.generation < 1
    || !Number.isFinite(value.createdAt) || value.createdAt < 0
    || !Array.isArray(value.policyChanges) || !value.policyChanges.length || value.policyChanges.length > 10000
    || !value.policyChanges.every((item) => Number.isFinite(item?.at) && item.at >= value.createdAt && Object.hasOwn(POLICIES, item.policy))
    || !Array.isArray(value.notices) || value.notices.length > 10000
    || !value.notices.every((item) => typeof item?.eventId === "string" && Number.isFinite(item.publishedAt) && item.publishedAt >= 0)
    || !Array.isArray(value.ancestors) || !Array.isArray(value.consumedSeedEventIds)
    || !value.consumedSeedEventIds.every((id) => typeof id === "string")
    || !Number.isFinite(value.confirmedThrough) || value.confirmedThrough < value.createdAt) return false;
  return true;
}

function duration(hours) {
  if (!Number.isFinite(hours)) return "確認中";
  const totalMinutes = Math.max(0, Math.ceil(hours * 60));
  if (totalMinutes === 0) return "0時間";
  const days = Math.floor(totalMinutes / 1440);
  const remainingHours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}日${remainingHours ? ` ${remainingHours}時間` : ""}`;
  if (remainingHours) return `${remainingHours}時間${minutes ? ` ${minutes}分` : ""}`;
  return `${minutes}分`;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `civilization-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeSourceUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

/**
 * Mounts a local-first civilization. The caller owns fetching and normalization.
 * snapshot: { notices, confirmedThrough, status, forecast }; no key is needed.
 */
export function mountCivilization(element, { snapshot = null, assetBase = new URL("../assets/", import.meta.url).href } = {}) {
  if (!element || typeof element.attachShadow !== "function") throw new TypeError("A host element is required");
  const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  if (root.childElementCount) throw new Error("The civilization host is already mounted");
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = new URL("./widget.css", import.meta.url).href;
  root.append(style);
  const card = document.createElement("section");
  card.className = "cv-card";
  card.setAttribute("aria-label", "tiboっち civilization");
  card.innerHTML = `<div class="cv-top"><div><p class="cv-kicker"><i aria-hidden="true"></i><span data-mode-label>このブラウザの文明</span></p><h2 class="cv-title" data-era>石器時代</h2><p class="cv-subtitle">働き方を選んで、TiboのRESETと暮らそう。</p></div><div class="cv-era-badge" aria-label="文明レベル"><span>LEVEL</span><strong data-level>01</strong></div></div>
    <div class="cv-name"><strong data-name>小さな文明</strong><small data-generation>1代目</small><details class="name-details"><summary>名前をつける</summary><form class="name-form"><label for="civilization-name">あなたの文明の名前</label><input id="civilization-name" name="name" maxlength="24" autocomplete="off" placeholder="小さな文明"/><button type="submit">保存</button></form></details></div>
    <div class="demo-strip" hidden><strong>SAMPLE</strong><span>1秒＝3時間 · 実際の文明とは別の体験</span><button type="button" data-return>自分の文明へ</button></div>
    <div class="cv-scene"></div><div class="cv-body">
      <div class="cv-readouts"><div><span class="readout-label"><span class="label-icon" aria-hidden="true">◉</span>街の利用枠</span><strong class="quota-value"><span data-quota>100</span><small>%</small></strong><div class="quota-track" role="meter" aria-label="街の利用枠" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span data-quota-bar></span></div></div><div><span class="readout-label" data-time-label>この働き方で動ける時間</span><strong class="time-value" data-time>5日</strong><p class="time-caption" data-time-caption>枠が0になると、街はいったん停止。</p></div></div>
      <div class="era-progress"><span data-era-next>次は、農耕時代</span><strong data-research>0 / 2</strong><div class="era-track" role="progressbar" aria-label="次の時代への発展" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><b data-era-bar></b></div></div>
      <fieldset class="cv-policy"><legend>みんなの働き方</legend><div class="policy-choices"><button class="policy-button" data-policy="conserve" type="button" aria-pressed="false"><strong>🌱 節約</strong><span>満タンで7日</span><small>発展 ×0.35</small></button><button class="policy-button" data-policy="normal" type="button" aria-pressed="true"><strong>☀ ふつう</strong><span>満タンで5日</span><small>発展 ×1.0</small></button><button class="policy-button" data-policy="sprint" type="button" aria-pressed="false"><strong>⚡ 全力</strong><span>満タンで3日</span><small>発展 ×1.6</small></button></div><p class="policy-help" data-policy-help>発展と持久力を、ほどよく両立。迷ったら、ふつうで。</p></fieldset>
      <div class="cv-notice" data-tone="normal"><span class="notice-icon" aria-hidden="true">↻</span><div class="notice-content"><p class="notice-title" data-notice-title>RESETのお知らせを待っています</p><p class="notice-copy" data-notice-copy>告知を確認できると、街の枠が100%に戻ります。</p></div></div>
      <button class="rebirth-button" data-rebirth type="button" hidden>新しい文明をはじめる</button>
      <section class="demo-result" aria-label="体験結果" hidden><h3 data-result-title>体験の結果</h3><p data-result-copy></p><div class="demo-result-stats"><div><strong data-result-era></strong><span>たどり着いた時代</span></div><div><strong data-result-days></strong><span>文明が続いた時間</span></div></div></section>
      <div class="cv-bottom"><button class="demo-launch" data-demo type="button"><span aria-hidden="true">▶</span><span data-demo-label>2分で体験する</span></button><span class="save-note" data-save>このブラウザに自動保存<br/>閉じている間も、時間が進みます。</span></div>
      <div class="demo-settings"><label for="demo-scenario">体験シナリオ</label><select id="demo-scenario"><option value="regular">4日ごとにサンプルRESET</option><option value="none">RESETが来なかったら？</option></select><span class="demo-clock" data-demo-clock hidden>00:00 / 02:00</span></div><div class="demo-timeline" hidden><span></span></div>
      <p class="cv-footnote">ゲーム内の利用枠です。実際のCodex利用枠は変更しません。RESETの時期は未確定です。枠切れから24時間で文明は終わりますが、告知を確認できない間は確定しません。</p>
      <p class="sr-only" data-announcement role="status" aria-live="polite"></p>
    </div>`;
  root.append(card);
  const find = (selector) => card.querySelector(selector);
  const nodes = {
    mode: find("[data-mode-label]"), era: find("[data-era]"), level: find("[data-level]"), name: find("[data-name]"), generation: find("[data-generation]"),
    quota: find("[data-quota]"), quotaBar: find("[data-quota-bar]"), meter: find(".quota-track"), timeLabel: find("[data-time-label]"), time: find("[data-time]"), timeCaption: find("[data-time-caption]"),
    next: find("[data-era-next]"), research: find("[data-research]"), eraBar: find("[data-era-bar]"), progress: find(".era-track"), policy: [...card.querySelectorAll(".policy-button")], policyHelp: find("[data-policy-help]"),
    notice: find(".cv-notice"), noticeTitle: find("[data-notice-title]"), noticeCopy: find("[data-notice-copy]"), rebirth: find("[data-rebirth]"), save: find("[data-save]"), announcement: find("[data-announcement]"),
    nameDetails: find(".name-details"), nameInput: find(".name-form input"), demoStrip: find(".demo-strip"), demoLabel: find("[data-demo-label]"), scenario: find("#demo-scenario"), demoClock: find("[data-demo-clock]"), demoTimeline: find(".demo-timeline"),
    result: find(".demo-result"), resultTitle: find("[data-result-title]"), resultCopy: find("[data-result-copy]"), resultEra: find("[data-result-era]"), resultDays: find("[data-result-days]"),
  };
  const scene = createScene(find(".cv-scene"), { avatarUrl: new URL("tibo-avatar.jpg", assetBase).href });
  let feed = snapshot;
  let destroyed = false;
  let storageAvailable = true;
  let storageCorrupt = false;
  let storageRaw = null;
  let journal = null;
  let demo = null;
  let seenResetIds = null;
  let previousStatus = null;
  let latestProjection = null;
  let lastNoticeKey = null;
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: cleanup.signal });
  const cleanup = new AbortController();

  function readStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === storageRaw) return;
      const previousRaw = storageRaw;
      storageRaw = raw;
      if (!raw) {
        if (previousRaw !== null && journal) journal = createCivilization({ id: newId(), name: "小さな文明", now: Date.now() });
        storageCorrupt = false;
        return;
      }
      let parsed;
      try { parsed = JSON.parse(raw); } catch { storageCorrupt = true; return; }
      if (!validJournal(parsed)) { storageCorrupt = true; return; }
      journal = parsed;
      storageCorrupt = false;
    } catch { storageAvailable = false; }
  }

  function saveJournal() {
    if (!storageAvailable || storageCorrupt) return;
    try {
      const serialized = JSON.stringify(journal);
      if (serialized === storageRaw) return;
      localStorage.setItem(STORAGE_KEY, serialized);
      storageRaw = serialized;
    } catch { storageAvailable = false; }
  }

  readStored();
  journal ??= createCivilization({ id: newId(), name: "小さな文明", now: Date.now() });
  saveJournal();

  function realOptions() {
    return { notices: Array.isArray(feed?.notices) ? feed.notices : [], confirmedThrough: Number.isFinite(feed?.confirmedThrough) ? feed.confirmedThrough : null };
  }

  function currentNow() { return demo ? demo.epoch + demo.elapsed * DEMO_HOURS_PER_SECOND * HOUR : Math.max(Date.now(), journal.createdAt); }

  function demoOptions() {
    const now = currentNow();
    return { notices: demo.scenario === "regular" ? RESET_HOURS.filter((hour) => demo.epoch + hour * HOUR <= now).map((hour) => ({ eventId: `sample-reset-${hour}`, publishedAt: demo.epoch + hour * HOUR, sourceUrl: "" })) : [], confirmedThrough: now };
  }

  function project() {
    if (demo) {
      const projection = projectCivilization(demo.journal, currentNow(), demoOptions());
      demo.journal = projection.journal;
      return projection;
    }
    readStored();
    const projection = projectCivilization(journal, currentNow(), realOptions());
    journal = projection.journal;
    saveJournal();
    return projection;
  }

  function announce(text) { nodes.announcement.textContent = text; }

  function renderNotice(projection) {
    const state = projection.status;
    const isSample = Boolean(demo);
    const key = [state, demo?.scenario, feed?.status, Math.ceil(projection.extinctionInHours * 60), projection.rebirthAvailable, projection.lastResetAt, projection.appliedNoticeIds.join(",")].join("|");
    if (key === lastNoticeKey) return;
    lastNoticeKey = key;
    nodes.notice.dataset.tone = state === "alive" ? "normal" : "warning";
    if (state === "extinct") {
      nodes.noticeTitle.textContent = "この文明は、役目を終えました。";
      nodes.noticeCopy.textContent = projection.rebirthAvailable ? "新しいRESETの告知が届いています。次の文明を、ここからはじめられます。" : isSample ? "枠切れから24時間、RESETが来ませんでした。働き方を変えて、もう一度試せます。" : "新しいRESETの告知が届くと、次の文明をはじめられます。";
    } else if (state === "pending") {
      nodes.noticeTitle.textContent = "告知を確認できるまで、結末は保留。";
      nodes.noticeCopy.textContent = "取得できていないRESETがあるかもしれません。接続が戻ると、告知時刻から街の時間を計算し直します。";
    } else if (state === "stopped") {
      nodes.noticeTitle.textContent = "Tibo、枠ください。街が止まっています。";
      nodes.noticeCopy.textContent = `RESETなしで終わるまで、あと${duration(projection.extinctionInHours)}。働き方を変えても枠は回復しません。`;
    } else if (isSample) {
      nodes.noticeTitle.textContent = demo.scenario === "regular" ? "サンプルRESETは、4・8・12日目。" : "今回は、RESETが来ない世界。";
      nodes.noticeCopy.textContent = "この体験だけの架空の告知です。現実のRESET予定ではありません。働き方を変えて、街の未来を比べよう。";
    } else if (feed?.status === "gap" || feed?.status === "unverified") {
      nodes.noticeTitle.textContent = "投稿履歴に、まだ確認できていない期間があります。";
      nodes.noticeCopy.textContent = "確認できたRESETは反映します。履歴の空白が埋まるまで、文明が終わったとは確定しません。";
    } else if (!feed || ["waiting", "error", "offline", "stale", "unavailable"].includes(feed.status)) {
      nodes.noticeTitle.textContent = "RESETのお知らせを確認しています。";
      nodes.noticeCopy.textContent = "初回の枠100%で、街はもう動いています。告知が確認できると自動で100%に回復します。";
    } else if (projection.lastResetAt) {
      nodes.noticeTitle.textContent = "確認できたRESETで、枠を回復しました。";
      nodes.noticeCopy.textContent = "次のRESET時刻は未確定です。同じ告知で何度も回復することはありません。";
      const source = [...(projection.journal.notices ?? [])].reverse().find((notice) => projection.appliedNoticeIds.includes(notice.eventId));
      const url = safeSourceUrl(source?.sourceUrl);
      if (url) {
        const link = document.createElement("a");
        link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = " 確認した告知 ↗";
        nodes.noticeCopy.append(link);
      }
    } else {
      nodes.noticeTitle.textContent = "次のRESETは、まだ未確定。";
      nodes.noticeCopy.textContent = "確認された新しい告知が届くと、枠が自動で100%へ。待っている間も、この街は発展します。";
    }
  }

  function render() {
    if (destroyed) return;
    const projection = project();
    latestProjection = projection;
    const activeJournal = demo?.journal ?? journal;
    const eraIndex = Math.max(0, ERAS.findIndex((era) => era.id === projection.era.id));
    const ids = new Set(projection.appliedNoticeIds);
    if (seenResetIds && [...ids].some((id) => !seenResetIds.has(id))) { scene.celebrate(); announce(demo ? "サンプルRESETで、街の枠が100%に戻りました。" : "確認されたRESETで、街の枠が100%に戻りました。"); }
    seenResetIds = ids;
    if (previousStatus && previousStatus !== projection.status) announce({ alive: "街が動き出しました。", stopped: "枠切れで街が停止しました。", pending: "告知の確認を待っています。", extinct: "この文明の時間が終わりました。" }[projection.status]);
    previousStatus = projection.status;
    scene.update(projection, eraIndex, Boolean(demo));
    nodes.mode.textContent = demo ? "体験用の文明 · 自分の街には影響しません" : "このブラウザの文明";
    nodes.era.textContent = projection.era.label;
    nodes.level.textContent = String(eraIndex + 1).padStart(2, "0");
    nodes.name.textContent = demo ? "体験の島" : activeJournal.name;
    nodes.generation.textContent = `${activeJournal.generation}代目`;
    nodes.nameDetails.hidden = Boolean(demo);
    nodes.demoStrip.hidden = !demo;
    nodes.quota.textContent = String(Math.ceil(projection.quota));
    nodes.quotaBar.style.width = `${projection.quota}%`;
    nodes.meter.setAttribute("aria-valuenow", String(Math.round(projection.quota)));
    nodes.meter.classList.toggle("is-low", projection.quota <= 25);
    nodes.timeLabel.textContent = projection.status === "stopped" ? "RESETなしで終わるまで" : projection.status === "extinct" ? "この文明が続いた時間" : projection.status === "pending" ? "告知の確認待ち" : "この働き方で動ける時間";
    nodes.time.textContent = projection.status === "pending" ? "結末は保留" : duration(projection.status === "extinct" ? projection.survivalHours : projection.status === "stopped" ? projection.extinctionInHours : projection.remainingHours);
    nodes.timeCaption.textContent = projection.status === "alive" ? "枠が0になると、街はいったん停止。" : projection.status === "stopped" ? "その間にRESETが来れば、また動けます。" : projection.status === "pending" ? "記録を残して、接続を待っています。" : "思い出は残ります。次のRESETを待とう。";
    nodes.next.textContent = projection.nextEra ? `次は、${projection.nextEra.label}` : "未来文明に到達！";
    nodes.research.textContent = projection.nextEra ? `${Math.floor(projection.research)} / ${projection.nextEra.research}` : `${Math.floor(projection.research)} 発展`;
    nodes.eraBar.style.width = `${projection.nextEra ? projection.eraProgress * 100 : 100}%`;
    nodes.progress.setAttribute("aria-valuenow", String(Math.round(projection.nextEra ? projection.eraProgress * 100 : 100)));
    for (const button of nodes.policy) { button.setAttribute("aria-pressed", String(button.dataset.policy === projection.policy)); button.disabled = projection.status === "extinct" || Boolean(demo?.finished); }
    nodes.policyHelp.textContent = { conserve: "長く続けることを大切に。発展はゆっくりですが、満タンなら7日動けます。", normal: "発展と持久力を、ほどよく両立。迷ったら、ふつうで。", sprint: "発展を急ぐぶん、3日で枠切れ。次のRESETに間に合うかが勝負です。" }[projection.policy];
    renderNotice(projection);
    nodes.rebirth.hidden = !projection.rebirthAvailable || Boolean(demo);
    nodes.save.classList.toggle("is-warning", !storageAvailable || storageCorrupt);
    nodes.save.textContent = demo ? "体験の結果は保存されません。" : storageCorrupt ? "保存データを読み取れません。元の記録は保護しています。" : !storageAvailable ? "保存できません。このページを閉じると記録が失われます。" : "このブラウザに自動保存 · 閉じている間も時間が進みます。";
    nodes.demoLabel.textContent = demo ? demo.finished ? "もう一度体験する" : "体験を最初から" : "2分で体験する";
    nodes.scenario.disabled = Boolean(demo && !demo.finished);
    nodes.demoClock.hidden = !demo;
    nodes.demoTimeline.hidden = !demo;
    if (demo) {
      const seconds = Math.floor(demo.elapsed);
      nodes.demoClock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} / 02:00`;
      nodes.demoTimeline.firstElementChild.style.width = `${demo.elapsed / DEMO_SECONDS * 100}%`;
    }
    nodes.result.hidden = !demo?.finished;
    if (demo?.finished) {
      nodes.resultTitle.textContent = projection.status === "extinct" ? "この働き方では、RESETを待ちきれませんでした。" : "15日間で、ここまで育ちました。";
      nodes.resultCopy.textContent = projection.status === "extinct" ? "次は節約で長く待つ？ それとも、次のRESETまで一気に発展させる？ この体験は、自分の文明の記録には影響しません。" : `${demo.scenario === "regular" ? "3回のサンプルRESETと一緒に、" : "RESETを待ちながら、"}小さな街の時間が進みました。現実の告知時刻は決まっていません。働き方を変えて比べてみよう。`;
      nodes.resultEra.textContent = projection.era.label;
      nodes.resultDays.textContent = duration(projection.survivalHours);
    }
  }

  function startDemo() {
    const policy = latestProjection?.policy ?? "normal";
    const epoch = Date.now();
    let sample = createCivilization({ id: "sample-civilization", name: "体験の島", now: epoch });
    sample = changePolicy(sample, policy, epoch);
    demo = { epoch, journal: sample, elapsed: 0, started: performance.now(), finished: false, scenario: nodes.scenario.value, pausedAt: null };
    seenResetIds = new Set(); previousStatus = null;
    render();
    announce("体験モードを始めました。1秒で3時間進みます。実際の文明には影響しません。");
  }

  function leaveDemo() {
    demo = null; seenResetIds = null; previousStatus = null;
    render(); announce("このブラウザの文明に戻りました。");
  }

  on(find("[data-demo]"), "click", startDemo);
  on(find("[data-return]"), "click", leaveDemo);
  for (const button of nodes.policy) on(button, "click", () => {
    if (demo?.finished) return;
    if (!demo) readStored();
    const now = currentNow();
    if (demo) demo.journal = changePolicy(demo.journal, button.dataset.policy, now);
    else { journal = changePolicy(projectCivilization(journal, now, realOptions()).journal, button.dataset.policy, now); saveJournal(); }
    render(); announce(`${POLICIES[button.dataset.policy].label}に切り替えました。`);
  });
  on(nodes.rebirth, "click", () => {
    if (demo) return;
    readStored(); journal = rebirthCivilization(journal, currentNow(), realOptions()); saveJournal(); seenResetIds = null; render(); announce("新しい文明がはじまりました。");
  });
  on(find(".name-form"), "submit", (event) => {
    event.preventDefault();
    if (demo) return;
    readStored();
    const name = nodes.nameInput.value.trim().slice(0, 24);
    if (!name) { nodes.nameInput.focus(); return; }
    journal = { ...journal, name }; saveJournal(); nodes.nameDetails.open = false; render(); nodes.nameDetails.querySelector("summary").focus(); announce(`文明の名前を「${name}」にしました。`);
  });
  on(nodes.nameDetails, "toggle", () => { if (nodes.nameDetails.open) { nodes.nameInput.value = journal.name; nodes.nameInput.focus(); } });
  on(window, "storage", (event) => { if (event.key === STORAGE_KEY || event.key === null) { readStored(); if (!demo) render(); } });
  on(document, "visibilitychange", () => {
    if (!demo || demo.finished) { if (!document.hidden) render(); return; }
    if (document.hidden) demo.pausedAt = performance.now();
    else if (demo.pausedAt !== null) { demo.started += performance.now() - demo.pausedAt; demo.pausedAt = null; }
  });
  const timer = setInterval(() => {
    if (destroyed || document.hidden) return;
    if (demo && !demo.finished) {
      demo.elapsed = Math.min(DEMO_SECONDS, Math.max(0, (performance.now() - demo.started) / 1000));
      if (demo.elapsed >= DEMO_SECONDS) demo.finished = true;
    }
    render();
    if (demo && !demo.finished && latestProjection.status === "extinct") { demo.finished = true; render(); announce("体験が終わりました。結果を表示しています。"); }
  }, 1000);
  render();
  return {
    updateSnapshot(next) { feed = next; if (!demo) render(); },
    getCreatedAt() { readStored(); return journal.createdAt; },
    destroy() { destroyed = true; clearInterval(timer); cleanup.abort(); scene.destroy(); root.replaceChildren(); },
  };
}

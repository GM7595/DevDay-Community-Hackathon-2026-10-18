import { mountCivilization } from './widget.js';
import { normalizeResetFeed } from './reset-feed.js';
import { deriveForecastView } from './forecast-view.js';

// Read the same public snapshot as Reset Watch. No API keys or additional model calls.
const host = document.getElementById('tibo-civilization');
const cacheKey = 'tibo-civilization-feed-v1';
let previous = null;
let initializedAt = Date.now();
let latestReport = null;
function renderForecast(report) {
  const value = document.querySelector('[data-forecast-value]');
  if (!value) return;
  const view = deriveForecastView(report, Date.now());
  value.textContent = view.probability === null ? '—' : String(Math.round(view.probability * 100)).padStart(2, '0');
  value.parentElement.setAttribute('aria-label', view.probability === null ? 'リセット確率は現在確認できません' : `24時間以内のリセット確率 ${Math.round(view.probability * 100)}パーセント`);
  document.querySelector('[data-forecast-label]').textContent = view.label;
  document.querySelector('[data-forecast-confidence]').textContent = `信頼度 ${view.confidence === null ? '—' : `${Math.round(view.confidence * 100)}%`} · 根拠の充足度 / 的中率ではありません`;
  document.querySelector('[data-forecast-updated]').textContent = view.asOf === null ? '予測データを取得できません' : `解析 ${new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit' }).format(view.asOf)} JST · 未校正の予測`;
  document.querySelector('.forecast-hero').dataset.state = view.status;
}
try {
  const saved = JSON.parse(localStorage.getItem(cacheKey) || 'null');
  if (saved?.version === 1 && Number.isFinite(saved.initializedAt)) {
    initializedAt = Math.min(saved.initializedAt, initializedAt);
    previous = saved.feed;
  }
} catch { /* The game remains playable when storage is unavailable. */ }

if (host) {
  const motionToggle = document.querySelector('[data-motion-toggle]');
  motionToggle?.addEventListener('click', () => {
    const paused = motionToggle.getAttribute('aria-pressed') !== 'true';
    motionToggle.setAttribute('aria-pressed', String(paused));
    motionToggle.setAttribute('aria-label', paused ? 'アニメーションを再開' : 'アニメーションを停止');
    motionToggle.textContent = paused ? '▶' : 'Ⅱ';
    document.documentElement.style.setProperty('--cv-play-state', paused ? 'paused' : 'running');
  });
  const widget = mountCivilization(host, {
    snapshot: previous ? { ...previous, status: 'unavailable' } : null,
    assetBase: host.dataset.assetBase ? new URL(host.dataset.assetBase, location.href).href : new URL('./', import.meta.url).href,
  });
  let loading = false;
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const response = await fetch(host.dataset.snapshotUrl || '/snapshot.json', {
        cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('Snapshot unavailable');
      latestReport = await response.json();
      renderForecast(latestReport);
      const feed = normalizeResetFeed(latestReport, {
        now: Date.now(), previous, createdAt: widget.getCreatedAt(),
      });
      initializedAt = widget.getCreatedAt();
      previous = feed;
      widget.updateSnapshot(feed);
      try { localStorage.setItem(cacheKey, JSON.stringify({ version: 1, initializedAt, feed })); } catch { /* Optional cache. */ }
    } catch {
      latestReport = null;
      renderForecast(null);
      widget.updateSnapshot({ ...previous, status: 'unavailable' });
    } finally { loading = false; }
  }
  refresh();
  const timer = setInterval(() => { renderForecast(latestReport); refresh(); }, 60000);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
}

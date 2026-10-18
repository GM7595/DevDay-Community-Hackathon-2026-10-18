import React, { useEffect, useMemo, useRef, useState } from 'react';
import snapshot from './site/server/seed.json';
import { percentLabel, plotLayout, timelineSeries } from './site/public/timeline-model.js';

export default function ResetWatchCanvas() {
  const [query, setQuery] = useState('');
  const [onlySignals, setOnlySignals] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState('auto');
  const [width, setWidth] = useState(650);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(250, entry.contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const entries = useMemo(() => snapshot.evidence.filter((entry) =>
    (!onlySignals || (entry.signalProbability ?? 0) >= 0.5) &&
    entry.post.text.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.signalProbability ?? -1) - (a.signalProbability ?? -1)), [query, onlySignals]);
  const points = timelineSeries(snapshot, entries);
  const selected = points.find((point) => point.id === selectedId) ?? [...points].sort((a, b) =>
    (b.probability ?? -1) - (a.probability ?? -1))[0];
  const chart = plotLayout(points, width, 285, scale);
  let connected = false;
  const path = points.map((point) => {
    if (point.probability === null) { connected = false; return ''; }
    const command = `${connected ? 'L' : 'M'}${chart.x(point.time)},${chart.y(point.probability)}`;
    connected = true; return command;
  }).join(' ');
  const date = (value: number) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const expired = Date.now() > Date.parse(snapshot.deadline);
  const raw = snapshot.rawModelProbability === null ? '—' : `${Math.round(snapshot.rawModelProbability * 100)}%`;
  return <main style={{ background: '#0a0a0d', color: '#f4f4ef', padding: 28, fontFamily: 'system-ui, sans-serif', borderRadius: 12 }}>
    <header style={{ display: 'flex', gap: 16, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
      <h1 style={{ fontSize: 25, margin: 0, color: "#d5ff43" }}>TIBO.RESET?</h1>
      <a href="https://tibo-reset-watch.soumame.chatgpt.site" target="_blank" rel="noreferrer">サイトを開く ↗</a>
    </header>
    <section style={{ background: '#1d1728', padding: 22, borderRadius: 10, margin: '24px 0' }}>
      <img src="https://pbs.twimg.com/profile_images/2093807917833281537/2yBgpwVV_400x400.jpg" alt="Tibo" width={150} height={150} style={{ float: "right", borderRadius: 16, transform: "rotate(6deg)", border: "4px solid #d5ff43" }} /><p style={{ margin: 0 }}>CODEX · NEXT 24H</p>
      <strong style={{ fontSize: 82, fontWeight: 900, color: '#d5ff43' }}>{expired ? '期間終了' : raw}</strong>
      <p style={{ margin: '8px 0' }}>{expired ? '期間終了' : '参考値 · 根拠不足 · 未校正'}</p>
      <small>{snapshot.asOf} → {snapshot.deadline}</small>
    </section>
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
      <label>本文を検索 <input value={query} onChange={(event) => setQuery(event.target.value)} style={{ font: 'inherit', padding: 8, marginLeft: 8, maxWidth: '100%' }} /></label>
      <label><input type="checkbox" checked={onlySignals} onChange={(event) => setOnlySignals(event.target.checked)} /> 示唆確率50%以上</label>
      <span>{entries.length}件</span>
    </div>
    <p style={{ fontSize: 12, color: "#a99db8" }}>投稿シグナル ↗</p>
    <label>縦軸 <select value={scale} onChange={(event) => setScale(event.target.value)} style={{ font: 'inherit', padding: 6 }}><option value="auto">値に合わせて拡大</option><option value="full">0〜100%</option></select> 0〜{percentLabel(chart.yMax)}</label>
    <div ref={container} style={{ width: '100%', marginTop: 16 }}>
      <svg viewBox={`0 0 ${width} 285`} width="100%" height={285} role="group" aria-label="投稿と確率の時系列グラフ。左右キーで点を選択" tabIndex={0} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !selected) return;
        event.preventDefault();
        const index = points.findIndex((point) => point.id === selected.id);
        const next = points[Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))];
        if (next) setSelectedId(next.id);
      }}>
        <title>投稿日時とリセットの発表・示唆を含む確率</title>
        {[0, 1, 2, 3, 4].map((i) => <g key={i}>
          <line x1={chart.margin.left} x2={width - chart.margin.right} y1={chart.y(i * chart.yMax / 4)} y2={chart.y(i * chart.yMax / 4)} stroke="#34303f" />
          <text x={chart.margin.left - 8} y={chart.y(i * chart.yMax / 4) + 4} textAnchor="end" fontSize={11} fill="#a99db8">{percentLabel(i * chart.yMax / 4)}</text>
        </g>)}
        <path d={path} fill="none" stroke="#d5ff43" strokeWidth={1.8} />
        {chart.measured.map((point) => <circle key={point.id} cx={point.x} cy={point.y} r={point.id === selected?.id ? 7 : 4}
          fill={point.id === selected?.id ? '#ffffff' : point.entry?.signalKind === 'completed' ? '#ff5dc8' : '#d5ff43'} stroke="#17151c" strokeWidth={1.3}
          onClick={() => setSelectedId(point.id)} style={{ cursor: 'pointer' }}><title>{date(point.time)} / {percentLabel(point.probability)}</title></circle>)}
        <text x={chart.margin.left} y={278} fontSize={11} fill="#a99db8">{date(chart.minTime)}</text>
        <text x={width - chart.margin.right} y={278} textAnchor="end" fontSize={11} fill="#a99db8">{date(chart.maxTime)} JST</text>
      </svg>
    </div>
    <label style={{ display: 'block', margin: '14px 0' }}>投稿を選択 <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} style={{ font: 'inherit', padding: 8, width: '100%', marginTop: 6 }}>
      {points.map((point) => <option key={point.id} value={point.id}>{date(point.time)} · {percentLabel(point.probability)} · {point.entry.post.text.slice(0, 50)}</option>)}
    </select></label>
    {entries.filter((entry) => entry.post.id === selected?.id).map((entry) => <article key={entry.post.id} style={{ padding: '18px 0', borderTop: '1px solid #34303f' }}>
      <div style={{ display: 'flex', gap: 20, justifyContent: 'space-between', alignItems: 'baseline' }}>
        <a href={entry.post.url} target="_blank" rel="noreferrer">@{entry.post.author} ↗</a>
        <strong>{entry.signalProbability === null ? '未解析' : `${Math.round(entry.signalProbability * 100)}%`}</strong>
      </div>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8, fontSize: 14 }}>{entry.post.text}</p>
      <small>{entry.post.createdAt}</small>
    </article>)}
    {!entries.length && <p>条件に合う投稿はありません。</p>}
    <p style={{ fontSize: 12 }}>保存データ · 最新の予測はサイトへ ↗</p>
  </main>;
}

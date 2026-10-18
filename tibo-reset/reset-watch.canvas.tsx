import React, { useMemo, useState } from 'react';
import saved from './data/visual-snapshot.json';
import { publicSnapshot, signalHeat, timingView } from './site/public/model.js';

const snapshot = publicSnapshot(saved);
export default function ResetWatchCanvas() {
  const [query, setQuery] = useState('');
  const [hotOnly, setHotOnly] = useState(false);
  const [paused, setPaused] = useState(false);
  const timing = timingView(snapshot);
  const posts = useMemo(() => snapshot.evidence.filter(entry =>
    (!hotOnly || (entry.signalProbability ?? 0) >= .5) && entry.post.text.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.signalProbability ?? -1) - (a.signalProbability ?? -1)), [query, hotOnly]);
  return <main className={`reset-canvas ${paused ? 'paused' : ''}`}>
    <style>{`
      .reset-canvas{padding:28px;background:#0a0a0d;color:#f4f4ef;font:14px system-ui;border-radius:16px}
      .reset-canvas a{color:#d5ff43}.reset-canvas header,.reset-canvas nav{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap;align-items:center}
      .reset-canvas h1{color:#d5ff43;font-size:23px}.reset-canvas button,.reset-canvas input{font:inherit;color:inherit;background:#22212b;border:1px solid #4c4059;padding:10px;border-radius:8px}
      .canvas-hero{padding:28px 0;display:flex;justify-content:space-between;gap:20px;align-items:center}.canvas-eta{font-size:clamp(28px,5vw,48px);display:block;line-height:1.4;margin:20px 0;color:#d5ff43}.canvas-hero p{color:#a99db8;font-size:12px}
      .canvas-face{width:140px;height:170px;object-fit:cover;border:5px solid #f4efe4;border-radius:12px;transform:rotate(6deg);box-shadow:8px 8px #d5ff43}
      .canvas-posts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:18px;margin-top:22px;align-items:start}
      .canvas-post{padding:22px;border:1px solid var(--color);border-radius:12px;background:linear-gradient(145deg,color-mix(in srgb,var(--color) 9%,#141219),#111115)}
      .canvas-post[data-hot=true]{animation:canvas-glow 3s ease-in-out infinite}.canvas-post p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;font-size:12px}
      .canvas-post img{width:100%;max-height:220px;object-fit:contain;background:#08080c;border-radius:8px}.canvas-score{font-size:45px;color:var(--color);display:block;margin-top:18px;font-weight:900}
      .reset-canvas small{font-size:10px;color:#a99db8}.canvas-track{height:5px;background:#ffffff15;margin:12px 0}.canvas-track span{display:block;height:100%;background:var(--color)}
      .reset-canvas.paused *{animation-play-state:paused!important}@keyframes canvas-glow{50%{box-shadow:0 0 25px color-mix(in srgb,var(--color) 35%,transparent)}}
      @media(prefers-reduced-motion:reduce){.canvas-post{animation:none!important}}@media(max-width:480px){.canvas-face{width:90px;height:120px}.reset-canvas{padding:18px}}
    `}</style>
    <header><h1>↻ TIBO.RESET?</h1><a href="https://tibo-reset-watch.soumame.chatgpt.site" target="_blank" rel="noreferrer">LIVE SITE ↗</a></header>
    <section className="canvas-hero"><div><small>CODEX · RESET ETA</small><strong className="canvas-eta">{timing.label}</strong><p>{timing.note}</p><small>NEXT 24H · {snapshot.rawModelProbability === null ? '—' : `${Math.round(snapshot.rawModelProbability * 100)}%`} · 推測含む</small><p style={{fontSize:10}}>信頼度 {snapshot.forecastConfidence === null ? "—" : `${Math.round(snapshot.forecastConfidence * 100)}%`}</p></div><img className="canvas-face" src="https://pbs.twimg.com/profile_images/2093807917833281537/2yBgpwVV_400x400.jpg" alt="Tibo" /></section>
    <nav><input value={query} onChange={event => setQuery(event.target.value)} aria-label="投稿を検索" placeholder="検索 ⌕" /><label><input type="checkbox" checked={hotOnly} onChange={event => setHotOnly(event.target.checked)} /> HOT ≥50%</label><button onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? '再開 ▷' : '停止 Ⅱ'}</button></nav>
    <section className="canvas-posts">{posts.slice(0, 30).map(entry => {
      const heat = signalHeat(entry.signalProbability);
      return <article className="canvas-post" key={entry.post.id} data-hot={heat.value >= .7} style={{'--color':heat.color} as React.CSSProperties}>
        <a href={entry.post.url} target="_blank" rel="noreferrer">@{entry.post.author} ↗</a><p>{entry.post.text}</p>
        {entry.post.media.filter(item => item.url).map(item => <img key={item.key ?? item.url} src={item.url!} alt={item.altText || '投稿画像'} loading="lazy" />)}
        <strong className="canvas-score">{entry.signalProbability === null ? '—' : `${Math.round(entry.signalProbability * 100)}%`}</strong>
        <div className="canvas-track"><span style={{width:`${(entry.signalProbability ?? 0)*100}%`}} /></div><small>{entry.signalStatus === 'image_unavailable' ? '画像未解析' : '投稿シグナル · 本文＋画像＋文脈'}</small>
      </article>;
    })}</section>
    <p><small>保存データ · 最新の予測は LIVE SITE へ</small></p>
  </main>;
}

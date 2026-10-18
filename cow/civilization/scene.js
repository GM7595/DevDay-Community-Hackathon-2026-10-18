function building(x, y, width, height, color, tier, roof = "flat") {
  const depth = width * 0.48;
  const left = `0,0 ${width},${width * 0.45} ${width},${width * 0.45 - height} 0,${-height}`;
  const right = `${width},${width * 0.45} ${width + depth},${width * 0.45 - depth * 0.45} ${width + depth},${width * 0.45 - depth * 0.45 - height} ${width},${width * 0.45 - height}`;
  const top = `0,${-height} ${depth},${-height - depth * 0.45} ${width + depth},${width * 0.45 - depth * 0.45 - height} ${width},${width * 0.45 - height}`;
  let windows = "";
  for (let row = 0; row < Math.max(1, Math.floor(height / 19)); row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const wx = 8 + col * (width - 16) / 2;
      const wy = -height + 11 + row * 18 + wx * 0.45;
      windows += `<path class="window-light" d="M${wx},${wy} l7,3.15 v8 l-7,-3.15z"/>`;
    }
  }
  const extra = roof === "antenna" ? `<path d="M${width * 0.65},${-height + 1} v-30" stroke="#d7efcf" stroke-width="2"/><circle class="antenna-light" cx="${width * 0.65}" cy="${-height - 30}" r="4"/>` : roof === "garden" ? `<path d="M5,${-height - 1} l${depth - 3},${-depth * 0.45 + 2} ${width - 10},${width * 0.45 - 4} -${depth - 3},${depth * 0.45 - 2}z" fill="#a6d995"/>` : "";
  return `<g class="landmark building tier-${tier}" data-tier="${tier}" transform="translate(${x} ${y})" style="--building-color:${color}"><polygon class="building-front" points="${left}"/><polygon class="building-side" points="${right}"/><polygon class="building-roof" points="${top}"/>${windows}${extra}</g>`;
}

function tree(x, y, scale = 1) {
  return `<g class="tree" transform="translate(${x} ${y}) scale(${scale})"><ellipse cx="0" cy="5" rx="12" ry="5" fill="#24453b" opacity=".35"/><path d="M0 0v-15" stroke="#8c6d4f" stroke-width="5"/><path d="M0-44 15-15H-15Z" fill="#92be7b"/><path d="M0-32 18-7H-18Z" fill="#70a16d"/></g>`;
}

function agent(x, y, index) {
  return `<g class="tiny-agent route-${index % 3}" style="--walk-delay:-${index * 1.7}s" transform="translate(${x} ${y})"><g class="agent-walk"><ellipse cy="4" rx="7" ry="3" fill="#1d302c" opacity=".4"/><path d="M-3 0v4m6-4v4" stroke="#d8e6dd" stroke-width="2.5"/><rect x="-6" y="-14" width="12" height="13" rx="4" fill="${index % 2 ? "#f3b69b" : "#d9ecc6"}"/><rect x="-4" y="-10" width="8" height="4" rx="1.7" fill="#263e38"/><circle cx="-2" cy="-8" r=".7" fill="#caff8e"/><circle cx="2" cy="-8" r=".7" fill="#caff8e"/></g></g>`;
}

function landmark(tier, lastTier, x, y, content) {
  return `<g class="landmark" data-tier="${tier}" data-max-tier="${lastTier}" transform="translate(${x} ${y})">${content}</g>`;
}

function hut(x, y, tier = 0, lastTier = 0, tent = false) {
  const shelter = tent
    ? `<path d="M-29 5 0-43 32 8 5 21Z" fill="#cda781"/><path d="M0-43 5 21 32 8Z" fill="#9f7966"/><path d="M0-17-12 12 7 19Z" fill="#3c3440"/><path d="M-3-47 1-42 5-48" fill="none" stroke="#d8b389" stroke-width="3"/>`
    : `<path d="M-25-5V15Q0 30 25 15V-5Z" fill="#b68f70"/><path d="M0 0V23Q18 20 25 15V-5Z" fill="#8a6659"/><path d="M-33-1Q-20-34 0-43Q23-30 33-1Q0 18-33-1Z" fill="#dfbd7e"/><path d="M0-43Q18-15 33-1Q14 9 0 10Z" fill="#ae855e"/><path d="M-14-8-5-30M-22-5-13-24M-2-6 0-32" stroke="#f0d99c" stroke-width="2" opacity=".7"/><path d="M-9 19V7Q-3-5 5 7V24Z" fill="#3b3036"/>`;
  return landmark(tier, lastTier, x, y, `<ellipse cy="16" rx="39" ry="16" fill="#263b35" opacity=".5"/>${shelter}<path d="M-25 25-13 30M14 28 24 23" stroke="#84998b" stroke-width="5" stroke-linecap="round"/>`);
}

function field(x, y, tier = 1, lastTier = 2) {
  let crops = '';
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const cx = 11 + col * 10 + row * 7, cy = 4 + col * 4.5 - row * 3.2;
      crops += `<path d="M${cx} ${cy}v-8m0 4-3-4m3 2 3-3" stroke="${row % 2 ? '#d5d57e' : '#c4e38b'}" stroke-width="1.7" stroke-linecap="round"/>`;
    }
  }
  return landmark(tier, lastTier, x, y, `<path d="M0 0 54 24 85 10 31-14Z" fill="#a17d59" stroke="#d0af77" stroke-width="3"/><path d="M8-2 61 21M16-6 69 17M24-10 77 13" stroke="#685943" stroke-width="3"/>${crops}`);
}

function windmill(x, y) {
  return landmark(1, 1, x, y, `<ellipse cy="16" rx="34" ry="13" fill="#283c36" opacity=".5"/><path d="M-18 13-12-52 13-52 22 12Q0 25-18 13Z" fill="#efe1c2"/><path d="M3-52 13-52 22 12 4 20Z" fill="#baa58a"/><path d="M-20-49 0-70 22-49Z" fill="#b27465"/><path d="M-7 18V4Q-1-4 6 4V20Z" fill="#554b4c"/><g transform="translate(0 -39) rotate(15)"><path d="M0-31V31M-31 0H31" stroke="#574c49" stroke-width="3"/><path d="M-2-31H8V-7H-2ZM7-2H31V8H7ZM-8 7H2V31H-8ZM-31-8H-7V2H-31Z" fill="#ede4bd" stroke="#938369" stroke-width="1.5"/></g><circle cy="-39" r="5" fill="#655756"/>`);
}

function castle(x, y) {
  return landmark(2, 2, x, y, `<ellipse cy="16" rx="66" ry="23" fill="#27393c" opacity=".5"/><path d="M-45-8 5 15 48-5V-44L4-25-45-47Z" fill="#aebcc0"/><path d="M5 15 48-5V-44L5-25Z" fill="#718c9b"/><path d="M-45-47 4-25 48-44 0-66Z" fill="#d5ddcf"/><path d="M-28-39V-69H-19V-62H-10V-69H-1V-34M22-43V-72H31V-65H40V-72H49V-46M-51-11V-54H-42V-47H-33V-54H-24V2" fill="#b9c8ca" stroke="#718d96" stroke-width="2"/><path d="M-9 8V-9Q1-23 12-8V10" fill="#334b54"/><path d="M0-66V-93" stroke="#d8d8bc" stroke-width="2"/><path d="M1-92 23-84 1-77Z" fill="#d899b2"/><path d="M-44-32v9M-17-52v9M33-55v9" stroke="#4a6572" stroke-width="4"/>`);
}

function factory(x, y, scale = 1) {
  return landmark(3, 3, x, y, `<g transform="scale(${scale})"><ellipse cy="19" rx="65" ry="22" fill="#263c40" opacity=".5"/><path d="M-44 4V-32L-24-45V-25L-4-38V-18L16-31V25Z" fill="#b38e88"/><path d="M16 25 54 8V-47L16-31Z" fill="#7d7381"/><path d="M-44-32-6-49 14-62-24-45M-24-25 14-42 34-55-4-38M-4-18 34-35 54-47 16-31" fill="#c4ccd0"/><path d="M30-46V-92L42-97V-50" fill="#bba899" stroke="#887b80" stroke-width="1.5"/><path d="M30-92 42-97 50-93 38-88Z" fill="#ddd2be"/><path d="M-35-12v12M-17-4V9M2 4v11M28-14v13M43-21v13" stroke="#efcc85" stroke-width="6"/><circle cx="39" cy="-111" r="8" fill="#acadb8" opacity=".35"/><circle cx="48" cy="-126" r="12" fill="#acadb8" opacity=".2"/></g>`);
}

function market(x, y) {
  return landmark(2, 2, x, y, `<path d="M-21 12 12 27 35 16V-6L2-21-21-11Z" fill="#e0bb8f"/><path d="M12 27 35 16V-6L12 5Z" fill="#aa806e"/><path d="M-28-11 4-26 43-9 11 6Z" fill="#d69c9d"/><path d="M-18-15 18 1M-6-20 30-4" stroke="#f1d7bd" stroke-width="8"/><path d="M-17-2v18M29 4v18" stroke="#685650" stroke-width="3"/><path d="M-14 13 11 24 30 15" fill="none" stroke="#bfda8e" stroke-width="6"/>`);
}

/** A local, code-drawn illustration. It does not load or fetch game state. */
export function createScene(container, { avatarUrl } = {}) {
  container.innerHTML = `<div class="scene-atmosphere" aria-hidden="true"><i class="star star-a"></i><i class="star star-b"></i><i class="star star-c"></i><i class="star star-d"></i><span class="moon"></span><span class="planet-orbit"></span></div>
    <div class="tibo-medallion"><span class="portrait-rays" aria-hidden="true"></span><img alt="Tiboの公開プロフィール写真" width="54" height="54"/><span class="tibo-label">Tibo</span><span class="tibo-caption">見守っています</span></div>
    <svg class="island-scene" viewBox="0 0 640 370" role="img" aria-label="エージェントたちが暮らす小さな島">
      <defs><linearGradient id="island-earth" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#524862"/><stop offset="1" stop-color="#282436"/></linearGradient><linearGradient id="island-grass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#718a68"/><stop offset="1" stop-color="#3c5951"/></linearGradient><radialGradient id="island-glow"><stop stop-color="#9a73ff" stop-opacity=".34"/><stop offset="1" stop-color="#9a73ff" stop-opacity="0"/></radialGradient></defs>
      <ellipse class="island-shadow" cx="320" cy="334" rx="205" ry="27" fill="#000" opacity=".28"/>
      <ellipse class="civilization-glow" cx="320" cy="243" rx="275" ry="124" fill="url(#island-glow)"/>
      <g class="floating-island">
        <path d="M75 218 320 331V356L75 243Z" fill="url(#island-earth)"/><path d="M320 331 565 218V243L320 356Z" fill="#313249"/>
        <path d="M75 218 320 105 565 218 320 331Z" fill="url(#island-grass)" stroke="#c6e58c" stroke-width="1.5"/>
        <path d="M78 242 320 354 562 242" fill="none" stroke="#9a73ff" stroke-width="2" opacity=".8"/>
        <g class="landmark" data-tier="0" data-max-tier="1"><path d="M180 225Q257 203 316 160M230 246Q325 222 421 186M204 194 430 270" fill="none" stroke="#b9a582" stroke-width="10" stroke-linecap="round" opacity=".8"/></g>
        <g class="landmark" data-tier="2" data-max-tier="2"><path d="M122 239 363 128M198 275 441 163M159 180 480 288" stroke="#acb0a2" stroke-width="14"/><path d="M122 239 363 128M198 275 441 163M159 180 480 288" stroke="#d3cfba" stroke-width="7" stroke-dasharray="2 6"/></g>
        <g class="landmark" data-tier="3"><path d="M122 239 363 128M198 275 441 163M159 180 480 288" stroke="#b6bbc0" stroke-width="16"/><path d="M122 239 363 128M198 275 441 163M159 180 480 288" stroke="#57606b" stroke-width="11"/><path d="M165 182 474 286M129 237 356 132M205 273 435 167" stroke="#dedcc1" stroke-width="1.5" stroke-dasharray="5 7" opacity=".8"/></g>
        <g class="landmark" data-tier="3" data-max-tier="3"><path d="M144 245 324 328 497 248" fill="none" stroke="#514c53" stroke-width="11" stroke-dasharray="3 6"/><path d="M144 242 324 325 497 245M144 248 324 331 497 251" fill="none" stroke="#cbd2d0" stroke-width="2"/><g transform="translate(340 313)"><path d="M0 0 30-14 45-7 15 7Z" fill="#dfbd87"/><path d="M0 0v-13l30-14v13Z" fill="#b39da1"/><path d="M0-13 15-6 45-20 30-27Z" fill="#d2c8c2"/><path d="M4-13 13-17M18-20 26-24" stroke="#e9e7b5" stroke-width="5"/></g></g>
        <g class="landmark" data-tier="5"><path d="M90 218 320 112 550 218 320 324Z" fill="none" stroke="#d5ff43" stroke-width="2" opacity=".7"/><path d="M127 241 366 131M201 276 444 165" stroke="#ff5dc8" stroke-width="2" opacity=".6"/></g>
        ${tree(313, 124, 0.7)}${tree(334, 134, 0.6)}${tree(472, 207, 0.8)}
        ${hut(294, 173)}${windmill(303, 168)}${castle(302, 184)}${factory(295, 177, 0.8)}
        ${building(283, 168, 40, 76, "#b2bbd5", 4, "garden")}
        ${field(366, 191, 1, 1)}${market(408, 197)}${factory(412, 207, 0.75)}
        ${building(406, 209, 35, 119, "#b3a6d0", 4, "antenna")}
        ${hut(231, 213, 0, 1)}${market(224, 216)}${factory(221, 224, 0.7)}
        ${building(224, 223, 41, 88, "#d0a8bd", 4, "garden")}
        ${hut(332, 262, 0, 0, true)}${field(304, 258, 1, 1)}${market(321, 263)}${factory(320, 262, 0.7)}
        ${building(316, 267, 44, 132, "#9dbec1", 4, "antenna")}
        ${field(157, 234)}${field(218, 268)}
        ${building(169, 246, 30, 49, "#c4cdac", 4, "garden")}
        ${building(422, 281, 33, 59, "#c9b1d0", 4, "garden")}
        <g class="landmark beacon" data-tier="5"><path d="M393 249V98" stroke="#9a73ff" stroke-width="3" stroke-dasharray="4 6" opacity=".7"/><ellipse cx="393" cy="102" rx="43" ry="15" fill="#5a456f" stroke="#ff5dc8" stroke-width="2"/><path d="M350 102Q393 132 436 102Q420 125 393 132Q367 125 350 102Z" fill="#493d60"/><ellipse cx="393" cy="99" rx="35" ry="11" fill="#899d9d" stroke="#d5ff43" stroke-width="2"/><path d="M376 96V62L393 50 408 61V96Z" fill="#a9d1cc"/><path d="M393 50 408 61V96L393 101Z" fill="#79669f"/><path d="M383 68V88M399 69V90" stroke="#d5ff43" stroke-width="3"/><path class="beacon-ring" d="M344 83Q393 40 443 83M344 85Q393 112 443 85" fill="none" stroke="#ff5dc8" stroke-width="2"/><circle class="antenna-light" cx="393" cy="41" r="4" fill="#d5ff43"/></g>
        ${tree(119, 218, 0.85)}${tree(144, 244, 0.6)}${tree(481, 244, 0.8)}${tree(456, 271, 0.65)}${tree(357, 309, 0.7)}
        <g class="agent-population">${agent(192, 203, 0)}${agent(274, 241, 1)}${agent(333, 181, 2)}${agent(399, 255, 3)}${agent(245, 185, 4)}${agent(332, 287, 5)}${agent(443, 218, 6)}${agent(203, 259, 7)}</g>
        <g class="campfire" transform="translate(314 306)"><ellipse rx="14" ry="6" fill="#695940"/><path class="fire" d="M-7 0Q-10-9 0-21Q2-12 5-15Q14-4 5 1Z" fill="#ffbd78"/><path d="M-2 0Q-5-6 1-10Q7-3 3 1Z" fill="#ffedaa"/></g>
        <path class="reset-ripple" d="M75 218 320 105 565 218 320 331Z" fill="none" stroke="#d5ff43" stroke-width="3"/>
      </g>
    </svg><div class="scene-message"><span class="scene-status-light"></span><span data-scene-copy>エージェントたちが暮らしています</span></div><div class="reset-celebration" aria-hidden="true"><span>THANK YOU, TIBO!</span><strong>街に、もう一度灯りが。</strong></div>`;
  const image = container.querySelector("img");
  if (avatarUrl) image.src = avatarUrl;
  image.addEventListener("error", () => { image.hidden = true; container.querySelector(".tibo-medallion").classList.add("portrait-missing"); });
  const landmarks = [...container.querySelectorAll("[data-tier]")];
  const caption = container.querySelector("[data-scene-copy]");
  let timer = 0;
  let previousEra = null;
  let previousCivilization = null;
  let resetActive = false;
  function celebrate(kind, eraLabel) {
    clearTimeout(timer);
    resetActive = kind === "reset";
    container.querySelector(".reset-celebration span").textContent = resetActive ? "THANK YOU, TIBO!" : "LEVEL UP!";
    container.querySelector(".reset-celebration strong").textContent = resetActive ? "街に、もう一度灯りが。" : `${eraLabel}へ進化！`;
    container.classList.remove("is-resetting");
    void container.offsetWidth;
    container.classList.add("is-resetting");
    timer = setTimeout(() => { container.classList.remove("is-resetting"); resetActive = false; }, 2600);
  }
  return {
    update(projection, eraIndex = 0, isDemo = false) {
      const civilization = `${projection.id}:${projection.generation}:${isDemo}`;
      if (previousCivilization !== null && civilization !== previousCivilization) {
        clearTimeout(timer);
        container.classList.remove("is-resetting");
        resetActive = false;
        previousEra = null;
      }
      previousCivilization = civilization;
      container.dataset.status = projection.status;
      container.dataset.policy = projection.policy;
      container.dataset.era = String(Math.max(0, eraIndex));
      container.classList.toggle("sample-scene", isDemo);
      for (const landmark of landmarks) {
        const lastTier = landmark.dataset.maxTier === undefined ? Infinity : Number(landmark.dataset.maxTier);
        landmark.classList.toggle("is-built", Number(landmark.dataset.tier) <= eraIndex && eraIndex <= lastTier);
      }
      if (previousEra !== null && eraIndex > previousEra && !resetActive) celebrate("era", projection.era?.label ?? "新しい時代");
      previousEra = eraIndex;
      const messages = { alive: "小さな今日が、文明になっていく。", stopped: "枠がなくなりました。みんなでTiboを待っています。", pending: "お知らせを確認中。街の記録を守っています。", extinct: "この街の物語は、ここでおしまい。" };
      caption.textContent = messages[projection.status] ?? messages.pending;
      container.querySelector(".tibo-caption").textContent = projection.status === "stopped" ? "リセット、ください…" : projection.status === "extinct" ? "次の文明で、また。" : "見守っています";
      container.querySelector("svg").setAttribute("aria-label", `${projection.era?.label ?? "小さな文明"}。${messages[projection.status] ?? "お知らせを確認中"}`);
    },
    celebrate() { celebrate("reset"); },
    destroy() { clearTimeout(timer); },
  };
}

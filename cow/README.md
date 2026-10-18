# tiboっち : civilization

A small agent civilization raised by real-world Tibo reset announcements. Choose a work pace, return later, and watch a stone-age settlement grow into a future city. The previous two-minute RESET-button prototype remains at `/arcade.html`.

The large lime percentage at the top is Reset Watch's **next-24-hour reset forecast**, derived from X posts through Decisions API. It is distinct from the civilization's remaining quota. Confidence and the original analysis time are shown alongside it; weak evidence is labeled as a reference estimate. Refused, expired or stale forecasts are shown as unavailable rather than a fabricated probability. The original black/lime/pink visual style, oversized typography and Tibo portrait continue through the game.

## Play locally

Requires Node.js 22 or newer. No dependencies or API key are needed for the civilization game.

```sh
cd cow
npm run dev
```

Open `http://localhost:4173`. The server reads the public snapshot from [Tibo Reset Watch](https://tibo-reset-watch.soumame.chatgpt.site/); it does not call OpenAI or X itself. The page polls this same-origin endpoint once a minute, with a one-minute server cache. No cookies or caller credentials are forwarded. The public feed must remain accessible for live synchronization.

The startup command can load a local ignored `.env.local` for the archived arcade's optional API feature. The civilization game never reads that key in the browser. Only explicitly allowlisted frontend files are served.

## Rules

| Pace | Full quota lasts | Growth per hour |
| --- | --- | --- |
| Conserve | 7 days | 0.35 |
| Normal | 5 days | 1 |
| Sprint | 3 days | 1.6 |

The initial civilization starts at 100% quota. Work consumes quota and increases cumulative research. Era thresholds are 0, 2, 12, 48, 144 and 300 research: stone, agriculture, kingdom, industry, information and future. At normal pace with timely resets, the future arrives after 12.5 days of work.

- An eligible completed-reset announcement restores game quota to exactly 100%; predictions and future promises never refill it.
- At 0%, work stops. After another 24 hours without a reset, the civilization becomes extinct. A reset at the exact deadline still rescues it.
- A later real reset offers one seed for a new generation. An extinct generation remains a memorial, and the announcement backlog cannot fund unlimited retries.
- A persistent timestamped journal reconstructs growth while the page is closed. The game is saved in this browser, not to a cross-device account.
- Unknown collection periods cannot finalize extinction. Delayed historical notices replay at their publication time, not their arrival time.

**Two-minute experience mode** uses a separate temporary civilization. One second represents three hours, with clearly labeled sample announcements every four game days. The no-reset scenario shows exhaustion and extinction. Demo actions never modify the real civilization.

## Decisions API connection

Reset Watch uses Decisions API to classify posts and estimate a future reset. This game consumes its existing public report; it adds no per-player model calls. It accepts `signalKind: completed` at classification confidence ≥0.8 from signal-scoring versions 2 and 3, or the equivalent legacy `already_reset` classification. Only @thsottiaux, the `codex` target and recognized X collection sources are eligible. Refusals, unavailable images, forecasts, imported reports and other products cannot refill the city.

The threshold is an explicit game rule, not a calibrated guarantee. A completed notice is not independent verification of anyone's actual Codex account. Distinct posts reporting the same real reset lack a common upstream event ID and can currently count separately; repeat polling of the same post cannot. Forecast confidence and probability remain separate from accepted-reset classification.

Collection continuity uses `collectedAt`, `asOf` and the actual oldest post in the rolling window. If the feed is unavailable or the user's absence outlasts that window, the game shows an unconfirmed state instead of declaring a missing reset. Low-confidence classifications do not count under the game rule; they do not stop the collection clock.

If the city is stuck awaiting confirmation because its missing history has fallen outside the rolling window, **記録を残して新しくはじめる** starts a new generation at the current time with 100% game quota and zero research. The previous journal is retained in browser storage with its outcome marked unconfirmed; no death or real reset is inferred. This explicit recovery is available only for a pending city with a confirmed history gap, not during a temporary network failure or experience mode. Future feed updates cover the new generation normally.

## Integrate into Reset Watch later

The component is self-contained under `civilization/` and uses Shadow DOM to avoid changing the host's styles. With the actual Site source available:

```sh
node cow/install-reset-watch.mjs tibo-reset/site/public
```

The installer edits the Site's `client/index.html`, places the card before the existing timeline, and copies browser assets into `public/civilization/`. It also supports static hosts with `public/index.html`. To select another template explicitly, append its path as the second argument, for example `node cow/install-reset-watch.mjs tibo-reset/site/public tibo-reset/site/client/index.html`.

It is idempotent, retains the existing prediction/timeline UI, and reads `/snapshot.json` on the host. It does not overwrite the Worker, secrets or publishing identity. Then validate and publish using the existing Site owner's source workflow. Installing files locally does not deploy the hosted Site.

To mount manually, import `mountCivilization` from `widget.js`, provide an element and normalized feed, then call `updateSnapshot(feed)` after fresh collection. `reset-feed.js` converts the upstream report into that feed; persist its result as `previous`. The engine processes cumulative notices by ID and timestamp.

## Validate and deploy

```sh
npm test
npm run build
```

Tests cover multi-day balance, exact reset/death boundaries, offline reconstruction, duplicate notices, source filtering, feed gaps, rebirth, bounded proxy requests and public-build isolation. Network calls are mocked in the test suite. `build.mjs` recreates `dist/` from the explicit list in `public-assets.mjs`; environment files, backend code, tests and unlisted assets never enter it.

For Vercel, use Root Directory `cow`, Framework Preset Other, and the checked-in `vercel.json`. It builds the static files and `/api/reset-watch` function. The new game needs no environment key. A static host can serve experience mode, but live play requires a same-origin snapshot endpoint or the server proxy. The game has not been deployed merely because its local build passes.

## Project layout

- `index.html`, `civilization-page.css`: standalone game page.
- `civilization/widget.js`, `widget.css`, `scene.js`: responsive component, persistent browser state, sample mode and evolving town.
- `civilization/engine.js`: deterministic policy, era, reset and extinction rules.
- `civilization/reset-feed.js`: existing Reset Watch report adapter.
- `civilization/forecast-view.js`: independent forecast display, confidence and freshness rules.
- `civilization/bootstrap.js`: one-minute public-feed refresh and component mounting.
- `src/reset-watch.js`, `api/reset-watch.js`: fixed-upstream public snapshot proxy.
- `install-reset-watch.mjs`: deferred Site integration without rewriting host code.
- `design/`: detailed four-day-cadence rules and integration proposal.
- `arcade.html`, `game.js`, `style.css`, `details.css`, `src/decisions.js`: archived original prototype.

## Judging

**New-feature use:** Decisions API's completed-reset classifications directly change a persistent game's resources. **Usability:** three meaningful pace choices, a visual town, offline growth, and an isolated two-minute demonstration. **Usefulness:** a playful reason to revisit the reset tracker and experience the tradeoff between throughput and limited resources. **Originality:** real-world public announcements become events that sustain an agent civilization. This is a fan game, not a productivity benchmark or a service that grants real quotas.

## Portrait attribution

The portrait is the publicly published [tibo-openai GitHub avatar](https://github.com/tibo-openai). [The Dev Interrupted interview](https://linearb.io/dev-interrupted/podcast/openai-codex-thibault-sottiaux-agentic-autonomy) links this account and @thsottiaux. The photograph is a third-party asset, not included in any license grant for the game code. This project is unofficial and implies no endorsement by Tibo or OpenAI.

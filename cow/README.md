# TIBO SIMULATOR

A one-button city simulation game built for the DevDay Community Hackathon.

**Tibo presses RESET. Six resident agents choose how to work. Keep the city growing for two minutes.** You have three resets; each restores everyone's game-only capacity and starts a 20-second cooldown. A depleted agent pauses while its work progress remains. Complete timed projects to grow the city and earn civilization points.

## Run locally

Requires Node.js 20 or newer. No package installation is needed.

```sh
npm run dev
```

Open `http://localhost:4173`. The game uses its built-in local decision rules unless `OPENAI_API_KEY` is configured. To use the API locally, save the key in `.env.local` and start the server with Node's env-file support:

```sh
node --env-file=.env.local server.mjs
```

Keep `.env.local` private; it is ignored by Git. The browser never receives the API key.

## Decisions API

The Vercel function in `api/decisions.js` sends one Decisions API request per decision interval, asking six independent `choice` questions in one request. Each resident chooses `conserve`, `standard`, or `sprint` for the next ten seconds. The fixed game rules apply its speed and capacity costs. The model does not score the run or change game rules.

If the key is absent or an API request fails, the game continues with a local rules-based fallback. For Vercel deployment, set the project root to `cow/` and add `OPENAI_API_KEY` as a server-side environment variable. The Decisions API key must never use a `VITE_`, `NEXT_PUBLIC_`, or other browser-exposed variable.

The endpoint validates the six known agent IDs and bounded values, has a per-process in-memory request cap, and uses a five-second upstream timeout. The in-memory cap is a best-effort guard for a small hackathon demo, not distributed abuse prevention.

## Project layout

- `index.html`, `style.css`, `details.css`, `game.js`: game UI, simulation, and presentation.
- `src/decisions.js`: shared validation, local fallback, and OpenAI API call.
- `api/decisions.js`: Vercel serverless adapter.
- `server.mjs`: dependency-free local static server and API adapter.

The game is an independent fan-made project and is not affiliated with OpenAI. Its RESET charges are fictional game resources.

## Validation

Run `node --test tests/*.test.mjs` for deterministic game-balance, reset/cooldown, replay, API validation, and fallback/recovery checks. API tests use mocked responses and do not spend API credits. Live connection status is shown only after six valid decisions have been received.

## Portrait attribution

The Tibo portrait is the publicly published [tibo-openai GitHub avatar](https://github.com/tibo-openai), downloaded from `https://avatars.githubusercontent.com/u/177053821?s=400&v=4`. [The Dev Interrupted interview](https://linearb.io/dev-interrupted/podcast/openai-codex-thibault-sottiaux-agentic-autonomy) links this GitHub account and @thsottiaux. The photograph is a third-party asset, not included in any license grant for the game code. Its use does not imply endorsement.

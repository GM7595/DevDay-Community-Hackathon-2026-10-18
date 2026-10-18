# TIBO SIMULATOR

A one-button city simulation game built for the DevDay Community Hackathon.

**Tibo presses RESET. Six resident agents choose how to work. Keep the city growing for two minutes.** You have three resets; each restores everyone's game-only capacity and starts a 20-second cooldown. A depleted agent pauses while its work progress remains. Complete timed projects to grow the city and earn civilization points.

## Run locally

Requires Node.js 22 or newer. No package installation is needed.

```sh
npm run dev
```

Open `http://localhost:4173`. The startup command loads `.env.local` when present. The game uses its built-in local decision rules unless the server has `OPENAI_API_KEY` configured. Use Codex's secure OpenAI Platform key setup flow for credential configuration; never paste a key into the game, source files, or documentation. Local `.env*` files are ignored by Git. The local server serves only the five named frontend files and does not expose environment files or backend source.

## Decisions API

The Vercel function in `api/decisions.js` sends one Decisions API request per decision interval, asking six independent `choice` questions in one request. Each resident chooses `conserve`, `standard`, or `sprint` for the next ten seconds. The fixed game rules apply its speed and capacity costs. The model does not score the run or change game rules.

The model receives each department's capacity and progress, the active shared project, and its deadline. Its choices affect the actual work speed and capacity consumption; the player still controls only RESET. See the [official Decisions API guide](https://developers.openai.com/api/docs/guides/decisions) for the batched `choice` interface.

If the key is absent or an API request fails, the game continues with a local rules-based fallback. Failed requests remain retryable. The status becomes live only after six distinct, valid choices arrive; refusals, partial answers, duplicates, and unknown modes use the fallback instead. The result screen reports actual successful API use.

The endpoint validates the six known agent IDs and bounded values, has a per-process in-memory request cap, and uses a five-second upstream timeout. The in-memory cap is a best-effort guard for a small hackathon demo, not distributed abuse prevention.

## Build and deploy

```sh
npm test
npm run build
```

`build.mjs` recreates `dist/` from an explicit allowlist: `index.html`, `game.js`, `style.css`, `details.css`, and `assets/tibo-avatar.jpg`. It rejects symlinked assets and never copies environment files, backend source, tests, or unlisted assets into the public output.

For Vercel, import the repository with **Root Directory `cow`** and **Framework Preset Other**. The checked-in `vercel.json` selects `npm run build` and output directory `dist`. Vercel builds `api/decisions.js` separately as a Node.js function, including its shared `src/decisions.js` implementation. Configure `OPENAI_API_KEY` through the host's protected server environment settings; do not use a `VITE_`, `NEXT_PUBLIC_`, or other browser-exposed variable. The configuration follows [Vercel's project configuration reference](https://vercel.com/docs/project-configuration/vercel-json).

A static-only host can serve the game but cannot run its Decisions API endpoint. Deployment and a check of the public `/api/decisions` endpoint are separate from a successful local build. The hackathon submission requires both a public repository URL and a working deployed URL by 17:15 JST on October 18, 2026.

## Judging criteria

**New features:** Decisions API chooses six departments' work modes from the shared city state in one request, and those choices change the simulation. **Usability:** one gameplay button, visible capacity meters, a short two-minute run, keyboard operation, and a clear replay path make the rules immediately testable. **Usefulness:** the result screen shows RESET recovery efficiency and city uptime, letting players see the tradeoff between waste and downtime; this is a resource-management sandbox, not a model of real Codex quotas. **Originality:** the reset-ticket joke becomes a city whose agents plead for help and restart together, with Tibo cast as the player's reset god. Demonstrate the API status and one crisis-to-reset sequence so these claims are visible during the three-minute presentation.

## Project layout

- `index.html`, `style.css`, `details.css`, `game.js`: game UI, simulation, and presentation.
- `src/decisions.js`: shared validation, local fallback, and OpenAI API call.
- `api/decisions.js`: Vercel serverless adapter.
- `server.mjs`: dependency-free local static server and API adapter.
- `build.mjs`, `vercel.json`: allowlisted static build and serverless deployment configuration.
- `tests/`: isolated API, gameplay, and build-output regression checks.

The game is an independent fan-made project and is not affiliated with OpenAI. Its RESET charges are fictional game resources.

## Validation

Run `npm test` for deterministic game-balance, reset/cooldown, replay, API validation, fallback/recovery, and build-output isolation checks. API tests use mocked responses and do not spend API credits. Build tests place private sentinel files in a temporary fixture and verify that none reach the public output. Live connection status is shown only after six valid decisions have been received.

## Portrait attribution

The Tibo portrait is the publicly published [tibo-openai GitHub avatar](https://github.com/tibo-openai), downloaded from `https://avatars.githubusercontent.com/u/177053821?s=400&v=4`. [The Dev Interrupted interview](https://linearb.io/dev-interrupted/podcast/openai-codex-thibault-sottiaux-agentic-autonomy) links this GitHub account and @thsottiaux. The photograph is a third-party asset, not included in any license grant for the game code. Its use does not imply endorsement.

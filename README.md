# QuadStrike

QuadStrike is a browser-based multiplayer physics sports prototype built from the PRD in [`docs/quad-arena-soccer-prd.txt`](/Users/burhancetinkaya/Development/quad-arena-soccer/docs/quad-arena-soccer-prd.txt).

## Stack

- Phaser 3 for rendering
- TypeScript for the frontend runtime
- Matter.js for deterministic fixed-step physics
- WebRTC DataChannels for peer-to-peer transport
- Node.js + WebSocket signaling server
- PWA manifest + service worker shell caching

## Run

1. Install dependencies with `npm install`.
2. Start the signaling server with `npm run serve:signal`.
3. Start the web app with `npm run dev`.
4. Open the Vite URL on one or more devices and either host or join the same room ID.

## Deploy

The easiest free deployment path for the current architecture is Render:

- static frontend on a Render Static Site
- signaling server on a free Render Web Service

See [docs/DEPLOYMENT.md](/Users/burhancetinkaya/Development/quad-arena-soccer/docs/DEPLOYMENT.md) for the full process and the included [render.yaml](/Users/burhancetinkaya/Development/quad-arena-soccer/render.yaml).

## Current Scope

- Landscape-only responsive game shell with touch and keyboard controls
- Fixed 60 Hz simulation loop and 20 Hz state broadcast cadence
- Authoritative host simulation with practice mode fallback
- Binary input/state packet serialization
- Client interpolation and local rail prediction
- Host migration hooks based on lowest active player slot
- Debug overlay and hotkeys for stats, physics, and bounds

## Notes

- The signaling server only forwards `offer`, `answer`, and ICE payloads. Game state stays on WebRTC DataChannels.
- The current implementation focuses on a playable MVP scaffold. It leaves room for future work like spectators, replays, AI, and tournament structure from the PRD.

## Extra Docs

- [docs/TECH_STACK.md](/Users/burhancetinkaya/Development/quad-arena-soccer/docs/TECH_STACK.md)
- [docs/CODEX_PROJECT_CONTEXT.md](/Users/burhancetinkaya/Development/quad-arena-soccer/docs/CODEX_PROJECT_CONTEXT.md)
- [docs/BUGFIX_PLAYBOOK.md](/Users/burhancetinkaya/Development/quad-arena-soccer/docs/BUGFIX_PLAYBOOK.md)

# Technical Stack

## Runtime

- Frontend: `Vite + TypeScript`
- Rendering: `Phaser 3`
- Physics: `Matter.js`
- Networking: `WebRTC DataChannels`
- Signaling: `Node.js + ws`
- App shell: `PWA manifest + service worker`

## Package Summary

- App scripts are defined in [package.json](/Users/burhancetinkaya/Development/quad-arena-soccer/package.json)
- Dev server: `npm run dev`
- Production build: `npm run build`
- Type check: `npm run typecheck`
- Signaling server: `npm run serve:signal`

## Folder Map

- [src/main.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/main.ts)
  App shell, DOM HUD, controls, Phaser bootstrap, landscape enforcement.
- [src/game/](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game)
  Core game loop, physics simulation, scene rendering, protocol, constants, types.
- [src/network/](/Users/burhancetinkaya/Development/quad-arena-soccer/src/network)
  Signaling client, WebRTC peer link, session orchestration.
- [src/platform/](/Users/burhancetinkaya/Development/quad-arena-soccer/src/platform)
  Orientation and PWA helpers.
- [server/signaling-server.js](/Users/burhancetinkaya/Development/quad-arena-soccer/server/signaling-server.js)
  Lightweight WebSocket room server for offer/answer/ICE relay.
- [public/](/Users/burhancetinkaya/Development/quad-arena-soccer/public)
  Manifest, service worker, icons.

## Architecture

- Host authoritative model is active.
- Host runs simulation and broadcasts snapshots.
- Clients send compact binary inputs.
- Practice mode exists as a local fallback when no network room is active.
- Rendering is decoupled from simulation with a fixed 60 Hz step.
- Network broadcast cadence is 20 Hz.

## Important Implementation Constraints

- Player movement is rail-based only, not free movement.
- Player-to-player collision is intentionally disabled at gameplay level.
- State packets use binary serialization, not JSON.
- Signaling server must never forward gameplay state.
- Portrait mode should pause gameplay and show the rotate overlay.
- The current build is MVP-first and favors clarity over aggressive optimization.

## Current Known Cost Centers

- Phaser ends up in a large production chunk. Current `vite build` passes, but chunk size warning is expected.
- Physics and rendering are intentionally straightforward; object pooling mentioned in the PRD is not fully built out yet.
- Host migration exists as a baseline handoff path, but should be treated as an area needing extra QA.

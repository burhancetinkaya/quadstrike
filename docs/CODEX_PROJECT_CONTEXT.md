# Codex Project Context

This file is the fastest way for a coding agent to understand the current project state.

## Project Status

- Repo state: working MVP scaffold
- Product target: browser-based 4-player WebRTC physics sports game
- Current maturity: playable local/practice flow + initial multiplayer architecture
- Source of truth for requirements: [docs/quad-arena-soccer-prd.txt](/Users/burhancetinkaya/Development/quad-arena-soccer/docs/quad-arena-soccer-prd.txt)

## What Already Works

- Responsive PWA shell
- Landscape-only blocking overlay
- Phaser scene bootstrap
- Matter.js fixed-step simulation
- Chamfered square arena with goal sensors
- Rail-bound strikers and boost mechanic
- Score handling and goal freeze/reset flow
- Debug overlay and hotkeys
- Binary input and snapshot protocol
- WebSocket signaling server
- WebRTC DataChannel setup
- Client interpolation and local prediction baseline
- Practice mode fallback

## What Is Still Fragile

- Real multi-device WebRTC QA has to be treated as incomplete until manually verified.
- Host migration path is implemented but not battle-tested.
- Packet loss, clock sync, and prediction numbers are useful diagnostics, not yet production-grade telemetry.
- Service worker is intentionally simple and should be retested when asset strategy changes.
- Mobile touch UX works at a baseline level but still needs gameplay feel tuning.

## Files That Matter First

- [src/main.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/main.ts)
  Start here for app shell, input binding, UI wiring, and high-level flow.
- [src/game/runtime.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/runtime.ts)
  Main gameplay/session coordinator.
- [src/game/simulation.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/simulation.ts)
  Authoritative game rules and Matter.js integration.
- [src/game/scene.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/scene.ts)
  Render projection, arena visuals, debug draw.
- [src/network/session.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/network/session.ts)
  Host/client role changes, packet routing, migration handling.
- [src/network/webrtc.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/network/webrtc.ts)
  Peer connection and DataChannel behavior.
- [server/signaling-server.js](/Users/burhancetinkaya/Development/quad-arena-soccer/server/signaling-server.js)
  Room assignment and signaling relay.

## Rules To Preserve While Editing

- Keep simulation tick deterministic and independent from render cadence.
- Do not move gameplay state into the signaling server.
- Preserve binary packet flow unless there is a strong reason to redesign protocol.
- Keep landscape lock behavior intact.
- Keep practice mode working even if multiplayer work is in progress.
- Avoid accidental PRD drift on player movement: rails only.
- Treat host/client logic changes as high risk and validate both paths.

## Fast Validation Checklist

- `npm run typecheck`
- `npm run build`
- `node --check server/signaling-server.js`

## When Touching Networking

- Check host flow
- Check client flow
- Check reconnect/leave flow
- Check host migration fallback
- Check packet sequence and packet loss counters
- Check that signaling still relays only negotiation traffic

## When Touching Gameplay

- Check boost cooldown behavior
- Check rail limits per player
- Check goal detection and score increment
- Check post-goal reset
- Check portrait overlay pauses the runtime
- Check debug hotkeys still work

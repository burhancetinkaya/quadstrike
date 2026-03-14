# Bug Fix Playbook

This document is optimized for fast bug-fix sessions by Codex or another coding agent.

## Default Workflow

1. Reproduce the issue locally.
2. Identify whether the bug is in `UI`, `runtime`, `simulation`, `network`, or `signaling`.
3. Read the smallest relevant file set first.
4. Fix the root cause, not only the symptom.
5. Run the narrowest useful validation.
6. If the touched area is core flow, run full validation before stopping.

## Area Guide

### UI / Shell

- Primary files:
  [src/main.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/main.ts),
  [src/styles.css](/Users/burhancetinkaya/Development/quad-arena-soccer/src/styles.css)
- Typical issues:
  overlay state, controls, HUD sync, responsiveness, mobile touch behavior

### Render / Scene

- Primary file:
  [src/game/scene.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/scene.ts)
- Typical issues:
  wrong visual position, scale mismatch, debug rendering, goal flash visuals

### Gameplay / Physics

- Primary files:
  [src/game/runtime.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/runtime.ts),
  [src/game/simulation.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/simulation.ts),
  [src/game/constants.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/constants.ts)
- Typical issues:
  rail movement, collision responses, boost cooldown, goal detection, score reset

### Network / Session

- Primary files:
  [src/network/session.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/network/session.ts),
  [src/network/webrtc.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/network/webrtc.ts),
  [src/network/signaling.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/network/signaling.ts)
- Typical issues:
  missing packets, wrong host/client role, stale peer link, broken migration, sequencing problems

### Signaling Server

- Primary file:
  [server/signaling-server.js](/Users/burhancetinkaya/Development/quad-arena-soccer/server/signaling-server.js)
- Typical issues:
  room join failure, wrong host election, peer roster drift, offer/answer/ICE forwarding

## Validation Matrix

### Small UI-only changes

- `npm run typecheck`

### Frontend logic changes

- `npm run typecheck`
- `npm run build`

### Signaling server changes

- `node --check server/signaling-server.js`
- If protocol surface changed, also run:
  `npm run typecheck`
  `npm run build`

### Network or simulation changes

- `npm run typecheck`
- `npm run build`
- Manual host/client sanity check if possible

## High-Risk Zones

- [src/game/runtime.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/runtime.ts)
  Session transitions can break practice, host, and client flows at once.
- [src/game/simulation.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/game/simulation.ts)
  Small geometry or collision changes can silently break scoring or feel.
- [src/network/session.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/network/session.ts)
  Sequence handling and migration behavior are easy to regress.
- [src/main.ts](/Users/burhancetinkaya/Development/quad-arena-soccer/src/main.ts)
  Overlay/input bugs can look like gameplay bugs.

## Common Mistake Patterns

- Mixing render timing with simulation timing
- Breaking practice mode while changing multiplayer flow
- Sending gameplay state through signaling by accident
- Changing packet structure without updating both serializer and parser
- Forgetting host/client asymmetry when patching runtime logic
- Breaking portrait overlay pause behavior during UI changes

## Recommended Commit/Change Style

- Keep network fixes isolated from UI cleanup when possible.
- Keep physics constant tuning separate from logic changes.
- If a bug spans multiple systems, document the causal chain in the final summary.
- Mention exact validation commands run after the fix.

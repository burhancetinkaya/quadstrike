# Deployment

This project has two deployable parts:

- `quadstrike-web`: the Vite-built static frontend
- `quadstrike-signal`: the Node.js WebSocket signaling server

## Recommended Free Option

Use Render for both services.

Why this is the best fit for the current codebase:

- the frontend is a static site, which Render hosts for free
- the signaling server is a long-lived Node/WebSocket process, which Render supports as a free web service
- both services can be created from the included [`render.yaml`](/Users/burhancetinkaya/Development/quad-arena-soccer/render.yaml)

Important caveat:

- Render free web services spin down after 15 minutes without inbound traffic, so the first connection after idle may take a short cold start

## Render Deploy Steps

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Create a Render account and connect your Git provider.
3. In Render, create a new Blueprint and select this repository.
4. Render will detect [`render.yaml`](/Users/burhancetinkaya/Development/quad-arena-soccer/render.yaml) and propose two services:
   - `quadstrike-signal`
   - `quadstrike-web`
5. Approve the services and deploy.
6. Wait for `quadstrike-signal` to become healthy on `/health`.
7. Open the `quadstrike-signal` service in Render and copy its public URL.
8. In `quadstrike-web`, set `VITE_SIGNALING_URL` to that URL converted to `wss://...`.
9. Redeploy `quadstrike-web`.
10. Open the `quadstrike-web` URL and verify that multiplayer can create and join a room.

## How It Works

- `quadstrike-signal` listens on Render's assigned `PORT` and exposes `/health` for deploy health checks.
- `quadstrike-web` reads `VITE_SIGNALING_URL` directly, or can derive the WebSocket URL from `VITE_SIGNALING_HOST` if you prefer to provide only a host value.

## Manual Render Setup

If you do not want to use Blueprints, create the two services manually:

### 1. Signaling server

- Service type: Web Service
- Runtime: Node
- Build command: `npm ci`
- Start command: `npm run serve:signal`
- Plan: `Free`
- Health check path: `/health`

### 2. Frontend

- Service type: Static Site
- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- Environment variable:
  - `VITE_SIGNALING_URL=wss://YOUR-SIGNAL-SERVICE.onrender.com`

## Other Free Options

### Cloudflare Pages + Workers/Durable Objects

Good if you want:

- free static asset delivery at the edge
- a globally distributed signaling layer

Tradeoff:

- the current Node `ws` signaling server would need to be rewritten for Workers/Durable Objects

### Vercel for frontend + Render for signaling

Good if you want:

- Vercel for the static frontend experience
- Render only for the WebSocket server

Tradeoff:

- Vercel Functions do not support acting as a WebSocket server, so the signaling backend cannot stay on Vercel

## Recommended Production Path Later

If this moves beyond hobby/testing:

- keep the frontend on Render Static Site or Cloudflare Pages
- move signaling off the free tier to avoid cold starts
- add monitoring for signaling disconnects and room health

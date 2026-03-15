// Frontend runtime configuration is kept small on purpose so local dev can override
// the signaling endpoint without touching the networking code.
export const FRONTEND_CONFIG = {
  signalingUrl: import.meta.env.VITE_SIGNALING_URL?.trim() || 'ws://localhost:8080',
} as const;

export const FRONTEND_CONFIG = {
  signalingUrl: import.meta.env.VITE_SIGNALING_URL?.trim() || 'ws://localhost:8080',
} as const;

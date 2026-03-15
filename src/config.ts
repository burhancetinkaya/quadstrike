// Frontend runtime configuration is kept small on purpose so local dev can override
// the signaling endpoint without touching the networking code.
const configuredSignalingUrl = import.meta.env.VITE_SIGNALING_URL?.trim();
const configuredSignalingHost = import.meta.env.VITE_SIGNALING_HOST?.trim();

const resolveSignalingUrl = (): string => {
  if (configuredSignalingUrl) {
    return configuredSignalingUrl;
  }

  if (configuredSignalingHost) {
    const pageProtocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
    const websocketProtocol = pageProtocol === 'https:' ? 'wss:' : 'ws:';
    return `${websocketProtocol}//${configuredSignalingHost}`;
  }

  return 'ws://localhost:8080';
};

export const FRONTEND_CONFIG = {
  signalingUrl: resolveSignalingUrl(),
} as const;

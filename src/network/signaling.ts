import type { MatchSize, PlayerId, SessionMode } from '../game/types';

export interface PeerRosterEntry {
  peerId: string;
  playerId: PlayerId;
}

export type SignalingMessage =
  | {
      type: 'joined';
      roomId: string;
      peerId: string;
      playerId: PlayerId;
      matchSize: MatchSize;
      isHost: boolean;
      hostPeerId: string | null;
      peers: PeerRosterEntry[];
    }
  | {
      type: 'peer-joined' | 'peer-left' | 'host-migrated';
      roomId: string;
      peerId: string;
      matchSize: MatchSize;
      hostPeerId: string | null;
      peers: PeerRosterEntry[];
    }
  | {
      type: 'match-countdown';
      roomId: string;
      matchSize: MatchSize;
      startAtMs: number;
    }
  | {
      type: 'signal';
      roomId: string;
      fromPeerId: string;
      targetPeerId: string;
      signal: unknown;
    }
  | {
      type: 'error';
      message: string;
    };

// Thin WebSocket wrapper used only for room membership and WebRTC negotiation.
export class SignalingClient {
  private socket: WebSocket | null = null;

  onMessage?: (message: SignalingMessage) => void;

  async connect(
    url: string,
    roomId: string,
    peerId: string,
    requestedMode: SessionMode,
    matchSize?: MatchSize,
  ): Promise<Extract<SignalingMessage, { type: 'joined' }>> {
    this.close();

    // Newer servers accept a dedicated `host` join shape, but we still keep a
    // fallback for older behavior so local upgrades remain painless.
    const primaryPayload =
      requestedMode === 'host'
        ? {
            type: 'host',
            roomId,
            peerId,
            matchSize,
          }
        : {
            type: 'join',
            roomId,
            peerId,
            requestedMode: 'client',
          };

    try {
      return await this.connectOnce(url, primaryPayload);
    } catch (error) {
      if (!this.shouldRetryLegacyHostConnect(requestedMode, error)) {
        throw error;
      }
    }

    this.close();
    return await this.connectOnce(url, {
      type: 'join',
      roomId,
      peerId,
      requestedMode: 'host',
      matchSize,
    });
  }

  private async connectOnce(
    url: string,
    payload: Record<string, MatchSize | SessionMode | string | undefined>,
  ): Promise<Extract<SignalingMessage, { type: 'joined' }>> {
    return await new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;
      this.socket = socket;

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify(payload));
      });

      socket.addEventListener('message', (event) => {
        // Everything on the signaling channel is JSON by design; gameplay data
        // goes over WebRTC once peers connect.
        let message: SignalingMessage;
        try {
          message = JSON.parse(String(event.data)) as SignalingMessage;
        } catch {
          fail(new Error('Failed to parse signaling message.'));
          return;
        }

        if (message.type === 'error') {
          fail(new Error(message.message));
          return;
        }

        if (!settled && message.type === 'joined') {
          settled = true;
          resolve(message);
        }

        this.onMessage?.(message);
      });

      socket.addEventListener('error', () => {
        fail(new Error(`Unable to connect to signaling server at ${url}.`));
      });

      socket.addEventListener('close', () => {
        if (!settled) {
          fail(new Error('Signaling connection closed before the room was joined.'));
        }
      });
    });
  }

  private shouldRetryLegacyHostConnect(requestedMode: SessionMode, error: unknown): boolean {
    if (requestedMode !== 'host' || !(error instanceof Error)) {
      return false;
    }

    return (
      error.message.includes('Join a room before sending other messages.') ||
      error.message.includes('was not found.')
    );
  }

  sendSignal(targetPeerId: string, signal: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: 'signal',
        targetPeerId,
        signal,
      }),
    );
  }

  sendMatchCountdown(startAtMs: number): void {
    // Countdown start is broadcast via the server so even peers without a data
    // channel yet can learn the match start timestamp.
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: 'match-countdown',
        startAtMs,
      }),
    );
  }

  leave(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({ type: 'leave' }));
    this.socket.close();
    this.socket = null;
  }

  close(): void {
    if (!this.socket) {
      return;
    }
    this.socket.close();
    this.socket = null;
  }
}

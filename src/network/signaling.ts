import type { MatchSize, PlayerId } from '../game/types';

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

export class SignalingClient {
  private socket: WebSocket | null = null;

  onMessage?: (message: SignalingMessage) => void;

  async connect(
    url: string,
    roomId: string,
    peerId: string,
    matchSize?: MatchSize,
  ): Promise<Extract<SignalingMessage, { type: 'joined' }>> {
    this.close();

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
        socket.send(
          JSON.stringify({
            type: 'join',
            roomId,
            peerId,
            matchSize,
          }),
        );
      });

      socket.addEventListener('message', (event) => {
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

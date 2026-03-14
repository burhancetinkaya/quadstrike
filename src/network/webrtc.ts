import { deserializeInputPacket, deserializeStatePacket, getPacketType, PacketType } from '../game/protocol';
import type { GameSnapshot, InputFrame } from '../game/types';
import { STUN_SERVERS } from '../game/constants';

export interface PeerLinkCallbacks {
  onSignal: (signal: unknown) => void;
  onInputPacket: (input: InputFrame) => void;
  onStatePacket: (snapshot: GameSnapshot, receivedAt: number) => void;
  onOpen: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}

const toIceServers = (): RTCIceServer[] => STUN_SERVERS.map((urls) => ({ urls }));

const resolveBinaryPayload = async (payload: string | Blob | ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer | null> => {
  if (typeof payload === 'string') {
    return null;
  }

  if (payload instanceof ArrayBuffer) {
    return payload;
  }

  if (payload instanceof Blob) {
    return await payload.arrayBuffer();
  }

  if (ArrayBuffer.isView(payload)) {
    return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
  }

  return null;
};

export class PeerLink {
  private readonly connection = new RTCPeerConnection({
    iceServers: toIceServers(),
  });

  private channel: RTCDataChannel | null = null;

  private readonly pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(
    private readonly initiator: boolean,
    private readonly callbacks: PeerLinkCallbacks,
  ) {
    this.connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.callbacks.onSignal({ candidate: event.candidate.toJSON() });
      }
    });

    this.connection.addEventListener('connectionstatechange', () => {
      if (this.connection.connectionState === 'failed') {
        this.callbacks.onError('WebRTC connection failed.');
      }
      if (this.connection.connectionState === 'closed' || this.connection.connectionState === 'disconnected') {
        this.callbacks.onClose();
      }
    });

    this.connection.addEventListener('datachannel', (event) => {
      this.attachChannel(event.channel);
    });
  }

  async startNegotiation(): Promise<void> {
    if (!this.initiator) {
      return;
    }

    if (!this.channel) {
      const channel = this.connection.createDataChannel('quad-arena-state', {
        ordered: false,
        maxRetransmits: 0,
      });
      this.attachChannel(channel);
    }

    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    if (this.connection.localDescription) {
      this.callbacks.onSignal({ description: this.connection.localDescription.toJSON() });
    }
  }

  async handleSignal(signal: unknown): Promise<void> {
    if (typeof signal !== 'object' || signal === null) {
      return;
    }

    const candidate = Reflect.get(signal, 'candidate');
    const description = Reflect.get(signal, 'description');

    if (candidate) {
      if (this.connection.remoteDescription) {
        await this.connection.addIceCandidate(candidate as RTCIceCandidateInit);
      } else {
        this.pendingCandidates.push(candidate as RTCIceCandidateInit);
      }
      return;
    }

    if (!description) {
      return;
    }

    const sessionDescription = description as RTCSessionDescriptionInit;
    await this.connection.setRemoteDescription(sessionDescription);
    while (this.pendingCandidates.length > 0) {
      const pending = this.pendingCandidates.shift();
      if (pending) {
        await this.connection.addIceCandidate(pending);
      }
    }

    if (sessionDescription.type === 'offer') {
      const answer = await this.connection.createAnswer();
      await this.connection.setLocalDescription(answer);
      if (this.connection.localDescription) {
        this.callbacks.onSignal({ description: this.connection.localDescription.toJSON() });
      }
    }
  }

  send(payload: ArrayBuffer): void {
    if (!this.channel || this.channel.readyState !== 'open') {
      return;
    }
    this.channel.send(payload);
  }

  isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  close(): void {
    this.channel?.close();
    this.connection.close();
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    this.channel.binaryType = 'arraybuffer';
    this.channel.addEventListener('open', () => this.callbacks.onOpen());
    this.channel.addEventListener('close', () => this.callbacks.onClose());
    this.channel.addEventListener('error', () => this.callbacks.onError('Data channel error.'));
    this.channel.addEventListener('message', async (event) => {
      const payload = await resolveBinaryPayload(event.data);
      if (!payload) {
        return;
      }

      const packetType = getPacketType(payload);
      if (packetType === PacketType.Input) {
        this.callbacks.onInputPacket(deserializeInputPacket(payload));
      }
      if (packetType === PacketType.State) {
        this.callbacks.onStatePacket(deserializeStatePacket(payload), performance.now());
      }
    });
  }
}

import { ClockSynchronizer } from '../game/clock';
import { serializeInputPacket, serializeStatePacket } from '../game/protocol';
import type { GameSnapshot, InputFrame, MatchSize, NetworkStats, PlayerId, SessionInfo, SessionMode } from '../game/types';

import type { PeerRosterEntry, SignalingMessage } from './signaling';
import { SignalingClient } from './signaling';
import { PeerLink } from './webrtc';

export interface MatchNetworkCallbacks {
  onStatus: (message: string) => void;
  onSession: (info: SessionInfo, peers: PeerRosterEntry[]) => void;
  onRemoteInput: (input: InputFrame) => void;
  onSnapshot: (snapshot: GameSnapshot, receivedAt: number) => void;
}

const createStats = (): NetworkStats => ({
  pingMs: 0,
  packetLoss: 0,
  tickDriftMs: 0,
  interpolationDelayMs: 100,
  connectedPeers: 0,
});

const createPeerId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
};

export class MatchNetwork {
  private readonly signaling = new SignalingClient();

  private readonly links = new Map<string, PeerLink>();

  private readonly clockSync = new ClockSynchronizer();

  private sessionInfo: SessionInfo = {
    mode: 'practice',
    matchSize: 4,
    connectedPlayerIds: [0, 1, 2, 3],
    expectedPlayerCount: 4,
    lobbyState: 'waiting',
    countdownStartAtMs: null,
    roomId: null,
    peerId: createPeerId(),
    isHost: true,
    localPlayerId: 0,
  };

  private peers: PeerRosterEntry[] = [];

  private stats = createStats();

  private readonly peerRoundTripMs = new Map<string, number>();

  private lastStateSequence = 0;

  private receivedStatePackets = 0;

  private droppedStatePackets = 0;

  private outgoingStateSequence = 0;

  constructor(private readonly callbacks: MatchNetworkCallbacks) {
    this.signaling.onMessage = (message) => {
      void this.handleSignalingMessage(message);
    };
  }

  async startHost(url: string, roomId: string, matchSize: MatchSize): Promise<SessionInfo> {
    this.resetConnections();
    return await this.joinRoom(url, roomId, 'host', matchSize);
  }

  async startClient(url: string, roomId: string): Promise<SessionInfo> {
    this.resetConnections();
    return await this.joinRoom(url, roomId, 'client');
  }

  broadcastMatchCountdown(startAtMs: number): void {
    if (!this.sessionInfo.isHost) {
      return;
    }

    this.signaling.sendMatchCountdown(startAtMs);
  }

  broadcastState(snapshot: GameSnapshot): void {
    if (!this.sessionInfo.isHost) {
      return;
    }

    this.outgoingStateSequence += 1;
    const payload = serializeStatePacket({
      ...snapshot,
      sequence: this.outgoingStateSequence,
    });
    this.links.forEach((link) => {
      if (link.isOpen()) {
        link.send(payload);
      }
    });
  }

  sendInput(input: InputFrame): void {
    if (this.sessionInfo.isHost) {
      return;
    }

    const hostLink = this.peers.find((peer) => peer.peerId !== this.sessionInfo.peerId && this.links.get(peer.peerId)?.isOpen());
    if (!hostLink) {
      return;
    }

    this.links.get(hostLink.peerId)?.send(serializeInputPacket(input));
  }

  getStats(): NetworkStats {
    return { ...this.stats };
  }

  close(): void {
    this.resetConnections();
    this.stats = createStats();
    this.sessionInfo = {
      mode: 'practice',
      matchSize: 4,
      connectedPlayerIds: [0, 1, 2, 3],
      expectedPlayerCount: 4,
      lobbyState: 'waiting',
      countdownStartAtMs: null,
      roomId: null,
      peerId: createPeerId(),
      isHost: true,
      localPlayerId: 0,
    };
    this.peers = [];
  }

  private async joinRoom(url: string, roomId: string, requestedMode: SessionMode, matchSize?: MatchSize): Promise<SessionInfo> {
    this.stats = createStats();
    const peerId = createPeerId();
    const joined = await this.signaling.connect(url, roomId, peerId, requestedMode, matchSize);
    if (requestedMode === 'host' && !joined.isHost) {
      this.signaling.leave();
      throw new Error(`Room ${joined.roomId} already has a host. Join it as a client instead.`);
    }

    const mode: SessionMode = joined.isHost ? 'host' : 'client';

    this.sessionInfo = {
      mode,
      matchSize: joined.matchSize,
      connectedPlayerIds: [...new Set(joined.peers.map((peer) => peer.playerId))].sort((left, right) => left - right),
      expectedPlayerCount: joined.matchSize,
      lobbyState: 'waiting',
      countdownStartAtMs: null,
      roomId: joined.roomId,
      peerId: joined.peerId,
      isHost: joined.isHost,
      localPlayerId: joined.playerId,
    };
    this.peers = joined.peers;
    this.updateConnectedPeers();
    this.callbacks.onSession(this.sessionInfo, this.peers);

    this.callbacks.onStatus(
      joined.isHost
        ? `Hosting a ${joined.matchSize}P room ${joined.roomId}.`
        : `Joined room ${joined.roomId} as ${this.describePlayer(joined.playerId)}.`,
    );

    return this.sessionInfo;
  }

  private resetConnections(): void {
    this.signaling.leave();
    this.links.forEach((link) => link.close());
    this.links.clear();
    this.peerRoundTripMs.clear();
    this.stats = createStats();
    this.clockSync.reset();
    this.lastStateSequence = 0;
    this.receivedStatePackets = 0;
    this.droppedStatePackets = 0;
    this.outgoingStateSequence = 0;
  }

  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    if (message.type === 'joined') {
      return;
    }

    if (message.type === 'peer-left') {
      this.peers = message.peers;
      this.sessionInfo.matchSize = message.matchSize;
      this.sessionInfo.connectedPlayerIds = [...new Set(this.peers.map((peer) => peer.playerId))].sort((left, right) => left - right);
      this.sessionInfo.expectedPlayerCount = message.matchSize;
      this.sessionInfo.lobbyState = this.sessionInfo.lobbyState === 'live' ? 'live' : 'waiting';
      this.sessionInfo.countdownStartAtMs = null;
      this.links.get(message.peerId)?.close();
      this.links.delete(message.peerId);
      this.updateConnectedPeers();
      this.callbacks.onSession(this.sessionInfo, this.peers);
      this.callbacks.onStatus(`${message.peerId.slice(0, 8)} left room ${message.roomId}.`);
      return;
    }

    if (message.type === 'peer-joined') {
      this.peers = message.peers;
      this.sessionInfo.matchSize = message.matchSize;
      this.sessionInfo.connectedPlayerIds = [...new Set(this.peers.map((peer) => peer.playerId))].sort((left, right) => left - right);
      this.sessionInfo.expectedPlayerCount = message.matchSize;
      this.sessionInfo.lobbyState = this.sessionInfo.lobbyState === 'live' ? 'live' : 'waiting';
      this.sessionInfo.countdownStartAtMs = null;
      this.updateConnectedPeers();
      this.callbacks.onSession(this.sessionInfo, this.peers);

      if (this.sessionInfo.isHost && message.peerId !== this.sessionInfo.peerId) {
        const link = this.ensureLink(message.peerId, true);
        await link.startNegotiation();
        this.callbacks.onStatus(`${message.peerId.slice(0, 8)} connected to room ${message.roomId}.`);
      }
      return;
    }

    if (message.type === 'host-migrated') {
      this.peers = message.peers;
      this.closePeerLinks();
      this.sessionInfo = {
        ...this.sessionInfo,
        matchSize: message.matchSize,
        connectedPlayerIds: [...new Set(this.peers.map((peer) => peer.playerId))].sort((left, right) => left - right),
        expectedPlayerCount: message.matchSize,
        lobbyState: this.sessionInfo.lobbyState === 'live' ? 'live' : 'waiting',
        countdownStartAtMs: null,
        isHost: message.hostPeerId === this.sessionInfo.peerId,
        mode: message.hostPeerId === this.sessionInfo.peerId ? 'host' : 'client',
      };
      this.updateConnectedPeers();
      this.callbacks.onSession(this.sessionInfo, this.peers);

      if (this.sessionInfo.isHost) {
        this.callbacks.onStatus(`Host migrated to ${this.describePlayer(this.sessionInfo.localPlayerId)}.`);
        await Promise.all(
          this.peers
            .filter((peer) => peer.peerId !== this.sessionInfo.peerId)
            .map(async (peer) => {
              const link = this.ensureLink(peer.peerId, true);
              await link.startNegotiation();
            }),
        );
      } else {
        this.callbacks.onStatus('Host migrated. Waiting for the new host to resume authority.');
      }
      return;
    }

    if (message.type === 'match-countdown') {
      this.sessionInfo.matchSize = message.matchSize;
      this.sessionInfo.expectedPlayerCount = message.matchSize;
      this.sessionInfo.lobbyState = 'countdown';
      this.sessionInfo.countdownStartAtMs = message.startAtMs;
      this.callbacks.onSession(this.sessionInfo, this.peers);
      return;
    }

    if (message.type === 'signal') {
      const initiator = false;
      const link = this.ensureLink(message.fromPeerId, initiator);
      await link.handleSignal(message.signal);
    }
  }

  private ensureLink(remotePeerId: string, initiator: boolean): PeerLink {
    const existing = this.links.get(remotePeerId);
    if (existing) {
      return existing;
    }

    const link = new PeerLink(initiator, {
      onSignal: (signal) => {
        this.signaling.sendSignal(remotePeerId, signal);
      },
      onInputPacket: (input) => {
        if (this.sessionInfo.isHost) {
          this.callbacks.onRemoteInput(input);
        }
      },
      onStatePacket: (snapshot, receivedAt) => {
        this.receivedStatePackets += 1;
        if (this.lastStateSequence && snapshot.sequence > this.lastStateSequence + 1) {
          this.droppedStatePackets += snapshot.sequence - this.lastStateSequence - 1;
        }
        this.lastStateSequence = snapshot.sequence;
        this.stats.packetLoss =
          this.receivedStatePackets + this.droppedStatePackets === 0
            ? 0
            : (this.droppedStatePackets / (this.receivedStatePackets + this.droppedStatePackets)) * 100;
        this.clockSync.observeSnapshot(snapshot.tick * (1000 / 60), receivedAt);
        this.stats.tickDriftMs = Math.abs(this.clockSync.getOffsetMs());
        this.stats.interpolationDelayMs = snapshot.interpolationDelayMs;
        this.callbacks.onSnapshot(snapshot, receivedAt);
      },
      onRoundTripTime: (roundTripMs) => {
        if (typeof roundTripMs === 'number' && Number.isFinite(roundTripMs)) {
          this.peerRoundTripMs.set(remotePeerId, roundTripMs);
          this.recomputePingStat();
        }
      },
      onOpen: () => {
        this.updateConnectedPeers();
      },
      onClose: () => {
        this.links.delete(remotePeerId);
        this.peerRoundTripMs.delete(remotePeerId);
        this.recomputePingStat();
        this.updateConnectedPeers();
      },
      onError: (message) => {
        this.callbacks.onStatus(message);
      },
    });

    this.links.set(remotePeerId, link);
    return link;
  }

  private closePeerLinks(): void {
    this.links.forEach((link) => link.close());
    this.links.clear();
  }

  private updateConnectedPeers(): void {
    const openConnections = [...this.links.values()].filter((link) => link.isOpen()).length;
    this.stats.connectedPeers = this.sessionInfo.isHost ? openConnections : Number(openConnections > 0);
    if (openConnections === 0) {
      this.stats.pingMs = 0;
    }
  }

  private recomputePingStat(): void {
    const roundTripSamples = [...this.peerRoundTripMs.entries()]
      .filter(([peerId]) => this.links.get(peerId)?.isOpen())
      .map(([, roundTripMs]) => roundTripMs);

    if (roundTripSamples.length === 0) {
      this.stats.pingMs = 0;
      return;
    }

    const averageRoundTripMs = roundTripSamples.reduce((sum, sample) => sum + sample, 0) / roundTripSamples.length;
    this.stats.pingMs = averageRoundTripMs;
  }

  private describePlayer(playerId: PlayerId): string {
    return ['Gold', 'Blue', 'Orange', 'Green'][playerId] ?? 'Unknown';
  }
}

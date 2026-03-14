import { NETWORK_SEND_HZ, PLAYER_DEFINITIONS, SIMULATION_HZ } from './constants';
import { ClientReplica } from './clientReplica';
import { MatchSimulation } from './simulation';
import type { GameSnapshot, InputFrame, NetworkStats, PlayerId, SessionInfo } from './types';
import { MatchNetwork } from '../network/session';
import type { PeerRosterEntry } from '../network/signaling';

const FIXED_STEP_MS = 1000 / SIMULATION_HZ;
const NETWORK_STEP_MS = 1000 / NETWORK_SEND_HZ;

export interface RuntimeCallbacks {
  onStatus: (message: string) => void;
  onSession: (info: SessionInfo) => void;
  onSnapshot: (snapshot: GameSnapshot) => void;
}

export class MatchRuntime {
  private simulation = new MatchSimulation();

  private replica = new ClientReplica(0);

  private readonly network = new MatchNetwork({
    onStatus: (message) => this.callbacks.onStatus(message),
    onSession: (info, peers) => this.handleSessionUpdate(info, peers),
    onRemoteInput: (input) => {
      this.remoteInputs.push(input);
    },
    onSnapshot: (snapshot, receivedAt) => {
      this.lastReceivedSnapshot = snapshot;
      this.replica.receiveSnapshot(snapshot, receivedAt);
      this.renderSnapshot = this.replica.getRenderSnapshot(receivedAt) ?? snapshot;
      this.callbacks.onSnapshot(this.renderSnapshot);
    },
  });

  private readonly sessionInfo: SessionInfo = {
    mode: 'practice',
    roomId: null,
    peerId: 'local-practice',
    isHost: true,
    localPlayerId: 0,
  };

  private fixedAccumulator = 0;

  private sendAccumulator = 0;

  private localAxis: -1 | 0 | 1 = 0;

  private boostQueued = false;

  private localSequence = 0;

  private paused = false;

  private renderSnapshot: GameSnapshot = this.simulation.getSnapshot();

  private lastReceivedSnapshot: GameSnapshot | null = null;

  private remoteInputs: InputFrame[] = [];

  constructor(private readonly callbacks: RuntimeCallbacks) {
    this.startPractice();
  }

  startPractice(): void {
    this.network.close();
    this.simulation = new MatchSimulation();
    PLAYER_DEFINITIONS.forEach((player) => this.simulation.setPlayerConnected(player.id, true));
    this.sessionInfo.mode = 'practice';
    this.sessionInfo.roomId = null;
    this.sessionInfo.peerId = 'local-practice';
    this.sessionInfo.isHost = true;
    this.sessionInfo.localPlayerId = 0;
    this.replica = new ClientReplica(0);
    this.fixedAccumulator = 0;
    this.sendAccumulator = 0;
    this.localSequence = 0;
    this.localAxis = 0;
    this.boostQueued = false;
    this.remoteInputs = [];
    this.lastReceivedSnapshot = null;
    this.renderSnapshot = this.simulation.getSnapshot();
    this.callbacks.onSession({ ...this.sessionInfo });
    this.callbacks.onSnapshot(this.renderSnapshot);
    this.callbacks.onStatus('Practice mode is live. Use A/D or Left/Right to move and Space to boost.');
  }

  async startHost(url: string, roomId: string): Promise<void> {
    await this.network.startHost(url, roomId);
  }

  async startClient(url: string, roomId: string): Promise<void> {
    await this.network.startClient(url, roomId);
  }

  leaveSession(): void {
    this.startPractice();
  }

  setMovementAxis(axis: -1 | 0 | 1): void {
    this.localAxis = axis;
  }

  queueBoost(): void {
    this.boostQueued = true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  update(deltaMs: number): void {
    if (this.paused) {
      return;
    }

    if (this.sessionInfo.isHost || this.sessionInfo.mode === 'practice') {
      this.updateAuthoritative(deltaMs);
      return;
    }

    this.updateReplica(deltaMs);
  }

  getRenderSnapshot(): GameSnapshot {
    return this.renderSnapshot;
  }

  getSessionInfo(): SessionInfo {
    return { ...this.sessionInfo };
  }

  getNetworkStats(): NetworkStats {
    if (this.sessionInfo.mode === 'practice') {
      return {
        pingMs: 0,
        packetLoss: 0,
        tickDriftMs: 0,
        interpolationDelayMs: this.renderSnapshot.interpolationDelayMs,
        connectedPeers: 0,
      };
    }

    return this.network.getStats();
  }

  private updateAuthoritative(deltaMs: number): void {
    this.fixedAccumulator += deltaMs;
    while (this.fixedAccumulator >= FIXED_STEP_MS) {
      this.simulation.applyInput(this.buildInputFrame());

      while (this.remoteInputs.length > 0) {
        const remote = this.remoteInputs.shift();
        if (remote) {
          this.simulation.applyInput(remote);
        }
      }

      const snapshot = this.simulation.step(FIXED_STEP_MS, performance.now());
      this.renderSnapshot = snapshot;
      this.callbacks.onSnapshot(snapshot);

      if (this.sessionInfo.mode === 'host') {
        this.sendAccumulator += FIXED_STEP_MS;
        if (this.sendAccumulator >= NETWORK_STEP_MS) {
          this.network.broadcastState(snapshot);
          this.sendAccumulator -= NETWORK_STEP_MS;
        }
      }

      this.fixedAccumulator -= FIXED_STEP_MS;
    }
  }

  private updateReplica(deltaMs: number): void {
    this.fixedAccumulator += deltaMs;
    while (this.fixedAccumulator >= FIXED_STEP_MS) {
      const input = this.buildInputFrame();
      this.replica.applyInput(input, FIXED_STEP_MS);
      this.sendAccumulator += FIXED_STEP_MS;
      if (this.sendAccumulator >= NETWORK_STEP_MS || input.boost) {
        this.network.sendInput(input);
        this.sendAccumulator = Math.max(0, this.sendAccumulator - NETWORK_STEP_MS);
      }
      this.fixedAccumulator -= FIXED_STEP_MS;
    }

    const replicaState = this.replica.getRenderSnapshot();
    if (replicaState) {
      this.renderSnapshot = replicaState;
      this.callbacks.onSnapshot(replicaState);
    }
  }

  private buildInputFrame(): InputFrame {
    const input: InputFrame = {
      playerId: this.sessionInfo.localPlayerId,
      sequence: this.localSequence,
      axis: this.localAxis,
      boost: this.boostQueued,
      clientTime: Math.round(performance.now()),
    };
    this.localSequence += 1;
    this.boostQueued = false;
    return input;
  }

  private handleSessionUpdate(info: SessionInfo, peers: PeerRosterEntry[]): void {
    this.sessionInfo.mode = info.mode;
    this.sessionInfo.roomId = info.roomId;
    this.sessionInfo.peerId = info.peerId;
    this.sessionInfo.isHost = info.isHost;
    this.sessionInfo.localPlayerId = info.localPlayerId;

    if (info.isHost) {
      this.promoteToHost(info.localPlayerId, this.lastReceivedSnapshot);
    } else {
      this.replica = new ClientReplica(info.localPlayerId);
      if (this.lastReceivedSnapshot) {
        this.replica.receiveSnapshot(this.lastReceivedSnapshot, performance.now());
      }
      this.fixedAccumulator = 0;
      this.sendAccumulator = 0;
      this.localSequence = 0;
    }

    this.syncConnectedPlayers(peers);
    this.callbacks.onSession({ ...this.sessionInfo });
  }

  private promoteToHost(localPlayerId: PlayerId, baseSnapshot: GameSnapshot | null): void {
    this.sessionInfo.mode = this.sessionInfo.roomId ? 'host' : 'practice';
    this.sessionInfo.isHost = true;
    this.sessionInfo.localPlayerId = localPlayerId;
    this.simulation = new MatchSimulation();
    if (baseSnapshot) {
      this.simulation.loadSnapshot(baseSnapshot);
    }
    this.fixedAccumulator = 0;
    this.sendAccumulator = 0;
    this.localSequence = 0;
    this.localAxis = 0;
    this.boostQueued = false;
    this.remoteInputs = [];
    this.renderSnapshot = this.simulation.getSnapshot();
    this.callbacks.onSession({ ...this.sessionInfo });
    this.callbacks.onSnapshot(this.renderSnapshot);
  }

  private syncConnectedPlayers(peers: PeerRosterEntry[]): void {
    if (!(this.sessionInfo.isHost || this.sessionInfo.mode === 'practice')) {
      return;
    }

    PLAYER_DEFINITIONS.forEach((player) => {
      const connected = peers.some((peer) => peer.playerId === player.id) || this.sessionInfo.mode === 'practice';
      this.simulation.setPlayerConnected(player.id, connected);
    });
  }
}

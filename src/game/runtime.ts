import {
  ARENA_HALF_SIZE,
  BALL_RADIUS,
  CHAMFER_SIZE,
  getActivePlayerIds,
  isPlayerActive,
  NETWORK_SEND_HZ,
  PLAYER_DEFINITIONS,
  PLAYER_RADIUS,
  PRACTICE_STUCK_PLAYER_MARGIN,
  PRACTICE_STUCK_SPEED_EPSILON,
  PRACTICE_STUCK_TIMEOUT_MS,
  PRACTICE_STUCK_WALL_MARGIN,
  SIMULATION_HZ,
} from './constants';
import { ClientReplica } from './clientReplica';
import { MatchSimulation } from './simulation';
import type { GameSnapshot, InputFrame, MatchSize, NetworkStats, PlayerId, SessionInfo } from './types';
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
    matchSize: 4,
    roomId: null,
    peerId: 'local-practice',
    isHost: true,
    localPlayerId: 0,
  };

  private fixedAccumulator = 0;

  private sendAccumulator = 0;

  private localAxis: -1 | 0 | 1 = 0;

  private localSequence = 0;

  private paused = false;

  private renderSnapshot: GameSnapshot = this.simulation.getSnapshot();

  private lastReceivedSnapshot: GameSnapshot | null = null;

  private remoteInputs: InputFrame[] = [];

  private practiceServeIndex = 0;

  private practiceTrapElapsedMs = 0;

  private practiceActive = false;

  constructor(private readonly callbacks: RuntimeCallbacks) {
    this.resetLocalPractice(4, false);
    this.callbacks.onStatus('Select Practice or Multiplayer to begin.');
  }

  startPractice(matchSize: MatchSize): void {
    this.resetLocalPractice(matchSize, true);
    this.callbacks.onStatus('Practice mode is live. Use A/D or Left/Right to move. Boost triggers automatically on contact.');
  }

  async startHost(url: string, roomId: string, matchSize: MatchSize): Promise<void> {
    this.practiceActive = false;
    await this.network.startHost(url, roomId, matchSize);
  }

  async startClient(url: string, roomId: string): Promise<void> {
    this.practiceActive = false;
    await this.network.startClient(url, roomId);
  }

  leaveSession(): void {
    this.resetLocalPractice(this.sessionInfo.matchSize, false);
    this.callbacks.onStatus('Session closed. Choose Practice or Multiplayer to continue.');
  }

  setMovementAxis(axis: -1 | 0 | 1): void {
    this.localAxis = axis;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  update(deltaMs: number): void {
    if (this.paused) {
      return;
    }

    if (this.sessionInfo.mode === 'practice' && !this.practiceActive) {
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

  private resetLocalPractice(matchSize: MatchSize, startPlaying: boolean): void {
    this.network.close();
    this.simulation = new MatchSimulation();
    this.simulation.setMatchSize(matchSize);
    PLAYER_DEFINITIONS.forEach((player) => this.simulation.setPlayerConnected(player.id, isPlayerActive(player.id, matchSize)));
    this.sessionInfo.mode = 'practice';
    this.sessionInfo.matchSize = matchSize;
    this.sessionInfo.roomId = null;
    this.sessionInfo.peerId = 'local-practice';
    this.sessionInfo.isHost = true;
    this.sessionInfo.localPlayerId = 0;
    this.replica = new ClientReplica(0);
    this.fixedAccumulator = 0;
    this.sendAccumulator = 0;
    this.localSequence = 0;
    this.localAxis = 0;
    this.remoteInputs = [];
    this.lastReceivedSnapshot = null;
    this.practiceServeIndex = 0;
    this.practiceTrapElapsedMs = 0;
    this.practiceActive = startPlaying;
    this.renderSnapshot = this.simulation.getSnapshot();
    if (startPlaying) {
      this.kickoffPracticeBall();
    }
    this.callbacks.onSession({ ...this.sessionInfo });
    this.renderSnapshot = this.simulation.getSnapshot();
    this.callbacks.onSnapshot(this.renderSnapshot);
  }

  private updateAuthoritative(deltaMs: number): void {
    this.fixedAccumulator += deltaMs;
    while (this.fixedAccumulator >= FIXED_STEP_MS) {
      this.simulation.applyInput(this.buildInputFrame());
      if (this.sessionInfo.mode === 'practice') {
        this.applyPracticeBots();
      }

      while (this.remoteInputs.length > 0) {
        const remote = this.remoteInputs.shift();
        if (remote) {
          this.simulation.applyInput(remote);
        }
      }

      let snapshot = this.simulation.step(FIXED_STEP_MS, performance.now());
      if (this.sessionInfo.mode === 'practice') {
        snapshot = this.ensurePracticeBallIsLive(snapshot);
      }
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
      if (this.sendAccumulator >= NETWORK_STEP_MS) {
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
      boost: false,
      clientTime: Math.round(performance.now()),
    };
    this.localSequence += 1;
    return input;
  }

  private applyPracticeBots(): void {
    const snapshot = this.simulation.getSnapshot();

    PLAYER_DEFINITIONS.forEach((definition) => {
      if (definition.id === this.sessionInfo.localPlayerId || !isPlayerActive(definition.id, this.sessionInfo.matchSize)) {
        return;
      }

      const player = snapshot.players[definition.id];
      const target = definition.axis === 'x' ? snapshot.ball.x : snapshot.ball.y;
      const delta = target - player.railPosition;
      const axis: -1 | 0 | 1 = Math.abs(delta) < 12 ? 0 : delta > 0 ? 1 : -1;
      this.simulation.applyInput({
        playerId: definition.id,
        sequence: 0,
        axis,
        boost: false,
        clientTime: Math.round(performance.now()),
      });
    });
  }

  private ensurePracticeBallIsLive(snapshot: GameSnapshot): GameSnapshot {
    if (this.isPracticeBallTrapped(snapshot)) {
      this.practiceTrapElapsedMs += FIXED_STEP_MS;
      if (this.practiceTrapElapsedMs >= PRACTICE_STUCK_TIMEOUT_MS) {
        this.kickoffPracticeBall();
        this.practiceTrapElapsedMs = 0;
        return this.simulation.getSnapshot();
      }
    } else {
      this.practiceTrapElapsedMs = 0;
    }

    const speed = Math.hypot(snapshot.ball.vx, snapshot.ball.vy);
    const centered = Math.abs(snapshot.ball.x) < 1 && Math.abs(snapshot.ball.y) < 1;
    if (snapshot.phase === 'playing' && centered && speed < 0.05) {
      this.kickoffPracticeBall();
      this.practiceTrapElapsedMs = 0;
      return this.simulation.getSnapshot();
    }
    return snapshot;
  }

  private kickoffPracticeBall(): void {
    const directions = [
      { x: 9.2, y: 5.8 },
      { x: -9.0, y: 6.1 },
      { x: 8.8, y: -6.2 },
      { x: -9.4, y: -5.9 },
    ];
    const direction = directions[this.practiceServeIndex % directions.length];
    this.practiceServeIndex += 1;
    this.simulation.serveBall(direction);
  }

  private isPracticeBallTrapped(snapshot: GameSnapshot): boolean {
    if (snapshot.phase !== 'playing') {
      return false;
    }

    const speed = Math.hypot(snapshot.ball.vx, snapshot.ball.vy);
    if (speed > PRACTICE_STUCK_SPEED_EPSILON) {
      return false;
    }

    const nearPlayer = snapshot.players.some((player) => {
      const definition = PLAYER_DEFINITIONS[player.id];
      const playerX = definition.axis === 'x' ? player.railPosition : definition.fixedCoord;
      const playerY = definition.axis === 'x' ? definition.fixedCoord : player.railPosition;
      const distance = Math.hypot(snapshot.ball.x - playerX, snapshot.ball.y - playerY);
      return distance <= PLAYER_RADIUS + BALL_RADIUS + PRACTICE_STUCK_PLAYER_MARGIN;
    });

    if (!nearPlayer) {
      return false;
    }

    const maxAxis = ARENA_HALF_SIZE - BALL_RADIUS;
    const diagonalLimit = (ARENA_HALF_SIZE + (ARENA_HALF_SIZE - CHAMFER_SIZE)) - BALL_RADIUS * Math.SQRT2;
    const nearStraightWall =
      Math.abs(snapshot.ball.x) >= maxAxis - PRACTICE_STUCK_WALL_MARGIN ||
      Math.abs(snapshot.ball.y) >= maxAxis - PRACTICE_STUCK_WALL_MARGIN;
    const nearChamferWall =
      Math.abs(snapshot.ball.x + snapshot.ball.y) >= diagonalLimit - PRACTICE_STUCK_WALL_MARGIN ||
      Math.abs(snapshot.ball.x - snapshot.ball.y) >= diagonalLimit - PRACTICE_STUCK_WALL_MARGIN;

    return nearStraightWall || nearChamferWall;
  }

  private handleSessionUpdate(info: SessionInfo, peers: PeerRosterEntry[]): void {
    this.sessionInfo.mode = info.mode;
    this.sessionInfo.matchSize = info.matchSize;
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
    this.simulation.setMatchSize(this.sessionInfo.matchSize);
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
      const connected =
        isPlayerActive(player.id, this.sessionInfo.matchSize) &&
        (peers.some((peer) => peer.playerId === player.id) || this.sessionInfo.mode === 'practice');
      this.simulation.setPlayerConnected(player.id, connected);
    });
  }
}

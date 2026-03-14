import { BOOST_COOLDOWN_MS, INTERPOLATION_DELAY_MS, PLAYER_DEFINITIONS, PLAYER_SPEED, SIMULATION_HZ } from './constants';
import { ClockSynchronizer } from './clock';
import type { GameSnapshot, InputFrame, PlayerId } from './types';

type TimedSnapshot = {
  snapshot: GameSnapshot;
  timelineMs: number;
};

const FIXED_STEP_MS = 1000 / SIMULATION_HZ;

const cloneSnapshot = (snapshot: GameSnapshot): GameSnapshot => ({
  ...snapshot,
  ball: { ...snapshot.ball },
  players: snapshot.players.map((player) => ({ ...player })),
  score: { ...snapshot.score },
});

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

export class ClientReplica {
  private readonly clock = new ClockSynchronizer();

  private snapshots: TimedSnapshot[] = [];

  private predictedRailPosition = 0;

  private predictedVelocity = 0;

  private predictedBoostCooldownMs = 0;

  private initializedPrediction = false;

  private latestSnapshot: GameSnapshot | null = null;

  constructor(private localPlayerId: PlayerId) {}

  setLocalPlayerId(playerId: PlayerId): void {
    this.localPlayerId = playerId;
    this.initializedPrediction = false;
  }

  receiveSnapshot(snapshot: GameSnapshot, receivedAt: number): void {
    const cloned = cloneSnapshot(snapshot);
    const timelineMs = snapshot.tick * FIXED_STEP_MS;
    this.clock.observeSnapshot(timelineMs, receivedAt);
    this.snapshots.push({ snapshot: cloned, timelineMs });
    this.snapshots = this.snapshots.slice(-5);
    this.latestSnapshot = cloned;

    const authoritativePlayer = cloned.players[this.localPlayerId];
    if (!this.initializedPrediction) {
      this.predictedRailPosition = authoritativePlayer.railPosition;
      this.predictedVelocity = authoritativePlayer.velocity;
      this.predictedBoostCooldownMs = authoritativePlayer.boostCooldownMs;
      this.initializedPrediction = true;
      return;
    }

    const correction = authoritativePlayer.railPosition - this.predictedRailPosition;
    if (Math.abs(correction) > 36) {
      this.predictedRailPosition = authoritativePlayer.railPosition;
    } else {
      this.predictedRailPosition += correction * 0.35;
    }
    this.predictedVelocity = authoritativePlayer.velocity;
    this.predictedBoostCooldownMs = authoritativePlayer.boostCooldownMs;
  }

  applyInput(input: InputFrame, deltaMs: number): void {
    if (!this.initializedPrediction) {
      return;
    }

    const definition = PLAYER_DEFINITIONS[this.localPlayerId];
    const deltaSeconds = deltaMs / 1000;
    const previousPosition = this.predictedRailPosition;
    this.predictedRailPosition = Math.min(
      definition.railMax,
      Math.max(definition.railMin, this.predictedRailPosition + input.axis * PLAYER_SPEED * deltaSeconds),
    );
    this.predictedVelocity = (this.predictedRailPosition - previousPosition) / deltaSeconds;
    this.predictedBoostCooldownMs = Math.max(0, this.predictedBoostCooldownMs - deltaMs);
    if (input.boost && this.predictedBoostCooldownMs === 0) {
      this.predictedBoostCooldownMs = BOOST_COOLDOWN_MS;
    }
  }

  getRenderSnapshot(now = performance.now()): GameSnapshot | null {
    if (this.snapshots.length === 0) {
      return this.latestSnapshot ? cloneSnapshot(this.latestSnapshot) : null;
    }

    const targetTimeline = this.clock.getSynchronizedNow(now) - INTERPOLATION_DELAY_MS;
    let previous = this.snapshots[0];
    let next = this.snapshots[this.snapshots.length - 1];

    for (let index = 0; index < this.snapshots.length - 1; index += 1) {
      const current = this.snapshots[index];
      const candidate = this.snapshots[index + 1];
      if (current.timelineMs <= targetTimeline && candidate.timelineMs >= targetTimeline) {
        previous = current;
        next = candidate;
        break;
      }
    }

    const duration = Math.max(1, next.timelineMs - previous.timelineMs);
    const alpha = previous === next ? 1 : Math.min(1, Math.max(0, (targetTimeline - previous.timelineMs) / duration));

    const interpolated = cloneSnapshot(previous.snapshot);
    interpolated.tick = Math.round(lerp(previous.snapshot.tick, next.snapshot.tick, alpha));
    interpolated.ball.x = lerp(previous.snapshot.ball.x, next.snapshot.ball.x, alpha);
    interpolated.ball.y = lerp(previous.snapshot.ball.y, next.snapshot.ball.y, alpha);
    interpolated.ball.vx = lerp(previous.snapshot.ball.vx, next.snapshot.ball.vx, alpha);
    interpolated.ball.vy = lerp(previous.snapshot.ball.vy, next.snapshot.ball.vy, alpha);

    interpolated.players = previous.snapshot.players.map((player, index) => {
      const future = next.snapshot.players[index];
      return {
        ...player,
        railPosition: lerp(player.railPosition, future.railPosition, alpha),
        velocity: lerp(player.velocity, future.velocity, alpha),
        boostCooldownMs: lerp(player.boostCooldownMs, future.boostCooldownMs, alpha),
      };
    });

    if (this.initializedPrediction) {
      interpolated.players[this.localPlayerId] = {
        ...interpolated.players[this.localPlayerId],
        railPosition: this.predictedRailPosition,
        velocity: this.predictedVelocity,
        boostCooldownMs: this.predictedBoostCooldownMs,
      };
    }

    return interpolated;
  }

  getLatestSnapshot(): GameSnapshot | null {
    return this.latestSnapshot ? cloneSnapshot(this.latestSnapshot) : null;
  }
}

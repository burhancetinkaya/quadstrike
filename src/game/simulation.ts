import Matter from 'matter-js';

import {
  AUTO_BOOST_TRIGGER_MARGIN,
  ARENA_HALF_SIZE,
  BALL_RADIUS,
  BALL_TRAVEL_SPEED,
  BALL_STUCK_POSITION_EPSILON,
  BALL_STUCK_SPEED_EPSILON,
  BALL_STUCK_TIMEOUT_MS,
  BOOST_CONTACT_EPSILON,
  BOOST_COOLDOWN_MS,
  BOOST_FORCE,
  CHAMFER_SIZE,
  GOAL_FREEZE_MS,
  GOAL_HALF_WIDTH,
  GOAL_SCORE_HALF_WIDTH,
  GOAL_TRIGGER_HALF_WIDTH,
  INTERPOLATION_DELAY_MS,
  isGoalSideActive,
  MATCH_DURATION_MS,
  PLAYER_DEFINITIONS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SIMULATION_HZ,
  WALL_THICKNESS,
} from './constants';
import type {
  GameSnapshot,
  InputFrame,
  MatchPhase,
  MatchSize,
  PlayerDefinition,
  PlayerId,
  PlayerState,
  RailSide,
  ScoreState,
  Vec2,
} from './types';

const {
  Bodies,
  Body,
  Composite,
  Engine,
  Events,
  Vector,
} = Matter;

type InternalPlayer = {
  definition: PlayerDefinition;
  body: Matter.Body;
  state: PlayerState;
  desiredAxis: -1 | 0 | 1;
};

type GoalSensor = {
  side: RailSide;
  body: Matter.Body;
};

type GoalBlocker = {
  side: RailSide;
  body: Matter.Body;
};

const createScoreState = (): ScoreState => ({
  white: 0,
  blue: 0,
  orange: 0,
  green: 0,
});

const railToWorld = (definition: PlayerDefinition, railPosition: number): Vec2 =>
  definition.axis === 'x'
    ? { x: railPosition, y: definition.fixedCoord }
    : { x: definition.fixedCoord, y: railPosition };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const FIXED_STEP_MS = 1000 / SIMULATION_HZ;

export class MatchSimulation {
  readonly engine = Engine.create({
    gravity: { x: 0, y: 0 },
    enableSleeping: false,
  });

  private readonly ball = Bodies.circle(0, 0, BALL_RADIUS, {
    restitution: 0.9,
    frictionAir: 0,
    mass: 1,
    label: 'ball',
  });

  private readonly players: InternalPlayer[];

  private readonly goalSensors: GoalSensor[];

  private readonly goalBlockers: GoalBlocker[];

  private matchSize: MatchSize = 4;

  private phase: MatchPhase = 'playing';

  private score: ScoreState = createScoreState();

  private tick = 0;

  private networkSequence = 0;

  private scorerId: PlayerId | null = null;

  private lastTouchedBy: PlayerId | null = null;

  private goalFreezeRemainingMs = 0;

  private stuckElapsedMs = 0;

  private lastStuckSample: Vec2 = { x: 0, y: 0 };

  constructor() {
    this.players = PLAYER_DEFINITIONS.map((definition) => {
      const start = railToWorld(definition, definition.spawn);
      const body = Bodies.circle(start.x, start.y, PLAYER_RADIUS, {
        isStatic: true,
        restitution: 1,
        friction: 0,
        frictionStatic: 0,
        label: `player:${definition.id}`,
      });
      return {
        definition,
        body,
        desiredAxis: 0,
        state: {
          id: definition.id,
          railPosition: definition.spawn,
          velocity: 0,
          boostCooldownMs: 0,
          connected: definition.id === 0,
        },
      };
    });

    this.goalSensors = this.createGoalSensors();
    this.goalBlockers = this.createGoalBlockers();

    Composite.add(this.engine.world, [
      ...this.createArenaBodies(),
      this.ball,
      ...this.players.map((player) => player.body),
      ...this.goalSensors.map((sensor) => sensor.body),
      ...this.goalBlockers.map((blocker) => blocker.body),
    ]);

    Events.on(this.engine, 'collisionStart', (event: Matter.IEventCollision<Matter.Engine>) => {
      this.handleCollisionStart(event);
    });

    this.resetBodies();
    this.syncGoalBlockers();
  }

  applyInput(input: InputFrame): void {
    const player = this.players[input.playerId];
    if (!player || !player.state.connected) {
      return;
    }
    player.desiredAxis = input.axis;
  }

  setPlayerConnected(playerId: PlayerId, connected: boolean): void {
    const player = this.players[playerId];
    if (!player) {
      return;
    }
    player.state.connected = connected;
    player.desiredAxis = connected ? player.desiredAxis : 0;
    player.state.velocity = connected ? player.state.velocity : 0;
    player.body.collisionFilter.category = 0x0001;
    player.body.collisionFilter.mask = connected ? 0xffffffff : 0;
  }

  setMatchSize(matchSize: MatchSize): void {
    this.matchSize = matchSize;
    this.syncGoalBlockers();
  }

  step(deltaMs: number, hostTime = performance.now()): GameSnapshot {
    this.tick += 1;

    if (this.tick * FIXED_STEP_MS >= MATCH_DURATION_MS) {
      this.players.forEach((player) => {
        player.state.velocity = 0;
        player.desiredAxis = 0;
      });
      Body.setVelocity(this.ball, { x: 0, y: 0 });
      return this.createSnapshot(hostTime);
    }

    if (this.phase === 'goal') {
      this.goalFreezeRemainingMs = Math.max(0, this.goalFreezeRemainingMs - deltaMs);
      if (this.goalFreezeRemainingMs === 0) {
        this.phase = 'playing';
        this.scorerId = null;
        this.lastTouchedBy = null;
        this.resetBodies();
      }
      return this.createSnapshot(hostTime);
    }

    const deltaSeconds = deltaMs / 1000;
    this.players.forEach((player) => {
      const previousPosition = player.state.railPosition;
      player.state.railPosition = clamp(
        player.state.railPosition + player.desiredAxis * PLAYER_SPEED * deltaSeconds,
        player.definition.railMin,
        player.definition.railMax,
      );
      player.state.velocity = (player.state.railPosition - previousPosition) / deltaSeconds;
      player.state.boostCooldownMs = Math.max(0, player.state.boostCooldownMs - deltaMs);
      const position = railToWorld(player.definition, player.state.railPosition);
      Body.setPosition(player.body, position);
    });

    this.applyAutomaticBoosts();
    Engine.update(this.engine, deltaMs);
    this.normalizeBallSpeed();
    this.detectGoalFromBallPosition();
    this.constrainBallInsideArena();
    this.updateStuckDetection(deltaMs);

    return this.createSnapshot(hostTime);
  }

  getSnapshot(hostTime = performance.now()): GameSnapshot {
    return this.createSnapshot(hostTime);
  }

  serveBall(direction: Vec2): void {
    Body.setPosition(this.ball, { x: 0, y: 0 });
    const normalised = Vector.magnitude(direction) === 0 ? { x: BALL_TRAVEL_SPEED, y: 0 } : Vector.normalise(direction);
    Body.setVelocity(this.ball, { x: normalised.x * BALL_TRAVEL_SPEED, y: normalised.y * BALL_TRAVEL_SPEED });
    this.resetStuckDetection();
  }

  loadSnapshot(snapshot: GameSnapshot): void {
    this.tick = snapshot.tick;
    this.phase = snapshot.phase;
    this.score = { ...snapshot.score };
    this.scorerId = snapshot.scorerId;
    this.lastTouchedBy = snapshot.lastTouchedBy;
    this.networkSequence = snapshot.sequence;
    Body.setPosition(this.ball, { x: snapshot.ball.x, y: snapshot.ball.y });
    Body.setVelocity(this.ball, { x: snapshot.ball.vx, y: snapshot.ball.vy });
    this.resetStuckDetection();

    snapshot.players.forEach((state) => {
      const player = this.players[state.id];
      player.state = { ...state };
      const position = railToWorld(player.definition, state.railPosition);
      Body.setPosition(player.body, position);
    });
    this.syncGoalBlockers();
  }

  private createArenaBodies(): Matter.Body[] {
    const bodies: Matter.Body[] = [];
    const sideSpan = ARENA_HALF_SIZE - CHAMFER_SIZE;
    const horizontalSegmentLength = sideSpan - GOAL_HALF_WIDTH;
    const verticalSegmentLength = sideSpan - GOAL_HALF_WIDTH;
    const diagonalLength = Math.sqrt(CHAMFER_SIZE ** 2 + CHAMFER_SIZE ** 2);
    const diagonalOffset = ARENA_HALF_SIZE - CHAMFER_SIZE * 0.5;

    const createWall = (x: number, y: number, width: number, height: number, angle = 0) =>
      Bodies.rectangle(x, y, width, height, {
        isStatic: true,
        angle,
        restitution: 1,
        friction: 0,
        label: 'arena',
      });

    const tryPushWall = (x: number, y: number, width: number, height: number, angle = 0): void => {
      if (width <= 0 || height <= 0) {
        return;
      }
      bodies.push(createWall(x, y, width, height, angle));
    };

    tryPushWall(
      -GOAL_HALF_WIDTH - horizontalSegmentLength * 0.5,
      -ARENA_HALF_SIZE,
      horizontalSegmentLength,
      WALL_THICKNESS,
    );
    tryPushWall(
      GOAL_HALF_WIDTH + horizontalSegmentLength * 0.5,
      -ARENA_HALF_SIZE,
      horizontalSegmentLength,
      WALL_THICKNESS,
    );
    tryPushWall(
      -GOAL_HALF_WIDTH - horizontalSegmentLength * 0.5,
      ARENA_HALF_SIZE,
      horizontalSegmentLength,
      WALL_THICKNESS,
    );
    tryPushWall(
      GOAL_HALF_WIDTH + horizontalSegmentLength * 0.5,
      ARENA_HALF_SIZE,
      horizontalSegmentLength,
      WALL_THICKNESS,
    );
    tryPushWall(
      -ARENA_HALF_SIZE,
      -GOAL_HALF_WIDTH - verticalSegmentLength * 0.5,
      WALL_THICKNESS,
      verticalSegmentLength,
    );
    tryPushWall(
      -ARENA_HALF_SIZE,
      GOAL_HALF_WIDTH + verticalSegmentLength * 0.5,
      WALL_THICKNESS,
      verticalSegmentLength,
    );
    tryPushWall(
      ARENA_HALF_SIZE,
      -GOAL_HALF_WIDTH - verticalSegmentLength * 0.5,
      WALL_THICKNESS,
      verticalSegmentLength,
    );
    tryPushWall(
      ARENA_HALF_SIZE,
      GOAL_HALF_WIDTH + verticalSegmentLength * 0.5,
      WALL_THICKNESS,
      verticalSegmentLength,
    );

    bodies.push(
      createWall(-diagonalOffset, -diagonalOffset, diagonalLength, WALL_THICKNESS, Math.PI / 4),
      createWall(diagonalOffset, -diagonalOffset, diagonalLength, WALL_THICKNESS, -Math.PI / 4),
      createWall(diagonalOffset, diagonalOffset, diagonalLength, WALL_THICKNESS, Math.PI / 4),
      createWall(-diagonalOffset, diagonalOffset, diagonalLength, WALL_THICKNESS, -Math.PI / 4),
    );

    return bodies;
  }

  private createGoalSensors(): GoalSensor[] {
    return [
      {
        side: 'north',
        body: Bodies.rectangle(0, -ARENA_HALF_SIZE - 44, GOAL_SCORE_HALF_WIDTH * 2, 44, {
          isStatic: true,
          isSensor: true,
          label: 'goal:north',
        }),
      },
      {
        side: 'east',
        body: Bodies.rectangle(ARENA_HALF_SIZE + 44, 0, 44, GOAL_SCORE_HALF_WIDTH * 2, {
          isStatic: true,
          isSensor: true,
          label: 'goal:east',
        }),
      },
      {
        side: 'south',
        body: Bodies.rectangle(0, ARENA_HALF_SIZE + 44, GOAL_SCORE_HALF_WIDTH * 2, 44, {
          isStatic: true,
          isSensor: true,
          label: 'goal:south',
        }),
      },
      {
        side: 'west',
        body: Bodies.rectangle(-ARENA_HALF_SIZE - 44, 0, 44, GOAL_SCORE_HALF_WIDTH * 2, {
          isStatic: true,
          isSensor: true,
          label: 'goal:west',
        }),
      },
    ];
  }

  private createGoalBlockers(): GoalBlocker[] {
    return [
      {
        side: 'north',
        body: Bodies.rectangle(0, -ARENA_HALF_SIZE, GOAL_SCORE_HALF_WIDTH * 2, WALL_THICKNESS, {
          isStatic: true,
          label: 'goal-blocker:north',
        }),
      },
      {
        side: 'east',
        body: Bodies.rectangle(ARENA_HALF_SIZE, 0, WALL_THICKNESS, GOAL_SCORE_HALF_WIDTH * 2, {
          isStatic: true,
          label: 'goal-blocker:east',
        }),
      },
      {
        side: 'south',
        body: Bodies.rectangle(0, ARENA_HALF_SIZE, GOAL_SCORE_HALF_WIDTH * 2, WALL_THICKNESS, {
          isStatic: true,
          label: 'goal-blocker:south',
        }),
      },
      {
        side: 'west',
        body: Bodies.rectangle(-ARENA_HALF_SIZE, 0, WALL_THICKNESS, GOAL_SCORE_HALF_WIDTH * 2, {
          isStatic: true,
          label: 'goal-blocker:west',
        }),
      },
    ];
  }

  private syncGoalBlockers(): void {
    this.goalBlockers.forEach((blocker) => {
      blocker.body.collisionFilter.category = 0x0001;
      blocker.body.collisionFilter.mask = isGoalSideActive(blocker.side, this.matchSize) ? 0 : 0xffffffff;
    });
  }

  private handleCollisionStart(event: Matter.IEventCollision<Matter.Engine>): void {
    event.pairs.forEach((pair: Matter.Pair) => {
      const labels = [pair.bodyA.label, pair.bodyB.label];

      if (labels.includes('ball') && labels.some((label) => label.startsWith('goal:'))) {
        const goalLabel = labels.find((label) => label.startsWith('goal:'));
        if (goalLabel && isGoalSideActive(goalLabel.replace('goal:', '') as RailSide, this.matchSize)) {
          this.handleGoal(goalLabel.replace('goal:', '') as RailSide);
        }
      }

      const playerBody = [pair.bodyA, pair.bodyB].find((body) => body.label.startsWith('player:'));
      const ballBody = [pair.bodyA, pair.bodyB].find((body) => body.label === 'ball');
      if (!playerBody || !ballBody) {
        return;
      }

      const playerId = Number(playerBody.label.split(':')[1]) as PlayerId;
      const player = this.players[playerId];
      if (!player.state.connected) {
        return;
      }
      this.lastTouchedBy = playerId;
      this.resetStuckDetection();

      const playerVelocity =
        player.definition.axis === 'x'
          ? { x: player.state.velocity, y: 0 }
          : { x: 0, y: player.state.velocity };

      Body.setVelocity(this.ball, {
        x: this.ball.velocity.x + playerVelocity.x * 0.05,
        y: this.ball.velocity.y + playerVelocity.y * 0.05,
      });

    });
  }

  private applyAutomaticBoosts(): void {
    this.players.forEach((player) => {
      if (!player.state.connected || player.state.boostCooldownMs > 0) {
        return;
      }

      const delta = Vector.sub(this.ball.position, player.body.position);
      const distance = Vector.magnitude(delta);
      if (distance > PLAYER_RADIUS + BALL_RADIUS + AUTO_BOOST_TRIGGER_MARGIN) {
        return;
      }

      const direction = distance === 0 ? { x: 0, y: 0 } : Vector.normalise(delta);
      Body.applyForce(this.ball, this.ball.position, {
        x: direction.x * BOOST_FORCE,
        y: direction.y * BOOST_FORCE,
      });
      player.state.boostCooldownMs = BOOST_COOLDOWN_MS;
      this.lastTouchedBy = player.definition.id;
      this.resetStuckDetection();
    });
  }

  private normalizeBallSpeed(): void {
    const speed = Vector.magnitude(this.ball.velocity);
    if (speed <= 0.0001) {
      return;
    }

    const direction = Vector.normalise(this.ball.velocity);
    Body.setVelocity(this.ball, {
      x: direction.x * BALL_TRAVEL_SPEED,
      y: direction.y * BALL_TRAVEL_SPEED,
    });
  }

  private handleGoal(_side: RailSide): void {
    if (this.phase === 'goal') {
      return;
    }
    if (!isGoalSideActive(_side, this.matchSize)) {
      return;
    }

    this.phase = 'goal';
    this.goalFreezeRemainingMs = GOAL_FREEZE_MS;
    this.scorerId = this.lastTouchedBy;

    const concededPlayer = PLAYER_DEFINITIONS.find((player) => player.railSide === _side);
    if (concededPlayer) {
      this.score[concededPlayer.key] += 1;
    }

    Body.setVelocity(this.ball, { x: 0, y: 0 });
  }

  private detectGoalFromBallPosition(): void {
    if (this.phase !== 'playing') {
      return;
    }

    if (isGoalSideActive('north', this.matchSize) && Math.abs(this.ball.position.x) <= GOAL_TRIGGER_HALF_WIDTH) {
      if (this.ball.position.y <= -ARENA_HALF_SIZE + BALL_RADIUS) {
        this.handleGoal('north');
        return;
      }
    }

    if (isGoalSideActive('south', this.matchSize) && Math.abs(this.ball.position.x) <= GOAL_TRIGGER_HALF_WIDTH) {
      if (this.ball.position.y >= ARENA_HALF_SIZE - BALL_RADIUS) {
        this.handleGoal('south');
        return;
      }
    }

    if (isGoalSideActive('west', this.matchSize) && Math.abs(this.ball.position.y) <= GOAL_TRIGGER_HALF_WIDTH) {
      if (this.ball.position.x <= -ARENA_HALF_SIZE + BALL_RADIUS) {
        this.handleGoal('west');
        return;
      }
    }

    if (isGoalSideActive('east', this.matchSize) && Math.abs(this.ball.position.y) <= GOAL_TRIGGER_HALF_WIDTH) {
      if (this.ball.position.x >= ARENA_HALF_SIZE - BALL_RADIUS) {
        this.handleGoal('east');
      }
    }
  }

  private resetBodies(): void {
    this.players.forEach((player) => {
      player.state.railPosition = player.definition.spawn;
      player.state.velocity = 0;
      player.desiredAxis = 0;
      const position = railToWorld(player.definition, player.definition.spawn);
      Body.setPosition(player.body, position);
    });

    Body.setPosition(this.ball, { x: 0, y: 0 });
    Body.setVelocity(this.ball, { x: 0, y: 0 });
    this.resetStuckDetection();
  }

  private constrainBallInsideArena(): void {
    const maxAxis = ARENA_HALF_SIZE - BALL_RADIUS;
    const diagonalLimit = (ARENA_HALF_SIZE + (ARENA_HALF_SIZE - CHAMFER_SIZE)) - BALL_RADIUS * Math.SQRT2;
    const inVerticalGoalLane =
      Math.abs(this.ball.position.x) <= GOAL_TRIGGER_HALF_WIDTH &&
      (isGoalSideActive('north', this.matchSize) || isGoalSideActive('south', this.matchSize));
    const inHorizontalGoalLane =
      Math.abs(this.ball.position.y) <= GOAL_TRIGGER_HALF_WIDTH &&
      (isGoalSideActive('east', this.matchSize) || isGoalSideActive('west', this.matchSize));

    let { x, y } = this.ball.position;
    let { x: vx, y: vy } = this.ball.velocity;

    if (x > maxAxis && !inHorizontalGoalLane) {
      x = maxAxis;
      vx = -Math.abs(vx) * 0.96;
    } else if (x < -maxAxis && !inHorizontalGoalLane) {
      x = -maxAxis;
      vx = Math.abs(vx) * 0.96;
    }

    if (y > maxAxis && !inVerticalGoalLane) {
      y = maxAxis;
      vy = -Math.abs(vy) * 0.96;
    } else if (y < -maxAxis && !inVerticalGoalLane) {
      y = -maxAxis;
      vy = Math.abs(vy) * 0.96;
    }

    const resolveDiagonal = (value: number, limit: number, normal: Vec2): void => {
      if (value <= limit) {
        return;
      }

      const excess = value - limit;
      const correction = excess / 2;
      x -= normal.x * correction;
      y -= normal.y * correction;

      const unitNormal = {
        x: normal.x / Math.SQRT2,
        y: normal.y / Math.SQRT2,
      };
      const dot = vx * unitNormal.x + vy * unitNormal.y;
      if (dot > 0) {
        vx -= 2 * dot * unitNormal.x;
        vy -= 2 * dot * unitNormal.y;
        vx *= 0.96;
        vy *= 0.96;
      }
    };

    resolveDiagonal(x + y, diagonalLimit, { x: 1, y: 1 });
    resolveDiagonal(-(x + y), diagonalLimit, { x: -1, y: -1 });
    resolveDiagonal(x - y, diagonalLimit, { x: 1, y: -1 });
    resolveDiagonal(-(x - y), diagonalLimit, { x: -1, y: 1 });

    Body.setPosition(this.ball, { x, y });
    Body.setVelocity(this.ball, { x: vx, y: vy });
  }

  private updateStuckDetection(deltaMs: number): void {
    if (this.phase !== 'playing') {
      this.resetStuckDetection();
      return;
    }

    const displacement = Math.hypot(
      this.ball.position.x - this.lastStuckSample.x,
      this.ball.position.y - this.lastStuckSample.y,
    );
    const speed = Math.hypot(this.ball.velocity.x, this.ball.velocity.y);

    if (speed <= BALL_STUCK_SPEED_EPSILON && displacement <= BALL_STUCK_POSITION_EPSILON) {
      this.stuckElapsedMs += deltaMs;
      if (this.stuckElapsedMs >= BALL_STUCK_TIMEOUT_MS) {
        Body.setPosition(this.ball, { x: 0, y: 0 });
        Body.setVelocity(this.ball, { x: 0, y: 0 });
        this.resetStuckDetection();
      }
      return;
    }

    this.stuckElapsedMs = 0;
    this.lastStuckSample = {
      x: this.ball.position.x,
      y: this.ball.position.y,
    };
  }

  private resetStuckDetection(): void {
    this.stuckElapsedMs = 0;
    this.lastStuckSample = {
      x: this.ball.position.x,
      y: this.ball.position.y,
    };
  }

  private createSnapshot(hostTime: number): GameSnapshot {
    this.networkSequence += 1;

    return {
      tick: this.tick,
      phase: this.phase,
      hostTime,
      ball: {
        x: this.ball.position.x,
        y: this.ball.position.y,
        vx: this.ball.velocity.x,
        vy: this.ball.velocity.y,
      },
      players: this.players.map((player) => ({ ...player.state })),
      score: { ...this.score },
      scorerId: this.scorerId,
      lastTouchedBy: this.lastTouchedBy,
      sequence: this.networkSequence,
      interpolationDelayMs: INTERPOLATION_DELAY_MS,
    };
  }
}

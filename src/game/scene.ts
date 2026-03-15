import Phaser from 'phaser';

import {
  ARENA_HALF_SIZE,
  BALL_RADIUS,
  CHAMFER_SIZE,
  CORNER_GOAL_COLOR,
  CORNER_GOAL_SEGMENTS,
  DISABLED_GOAL_COLOR,
  FIELD_POLYGON,
  GOAL_SEGMENTS,
  isGoalSideActive,
  isPlayerActive,
  PLAYER_DEFINITIONS,
  PLAYER_RADIUS,
} from './constants';
import { MatchRuntime } from './runtime';
import type { GameSnapshot, MatchSize, PlayerDefinition, PlayerState, RailSide, SessionInfo, Vec2 } from './types';

export interface HudUpdate {
  snapshot: GameSnapshot;
  session: SessionInfo;
  fps: number;
}

type PlayerVisual = {
  container: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Arc;
  pulseRing: Phaser.GameObjects.Arc;
  shadow: Phaser.GameObjects.Ellipse;
  pulse: number;
};

type BallVisual = {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  spin: number;
};

const projectRailPosition = (definition: PlayerDefinition, railPosition: number): Vec2 =>
  definition.axis === 'x'
    ? { x: railPosition, y: definition.fixedCoord }
    : { x: definition.fixedCoord, y: railPosition };

const toColorNumber = (color: string): number => Phaser.Display.Color.HexStringToColor(color).color;

const tintColor = (color: string, offset: number): number => {
  const source = Phaser.Display.Color.HexStringToColor(color);
  const clamp = (value: number): number => Math.max(0, Math.min(255, value));
  return Phaser.Display.Color.GetColor(
    clamp(source.red + offset),
    clamp(source.green + offset),
    clamp(source.blue + offset),
  );
};

export class ArenaScene extends Phaser.Scene {
  private static readonly BALL_TEXTURE_KEY = 'soccer-ball';

  private fieldGraphics!: Phaser.GameObjects.Graphics;

  private debugGraphics!: Phaser.GameObjects.Graphics;

  private boundsGraphics!: Phaser.GameObjects.Graphics;

  private flashOverlay!: Phaser.GameObjects.Rectangle;

  private playerVisuals = new Map<number, PlayerVisual>();

  private ballVisual!: BallVisual;

  private viewportCenter = new Phaser.Math.Vector2(0, 0);

  private projectionScale = 1;

  private objectScale = 1;

  private lastScoreTotal = 0;

  private flashStrength = 0;

  private showPhysicsDebug = false;

  private showBoundsDebug = false;

  private previousLastTouchedBy: number | null = null;

  private currentMatchSize: MatchSize = 4;

  constructor(
    private readonly runtime: MatchRuntime,
    private readonly onHudUpdate: (payload: HudUpdate) => void,
  ) {
    super('arena');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#05070a');
    this.ensureBallTexture();

    this.fieldGraphics = this.add.graphics();
    this.debugGraphics = this.add.graphics();
    this.boundsGraphics = this.add.graphics();
    this.flashOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0xffffff, 0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(2000)
      .setScrollFactor(0);

    PLAYER_DEFINITIONS.forEach((definition) => {
      this.playerVisuals.set(definition.id, this.createPlayerVisual(definition));
    });
    this.ballVisual = this.createBallVisual();

    this.scale.on('resize', this.handleResize, this);
    this.handleResize();
  }

  private ensureBallTexture(): void {
    if (this.textures.exists(ArenaScene.BALL_TEXTURE_KEY)) {
      return;
    }

    const size = 96;
    const radius = 36;
    const center = size / 2;
    const canvasTexture = this.textures.createCanvas(ArenaScene.BALL_TEXTURE_KEY, size, size);
    if (!canvasTexture) {
      throw new Error('Failed to create soccer ball texture.');
    }
    const context = canvasTexture.context;
    const ballCenterY = center - 2;

    context.clearRect(0, 0, size, size);

    context.fillStyle = 'rgba(0,0,0,0.16)';
    context.beginPath();
    context.ellipse(center, size - 11, 21, 7, 0, 0, Math.PI * 2);
    context.fill();

    const bodyGradient = context.createRadialGradient(center - 10, ballCenterY - 12, 6, center, ballCenterY, radius);
    bodyGradient.addColorStop(0, '#ffffff');
    bodyGradient.addColorStop(0.68, '#fafafa');
    bodyGradient.addColorStop(1, '#d9d9df');
    context.fillStyle = bodyGradient;
    context.strokeStyle = 'rgba(20,20,20,0.18)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(center, ballCenterY, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.save();
    context.beginPath();
    context.arc(center, ballCenterY, radius - 1, 0, Math.PI * 2);
    context.clip();

    const patches = [
      { x: 0, y: 2, r: 11.5, rot: -Math.PI / 2, color: '#2a2d34' },
      { x: -22, y: -18, r: 10.5, rot: -Math.PI / 2, color: '#3a3d44' },
      { x: 20, y: -29, r: 9.5, rot: -Math.PI / 2, color: '#44474e' },
      { x: 31, y: 10, r: 10.5, rot: -Math.PI / 2, color: '#2b2e35' },
      { x: 8, y: 33, r: 10.5, rot: -Math.PI / 2, color: '#20242b' },
      { x: -24, y: 28, r: 11, rot: -Math.PI / 2, color: '#1f2329' },
    ];

    const drawPatch = (x: number, y: number, r: number, rotation: number, color: string): void => {
      const patchGradient = context.createRadialGradient(
        center + x - r * 0.35,
        ballCenterY + y - r * 0.45,
        1,
        center + x,
        ballCenterY + y,
        r * 1.8,
      );
      patchGradient.addColorStop(0, '#4b4e55');
      patchGradient.addColorStop(1, color);
      context.fillStyle = patchGradient;
      context.beginPath();
      for (let index = 0; index < 5; index += 1) {
        const angle = rotation + (Math.PI * 2 * index) / 5;
        const px = center + x + Math.cos(angle) * r;
        const py = ballCenterY + y + Math.sin(angle) * r;
        if (index === 0) {
          context.moveTo(px, py);
        } else {
          context.lineTo(px, py);
        }
      }
      context.closePath();
      context.fill();
    };

    patches.forEach((patch) => drawPatch(patch.x, patch.y, patch.r, patch.rot, patch.color));

    const seams = [
      [-7, -9, -18, -15],
      [7, -8, 17, -19],
      [12, 9, 24, 11],
      [4, 16, 7, 26],
      [-10, 14, -17, 23],
      [-15, -2, -26, -8],
    ] as const;

    context.strokeStyle = 'rgba(120,120,128,0.26)';
    context.lineWidth = 3.2;
    context.beginPath();
    seams.forEach(([x1, y1, x2, y2]) => {
      context.moveTo(center + x1, ballCenterY + y1);
      context.lineTo(center + x2, ballCenterY + y2);
    });
    context.stroke();

    const rimShade = context.createRadialGradient(center, ballCenterY, radius * 0.72, center, ballCenterY, radius + 2);
    rimShade.addColorStop(0, 'rgba(0,0,0,0)');
    rimShade.addColorStop(1, 'rgba(0,0,0,0.1)');
    context.fillStyle = rimShade;
    context.beginPath();
    context.arc(center, ballCenterY, radius, 0, Math.PI * 2);
    context.fill();

    const shine = context.createRadialGradient(center - 12, ballCenterY - 14, 1, center - 12, ballCenterY - 14, 15);
    shine.addColorStop(0, 'rgba(255,255,255,0.6)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = shine;
    context.beginPath();
    context.arc(center - 9, ballCenterY - 12, 12, 0, Math.PI * 2);
    context.fill();

    context.restore();

    canvasTexture.refresh();
  }

  update(_time: number, delta: number): void {
    this.runtime.update(delta);
    const snapshot = this.runtime.getRenderSnapshot();
    const session = this.runtime.getSessionInfo();
    if (session.matchSize !== this.currentMatchSize) {
      this.currentMatchSize = session.matchSize;
      this.drawField();
    }

    this.renderSnapshot(snapshot);
    this.updateGoalFlash(snapshot, delta);
    this.drawDebug(snapshot);

    this.onHudUpdate({
      snapshot,
      session,
      fps: this.game.loop.actualFps,
    });
  }

  togglePhysicsDebug(): void {
    this.showPhysicsDebug = !this.showPhysicsDebug;
  }

  toggleBoundsDebug(): void {
    this.showBoundsDebug = !this.showBoundsDebug;
  }

  private handleResize(): void {
    this.viewportCenter.set(this.scale.width * 0.5, this.scale.height * 0.5);
    this.projectionScale = Math.min(this.scale.width / 1080, this.scale.height / 620);
    this.objectScale = Math.max(0.72, this.projectionScale);
    this.flashOverlay.setSize(this.scale.width, this.scale.height);
    this.flashOverlay.setPosition(this.scale.width * 0.5, this.scale.height * 0.5);
    this.drawField();
  }

  private drawField(): void {
    this.fieldGraphics.clear();

    const shadowPoints = FIELD_POLYGON.map((point) => this.project({ x: point.x + 26, y: point.y + 34 }, -18));
    this.fillPolygon(this.fieldGraphics, shadowPoints, 0x010202, 0.4);

    const auraPoints = FIELD_POLYGON.map((point) => this.project({ x: point.x * 1.04, y: point.y * 1.04 }, -4));
    this.fillPolygon(this.fieldGraphics, auraPoints, 0x0a2f1d, 0.24);

    const fieldPoints = FIELD_POLYGON.map((point) => this.project(point, 0));
    this.fillPolygon(this.fieldGraphics, fieldPoints, 0x061a0f, 1);

    const glowPoints = FIELD_POLYGON.map((point) => this.project({ x: point.x * 0.96, y: point.y * 0.96 }, 2));
    this.fillPolygon(this.fieldGraphics, glowPoints, 0x0d2c1c, 0.72);

    const innerFieldPoints = FIELD_POLYGON.map((point) => this.project({ x: point.x * 0.88, y: point.y * 0.88 }, 5));
    this.fillPolygon(this.fieldGraphics, innerFieldPoints, 0x123824, 0.58);

    this.strokePolygon(this.fieldGraphics, fieldPoints, 0xe2e8f0, 5, 0.18);

    const insetPoints = FIELD_POLYGON.map((point) =>
      this.project({ x: point.x * 0.9, y: point.y * 0.9 }, 4),
    );
    this.strokePolygon(this.fieldGraphics, insetPoints, 0xf8fafc, 2, 0.16);

    this.drawPitchBands();
    this.drawFieldAxes();
    this.drawCenterMarkings();
    this.drawCornerGoals();
    this.drawGoals();
  }

  private drawCenterMarkings(): void {
    const center = this.project({ x: 0, y: 0 }, 6);
    this.fieldGraphics.lineStyle(3, 0xf8fafc, 0.18);
    this.fieldGraphics.strokeEllipse(center.x, center.y, 226 * this.objectScale, 96 * this.objectScale);
    this.fieldGraphics.fillStyle(0xf8fafc, 0.82);
    this.fieldGraphics.fillCircle(center.x, center.y, 5 * this.objectScale);
  }

  private drawGoals(): void {
    Object.entries(GOAL_SEGMENTS).forEach(([side, segment]) => {
      this.drawGoalFrame(side as RailSide, segment.from, segment.to, isGoalSideActive(side as RailSide, this.currentMatchSize));
    });
  }

  private drawCornerGoals(): void {
    CORNER_GOAL_SEGMENTS.forEach((segment) => {
      const from = this.project(segment.from, 14);
      const to = this.project(segment.to, 14);
      this.drawProjectedSegment(from, to, CORNER_GOAL_COLOR, 10, 0.08);
      this.drawProjectedSegment(from, to, CORNER_GOAL_COLOR, 4, 0.36);
    });
  }

  private renderSnapshot(snapshot: GameSnapshot): void {
    if (snapshot.lastTouchedBy !== null && snapshot.lastTouchedBy !== this.previousLastTouchedBy) {
      const visual = this.playerVisuals.get(snapshot.lastTouchedBy);
      if (visual) {
        visual.pulse = 1;
      }
    }
    this.previousLastTouchedBy = snapshot.lastTouchedBy;

    PLAYER_DEFINITIONS.forEach((definition) => {
      const player = snapshot.players[definition.id];
      this.positionPlayer(definition, player);
    });

    const speed = Math.hypot(snapshot.ball.vx, snapshot.ball.vy);
    const lift = Math.min(18, speed * 4);
    const ballPosition = this.project({ x: snapshot.ball.x, y: snapshot.ball.y }, 16 + lift);
    this.ballVisual.container.setPosition(ballPosition.x, ballPosition.y);
    this.ballVisual.container.setScale(this.objectScale);
    this.ballVisual.body.y = -(10 + lift * 0.35) * this.objectScale;
    this.ballVisual.spin += (snapshot.ball.vx - snapshot.ball.vy) * 0.0024;
    this.ballVisual.body.setRotation(this.ballVisual.spin);
    this.ballVisual.shadow.setScale(1 + Math.min(0.35, speed * 0.08), 1);
    this.ballVisual.container.setDepth(ballPosition.y + 40);
  }

  private positionPlayer(definition: PlayerDefinition, player: PlayerState): void {
    const visual = this.playerVisuals.get(definition.id);
    if (!visual) {
      return;
    }
    if (!isPlayerActive(definition.id, this.currentMatchSize)) {
      visual.container.setVisible(false);
      return;
    }
    visual.container.setVisible(true);

    const world = projectRailPosition(definition, player.railPosition);
    const projected = this.project(world, 22);
    visual.container.setPosition(projected.x, projected.y);
    visual.container.setScale(this.objectScale);
    visual.container.setDepth(projected.y + 20);
    visual.container.setAlpha(player.connected ? 1 : 0.28);
    visual.ring.setStrokeStyle(
      this.runtime.getSessionInfo().localPlayerId === player.id ? 6 : 3,
      0xffffff,
      this.runtime.getSessionInfo().localPlayerId === player.id ? 0.95 : 0.3,
    );
    visual.shadow.fillAlpha = player.connected ? 0.24 : 0.1;

    visual.pulse = Math.max(0, visual.pulse - 0.09);
    const pulseScale = 1 + visual.pulse * 0.9;
    visual.pulseRing.setScale(pulseScale);
    visual.pulseRing.setStrokeStyle(6 - visual.pulse * 2, toColorNumber(definition.color), visual.pulse * 0.75);
  }

  private updateGoalFlash(snapshot: GameSnapshot, delta: number): void {
    const totalScore = snapshot.score.white + snapshot.score.blue + snapshot.score.orange + snapshot.score.green;
    if (totalScore !== this.lastScoreTotal) {
      this.lastScoreTotal = totalScore;
      this.flashStrength = 1;
      const scorer = snapshot.scorerId !== null ? PLAYER_DEFINITIONS[snapshot.scorerId] : null;
      this.flashOverlay.setFillStyle(scorer ? toColorNumber(scorer.color) : 0xffffff, 0.2);
    }

    this.flashStrength = Math.max(0, this.flashStrength - delta / 420);
    this.flashOverlay.setAlpha(this.flashStrength * 0.42);
  }

  private drawDebug(snapshot: GameSnapshot): void {
    this.debugGraphics.clear();
    this.boundsGraphics.clear();

    if (this.showPhysicsDebug) {
      this.debugGraphics.lineStyle(2, 0x8bc34a, 0.5);
      const fieldPoints = FIELD_POLYGON.map((point) => this.project(point, 0));
      this.strokePolygon(this.debugGraphics, fieldPoints, 0x8bc34a, 2);

      Object.values(GOAL_SEGMENTS).forEach((segment) => {
        const from = this.project(segment.from, 0);
        const to = this.project(segment.to, 0);
        this.debugGraphics.beginPath();
        this.debugGraphics.moveTo(from.x, from.y);
        this.debugGraphics.lineTo(to.x, to.y);
        this.debugGraphics.strokePath();
      });
    }

    if (this.showBoundsDebug) {
      this.boundsGraphics.lineStyle(2, 0xfff59d, 0.7);
      snapshot.players.forEach((player) => {
        const definition = PLAYER_DEFINITIONS[player.id];
        const projected = this.project(projectRailPosition(definition, player.railPosition), 12);
        this.boundsGraphics.strokeEllipse(
          projected.x,
          projected.y - 8 * this.objectScale,
          PLAYER_RADIUS * this.objectScale * 1.45,
          PLAYER_RADIUS * this.objectScale * 0.9,
        );
      });

      const ball = this.project({ x: snapshot.ball.x, y: snapshot.ball.y }, 12);
      this.boundsGraphics.strokeEllipse(
        ball.x,
        ball.y,
        BALL_RADIUS * this.objectScale * 1.5,
        BALL_RADIUS * this.objectScale * 0.9,
      );
    }
  }

  private createPlayerVisual(definition: PlayerDefinition): PlayerVisual {
    const darkGlow = tintColor(definition.color, -78);
    const midGlow = tintColor(definition.color, -34);
    const innerFill = tintColor(definition.color, 26);
    const centerFill = tintColor(definition.color, 8);

    const container = this.add.container(0, 0).setDepth(100);
    const shadow = this.add.ellipse(0, 8, 110, 34, 0x000000, 0.3);
    const glow = this.add.circle(0, -18, 42, midGlow, 0.3);
    const base = this.add.circle(0, -18, 28, innerFill, 1);
    const centerGlow = this.add.circle(0, -18, 18, innerFill, 0.16);
    const core = this.add.circle(0, -18, 11, centerFill, 0.94);
    const pulseRing = this.add.circle(0, -18, 38, 0xffffff, 0).setStrokeStyle(0, toColorNumber(definition.color), 0);
    const ring = this.add.circle(0, -18, 35, 0xffffff, 0).setStrokeStyle(4, 0xffffff, 0.72);

    container.add([shadow, glow, pulseRing, base, centerGlow, core, ring]);
    return { container, ring, pulseRing, shadow, pulse: 0 };
  }

  private createBallVisual(): BallVisual {
    const container = this.add.container(0, 0).setDepth(200);
    const shadow = this.add.ellipse(0, 0, 70, 26, 0x000000, 0.24);
    const body = this.add.image(0, -18, ArenaScene.BALL_TEXTURE_KEY).setDisplaySize(48, 48);
    container.add([shadow, body]);
    return { container, body, shadow, spin: 0 };
  }

  private project(point: Vec2, lift: number): Phaser.Math.Vector2 {
    const screenX = (point.x - point.y) * 0.74 * this.projectionScale;
    const screenY = (point.x + point.y) * 0.34 * this.projectionScale - lift * this.projectionScale;
    return new Phaser.Math.Vector2(this.viewportCenter.x + screenX, this.viewportCenter.y + screenY);
  }

  private drawPitchBands(): void {
    const bandEdges = [-ARENA_HALF_SIZE, -280, -180, -80, 80, 180, 280, ARENA_HALF_SIZE];
    bandEdges.slice(0, -1).forEach((fromY, index) => {
      const toY = bandEdges[index + 1];
      const topSpan = this.getHorizontalSpan(fromY);
      const bottomSpan = this.getHorizontalSpan(toY);
      const bandPoints = [
        this.project({ x: topSpan.from, y: fromY }, 3),
        this.project({ x: topSpan.to, y: fromY }, 3),
        this.project({ x: bottomSpan.to, y: toY }, 3),
        this.project({ x: bottomSpan.from, y: toY }, 3),
      ];
      this.fillPolygon(this.fieldGraphics, bandPoints, index % 2 === 0 ? 0x18432b : 0x102f20, index % 2 === 0 ? 0.18 : 0.1);
    });

    [-280, -180, -80, 80, 180, 280].forEach((y) => {
      const span = this.getHorizontalSpan(y);
      const from = this.project({ x: span.from, y }, 2);
      const to = this.project({ x: span.to, y }, 2);
      this.drawProjectedSegment(from, to, 0xf8fafc, 1.5, 0.055);
    });

  }

  private drawGoalFrame(side: RailSide, fromWorld: Vec2, toWorld: Vec2, active: boolean): void {
    const frameColor = active ? 0xf8fafc : DISABLED_GOAL_COLOR;
    const netColor = active ? 0xf8fafc : 0xb8c2bc;
    const goalDepth = 62;
    const goalHeight = 76;
    const depthOffset = this.getGoalDepthOffset(side, goalDepth);

    const backFromWorld = { x: fromWorld.x + depthOffset.x, y: fromWorld.y + depthOffset.y };
    const backToWorld = { x: toWorld.x + depthOffset.x, y: toWorld.y + depthOffset.y };

    const frontBaseFrom = this.project(fromWorld, 18);
    const frontBaseTo = this.project(toWorld, 18);
    const backBaseFrom = this.project(backFromWorld, 14);
    const backBaseTo = this.project(backToWorld, 14);
    const frontTopFrom = this.project(fromWorld, 18 + goalHeight);
    const frontTopTo = this.project(toWorld, 18 + goalHeight);
    const backTopFrom = this.project(backFromWorld, 14 + goalHeight * 0.86);
    const backTopTo = this.project(backToWorld, 14 + goalHeight * 0.86);

    this.fillPolygon(this.fieldGraphics, [frontBaseFrom, frontBaseTo, backBaseTo, backBaseFrom], 0x091017, active ? 0.22 : 0.12);
    this.fillPolygon(this.fieldGraphics, [frontTopFrom, frontTopTo, backTopTo, backTopFrom], 0x0a1219, active ? 0.08 : 0.04);
    this.fillPolygon(this.fieldGraphics, [frontBaseFrom, backBaseFrom, backTopFrom, frontTopFrom], 0x091017, active ? 0.12 : 0.06);
    this.fillPolygon(this.fieldGraphics, [frontBaseTo, backBaseTo, backTopTo, frontTopTo], 0x091017, active ? 0.12 : 0.06);

    this.drawNetPanel(backBaseFrom, backBaseTo, backTopTo, backTopFrom, netColor, active ? 0.38 : 0.18, 7, 11);
    this.drawNetPanel(frontTopFrom, frontTopTo, backTopTo, backTopFrom, netColor, active ? 0.22 : 0.1, 4, 10);
    this.drawNetPanel(frontBaseFrom, backBaseFrom, backTopFrom, frontTopFrom, netColor, active ? 0.2 : 0.08, 5, 4);
    this.drawNetPanel(frontBaseTo, backBaseTo, backTopTo, frontTopTo, netColor, active ? 0.2 : 0.08, 5, 4);

    this.drawProjectedSegment(frontBaseFrom, frontBaseTo, frameColor, active ? 18 : 12, active ? 0.16 : 0.18);
    this.drawProjectedSegment(frontBaseFrom, frontBaseTo, frameColor, active ? 8 : 6, active ? 0.98 : 0.72);
    this.drawProjectedSegment(frontBaseFrom, frontTopFrom, frameColor, active ? 10 : 7, active ? 0.92 : 0.54);
    this.drawProjectedSegment(frontBaseTo, frontTopTo, frameColor, active ? 10 : 7, active ? 0.92 : 0.54);
    this.drawProjectedSegment(frontTopFrom, frontTopTo, frameColor, active ? 10 : 7, active ? 0.92 : 0.54);
    this.drawProjectedSegment(frontTopFrom, backTopFrom, frameColor, active ? 7 : 5, active ? 0.34 : 0.18);
    this.drawProjectedSegment(frontTopTo, backTopTo, frameColor, active ? 7 : 5, active ? 0.34 : 0.18);
    this.drawProjectedSegment(frontBaseFrom, backBaseFrom, frameColor, active ? 6 : 4, active ? 0.2 : 0.12);
    this.drawProjectedSegment(frontBaseTo, backBaseTo, frameColor, active ? 6 : 4, active ? 0.2 : 0.12);
    this.drawProjectedSegment(backBaseFrom, backTopFrom, frameColor, active ? 5 : 3, active ? 0.26 : 0.14);
    this.drawProjectedSegment(backBaseTo, backTopTo, frameColor, active ? 5 : 3, active ? 0.26 : 0.14);
    this.drawProjectedSegment(backTopFrom, backTopTo, frameColor, active ? 5 : 3, active ? 0.34 : 0.16);
  }

  private drawFieldAxes(): void {
    const horizontal = this.getHorizontalSpan(0);
    this.drawProjectedSegment(
      this.project({ x: horizontal.from, y: 0 }, 6),
      this.project({ x: horizontal.to, y: 0 }, 6),
      0xffffff,
      2,
      0.1,
    );
  }

  private drawProjectedSegment(
    from: Phaser.Math.Vector2,
    to: Phaser.Math.Vector2,
    color: number,
    thickness: number,
    alpha: number,
  ): void {
    this.fieldGraphics.lineStyle(thickness, color, alpha);
    this.fieldGraphics.beginPath();
    this.fieldGraphics.moveTo(from.x, from.y);
    this.fieldGraphics.lineTo(to.x, to.y);
    this.fieldGraphics.strokePath();
  }

  private interpolatePoint(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2, progress: number): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(
      Phaser.Math.Linear(from.x, to.x, progress),
      Phaser.Math.Linear(from.y, to.y, progress),
    );
  }

  private drawNetPanel(
    bottomStart: Phaser.Math.Vector2,
    bottomEnd: Phaser.Math.Vector2,
    topEnd: Phaser.Math.Vector2,
    topStart: Phaser.Math.Vector2,
    color: number,
    alpha: number,
    horizontalDivisions: number,
    verticalDivisions: number,
  ): void {
    for (let index = 1; index < horizontalDivisions; index += 1) {
      const progress = index / horizontalDivisions;
      this.drawProjectedSegment(
        this.interpolatePoint(bottomStart, topStart, progress),
        this.interpolatePoint(bottomEnd, topEnd, progress),
        color,
        1,
        alpha,
      );
    }

    for (let index = 1; index < verticalDivisions; index += 1) {
      const progress = index / verticalDivisions;
      this.drawProjectedSegment(
        this.interpolatePoint(bottomStart, bottomEnd, progress),
        this.interpolatePoint(topStart, topEnd, progress),
        color,
        0.9,
        alpha * 0.9,
      );
    }
  }

  private getGoalDepthOffset(side: RailSide, depth: number): Vec2 {
    switch (side) {
      case 'north':
        return { x: 0, y: -depth };
      case 'south':
        return { x: 0, y: depth };
      case 'east':
        return { x: depth, y: 0 };
      case 'west':
        return { x: -depth, y: 0 };
    }
  }

  private getHorizontalSpan(y: number): { from: number; to: number } {
    const straightBoundary = ARENA_HALF_SIZE - CHAMFER_SIZE;
    const absY = Math.abs(y);

    if (absY <= straightBoundary) {
      return { from: -ARENA_HALF_SIZE, to: ARENA_HALF_SIZE };
    }

    if (y < 0) {
      return {
        from: -2 * ARENA_HALF_SIZE + CHAMFER_SIZE - y,
        to: 2 * ARENA_HALF_SIZE - CHAMFER_SIZE + y,
      };
    }

    return {
      from: y - 2 * ARENA_HALF_SIZE + CHAMFER_SIZE,
      to: 2 * ARENA_HALF_SIZE - CHAMFER_SIZE - y,
    };
  }

  private getVerticalSpan(x: number): { from: number; to: number } {
    const straightBoundary = ARENA_HALF_SIZE - CHAMFER_SIZE;
    const absX = Math.abs(x);

    if (absX <= straightBoundary) {
      return { from: -ARENA_HALF_SIZE, to: ARENA_HALF_SIZE };
    }

    if (x < 0) {
      return {
        from: -x - 2 * ARENA_HALF_SIZE + CHAMFER_SIZE,
        to: x + 2 * ARENA_HALF_SIZE - CHAMFER_SIZE,
      };
    }

    return {
      from: x - 2 * ARENA_HALF_SIZE + CHAMFER_SIZE,
      to: -x + 2 * ARENA_HALF_SIZE - CHAMFER_SIZE,
    };
  }

  private fillPolygon(graphics: Phaser.GameObjects.Graphics, points: Phaser.Math.Vector2[], fillColor: number, alpha: number): void {
    graphics.fillStyle(fillColor, alpha);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => {
      graphics.lineTo(point.x, point.y);
    });
    graphics.closePath();
    graphics.fillPath();
  }

  private strokePolygon(
    graphics: Phaser.GameObjects.Graphics,
    points: Phaser.Math.Vector2[],
    strokeColor: number,
    thickness: number,
    alpha = 0.85,
  ): void {
    graphics.lineStyle(thickness, strokeColor, alpha);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => {
      graphics.lineTo(point.x, point.y);
    });
    graphics.closePath();
    graphics.strokePath();
  }
}

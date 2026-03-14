import Phaser from 'phaser';

import {
  ARENA_HALF_SIZE,
  BALL_RADIUS,
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
    this.cameras.main.setBackgroundColor('#08130c');
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
    const radius = 34;
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
    this.viewportCenter.set(this.scale.width * 0.5, this.scale.height * 0.625);
    this.projectionScale = Math.min(this.scale.width / 1120, this.scale.height / 700);
    this.objectScale = Math.max(0.72, this.projectionScale);
    this.flashOverlay.setSize(this.scale.width, this.scale.height);
    this.flashOverlay.setPosition(this.scale.width * 0.5, this.scale.height * 0.5);
    this.drawField();
  }

  private drawField(): void {
    this.fieldGraphics.clear();

    const shadowPoints = FIELD_POLYGON.map((point) => this.project({ x: point.x + 24, y: point.y + 24 }, -10));
    this.fillPolygon(this.fieldGraphics, shadowPoints, 0x020703, 0.4);

    const fieldPoints = FIELD_POLYGON.map((point) => this.project(point, 0));
    this.fillPolygon(this.fieldGraphics, fieldPoints, 0x1e6124, 1);
    this.strokePolygon(this.fieldGraphics, fieldPoints, 0xdcedc8, 4);

    const insetPoints = FIELD_POLYGON.map((point) =>
      this.project({ x: point.x * 0.82, y: point.y * 0.82 }, 1),
    );
    this.strokePolygon(this.fieldGraphics, insetPoints, 0xbfe89d, 2);

    this.drawCenterMarkings();
    this.drawCornerGoals();
    this.drawGoals();
  }

  private drawCenterMarkings(): void {
    const center = this.project({ x: 0, y: 0 }, 4);
    this.fieldGraphics.lineStyle(2, 0xe8f5e9, 0.8);

    const top = this.project({ x: 0, y: -ARENA_HALF_SIZE }, 0);
    const bottom = this.project({ x: 0, y: ARENA_HALF_SIZE }, 0);
    this.fieldGraphics.beginPath();
    this.fieldGraphics.moveTo(top.x, top.y);
    this.fieldGraphics.lineTo(bottom.x, bottom.y);
    this.fieldGraphics.strokePath();

    this.fieldGraphics.strokeEllipse(center.x, center.y, 180 * this.objectScale, 78 * this.objectScale);
    this.fieldGraphics.fillStyle(0xe8f5e9, 0.9);
    this.fieldGraphics.fillCircle(center.x, center.y, 5 * this.objectScale);
  }

  private drawGoals(): void {
    Object.entries(GOAL_SEGMENTS).forEach(([side, segment]) => {
      const from = this.project(segment.from, 12);
      const to = this.project(segment.to, 12);
      this.fieldGraphics.lineStyle(8, isGoalSideActive(side as RailSide, this.currentMatchSize) ? 0xf4fff4 : DISABLED_GOAL_COLOR, 0.9);
      this.fieldGraphics.beginPath();
      this.fieldGraphics.moveTo(from.x, from.y);
      this.fieldGraphics.lineTo(to.x, to.y);
      this.fieldGraphics.strokePath();
    });
  }

  private drawCornerGoals(): void {
    this.fieldGraphics.lineStyle(8, CORNER_GOAL_COLOR, 0.88);

    CORNER_GOAL_SEGMENTS.forEach((segment) => {
      const from = this.project(segment.from, 12);
      const to = this.project(segment.to, 12);
      this.fieldGraphics.beginPath();
      this.fieldGraphics.moveTo(from.x, from.y);
      this.fieldGraphics.lineTo(to.x, to.y);
      this.fieldGraphics.strokePath();
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
    const container = this.add.container(0, 0).setDepth(100);
    const shadow = this.add.ellipse(0, 0, 104, 34, 0x000000, 0.24);
    const glow = this.add.ellipse(0, -18, 96, 64, toColorNumber(definition.glow), 0.12);
    const base = this.add.circle(0, -18, 30, toColorNumber(definition.color), 1);
    const pulseRing = this.add.circle(0, -18, 38, 0xffffff, 0).setStrokeStyle(0, toColorNumber(definition.color), 0);
    const ring = this.add.circle(0, -18, 36, 0xffffff, 0.05).setStrokeStyle(3, 0xffffff, 0.3);

    container.add([shadow, glow, pulseRing, base, ring]);
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

  private strokePolygon(graphics: Phaser.GameObjects.Graphics, points: Phaser.Math.Vector2[], strokeColor: number, thickness: number): void {
    graphics.lineStyle(thickness, strokeColor, 0.85);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => {
      graphics.lineTo(point.x, point.y);
    });
    graphics.closePath();
    graphics.strokePath();
  }
}

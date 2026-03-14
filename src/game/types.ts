export type PlayerId = 0 | 1 | 2 | 3;
export type MatchSize = 2 | 4;
export type RailSide = 'north' | 'east' | 'south' | 'west';
export type RailAxis = 'x' | 'y';
export type MatchPhase = 'playing' | 'goal';
export type SessionMode = 'practice' | 'host' | 'client';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerDefinition {
  id: PlayerId;
  key: keyof ScoreState;
  label: string;
  color: string;
  glow: string;
  railSide: RailSide;
  axis: RailAxis;
  fixedCoord: number;
  railMin: number;
  railMax: number;
  spawn: number;
}

export interface PlayerState {
  id: PlayerId;
  railPosition: number;
  velocity: number;
  boostCooldownMs: number;
  connected: boolean;
}

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ScoreState {
  white: number;
  blue: number;
  orange: number;
  green: number;
}

export interface GameSnapshot {
  tick: number;
  phase: MatchPhase;
  hostTime: number;
  ball: BallState;
  players: PlayerState[];
  score: ScoreState;
  scorerId: PlayerId | null;
  lastTouchedBy: PlayerId | null;
  sequence: number;
  interpolationDelayMs: number;
}

export interface InputFrame {
  playerId: PlayerId;
  sequence: number;
  axis: -1 | 0 | 1;
  boost: boolean;
  clientTime: number;
}

export interface NetworkStats {
  pingMs: number;
  packetLoss: number;
  tickDriftMs: number;
  interpolationDelayMs: number;
  connectedPeers: number;
}

export interface SessionInfo {
  mode: SessionMode;
  matchSize: MatchSize;
  roomId: string | null;
  peerId: string;
  isHost: boolean;
  localPlayerId: PlayerId;
}

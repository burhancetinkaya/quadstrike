import type { PlayerDefinition, ScoreState, Vec2 } from './types';

export const SIMULATION_HZ = 60;
export const NETWORK_SEND_HZ = 20;
export const INTERPOLATION_DELAY_MS = 100;
export const BOOST_COOLDOWN_MS = 800;
export const GOAL_FREEZE_MS = 900;

export const ARENA_HALF_SIZE = 420;
export const CHAMFER_SIZE = 120;
export const GOAL_HALF_WIDTH = 138;
export const WALL_THICKNESS = 36;
export const PLAYER_RADIUS = 34;
export const PLAYER_SPEED = 860;
export const BALL_RADIUS = 22;
export const GOAL_SCORE_HALF_WIDTH = GOAL_HALF_WIDTH - BALL_RADIUS;
export const BOOST_DISTANCE = 138;
export const BOOST_FORCE = 0.052;
export const BOOST_CONTACT_EPSILON = 6;
export const BALL_STUCK_TIMEOUT_MS = 3000;
export const BALL_STUCK_SPEED_EPSILON = 0.12;
export const BALL_STUCK_POSITION_EPSILON = 18;
export const PRACTICE_STUCK_TIMEOUT_MS = 1200;
export const PRACTICE_STUCK_SPEED_EPSILON = 0.7;
export const PRACTICE_STUCK_WALL_MARGIN = 54;
export const PRACTICE_STUCK_PLAYER_MARGIN = 22;

export const SCORE_ORDER: (keyof ScoreState)[] = ['white', 'blue', 'orange', 'green'];

export const PLAYER_DEFINITIONS: PlayerDefinition[] = [
  {
    id: 0,
    key: 'white',
    label: 'WHITE',
    color: '#ffffff',
    glow: '#dfe6eb',
    railSide: 'north',
    axis: 'x',
    fixedCoord: -ARENA_HALF_SIZE + 82,
    railMin: -232,
    railMax: 232,
    spawn: 0,
  },
  {
    id: 1,
    key: 'blue',
    label: 'BLUE',
    color: '#2979ff',
    glow: '#8ab4ff',
    railSide: 'east',
    axis: 'y',
    fixedCoord: ARENA_HALF_SIZE - 82,
    railMin: -232,
    railMax: 232,
    spawn: 0,
  },
  {
    id: 2,
    key: 'orange',
    label: 'ORANGE',
    color: '#ff6d00',
    glow: '#ffb074',
    railSide: 'south',
    axis: 'x',
    fixedCoord: ARENA_HALF_SIZE - 82,
    railMin: -232,
    railMax: 232,
    spawn: 0,
  },
  {
    id: 3,
    key: 'green',
    label: 'GREEN',
    color: '#00c853',
    glow: '#9cf0bc',
    railSide: 'west',
    axis: 'y',
    fixedCoord: -ARENA_HALF_SIZE + 82,
    railMin: -232,
    railMax: 232,
    spawn: 0,
  },
];

export const FIELD_POLYGON: Vec2[] = [
  { x: -ARENA_HALF_SIZE + CHAMFER_SIZE, y: -ARENA_HALF_SIZE },
  { x: ARENA_HALF_SIZE - CHAMFER_SIZE, y: -ARENA_HALF_SIZE },
  { x: ARENA_HALF_SIZE, y: -ARENA_HALF_SIZE + CHAMFER_SIZE },
  { x: ARENA_HALF_SIZE, y: ARENA_HALF_SIZE - CHAMFER_SIZE },
  { x: ARENA_HALF_SIZE - CHAMFER_SIZE, y: ARENA_HALF_SIZE },
  { x: -ARENA_HALF_SIZE + CHAMFER_SIZE, y: ARENA_HALF_SIZE },
  { x: -ARENA_HALF_SIZE, y: ARENA_HALF_SIZE - CHAMFER_SIZE },
  { x: -ARENA_HALF_SIZE, y: -ARENA_HALF_SIZE + CHAMFER_SIZE },
];

export const GOAL_SEGMENTS = {
  north: {
    from: { x: -GOAL_SCORE_HALF_WIDTH, y: -ARENA_HALF_SIZE },
    to: { x: GOAL_SCORE_HALF_WIDTH, y: -ARENA_HALF_SIZE },
  },
  east: {
    from: { x: ARENA_HALF_SIZE, y: -GOAL_SCORE_HALF_WIDTH },
    to: { x: ARENA_HALF_SIZE, y: GOAL_SCORE_HALF_WIDTH },
  },
  south: {
    from: { x: -GOAL_SCORE_HALF_WIDTH, y: ARENA_HALF_SIZE },
    to: { x: GOAL_SCORE_HALF_WIDTH, y: ARENA_HALF_SIZE },
  },
  west: {
    from: { x: -ARENA_HALF_SIZE, y: -GOAL_SCORE_HALF_WIDTH },
    to: { x: -ARENA_HALF_SIZE, y: GOAL_SCORE_HALF_WIDTH },
  },
} as const;

export const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302',
];

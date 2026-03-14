import type { MatchSize, PlayerDefinition, PlayerId, RailSide, ScoreState, Vec2 } from './types';

export const SIMULATION_HZ = 60;
export const NETWORK_SEND_HZ = 20;
export const INTERPOLATION_DELAY_MS = 100;
export const BOOST_COOLDOWN_MS = 800;
export const GOAL_FREEZE_MS = 900;
export const MATCH_DURATION_MS = 2 * 60 * 1000;

export const ARENA_HALF_SIZE = 420;
export const CHAMFER_SIZE = 120;
export const STRAIGHT_SIDE_HALF_SPAN = ARENA_HALF_SIZE - CHAMFER_SIZE;
export const GOAL_HALF_WIDTH = STRAIGHT_SIDE_HALF_SPAN;
export const WALL_THICKNESS = 36;
export const PLAYER_RADIUS = 34;
export const PLAYER_SPEED = 1040;
export const BALL_RADIUS = 22;
export const GOAL_SCORE_HALF_WIDTH = STRAIGHT_SIDE_HALF_SPAN;
export const GOAL_TRIGGER_HALF_WIDTH = STRAIGHT_SIDE_HALF_SPAN - BALL_RADIUS;
export const BOOST_DISTANCE = 138;
export const BOOST_FORCE = 0.043;
export const BOOST_CONTACT_EPSILON = 6;
export const AUTO_BOOST_TRIGGER_MARGIN = 12;
export const BALL_TRAVEL_SPEED = 11;
export const BALL_STUCK_TIMEOUT_MS = 3000;
export const BALL_STUCK_SPEED_EPSILON = 0.12;
export const BALL_STUCK_POSITION_EPSILON = 18;
export const PRACTICE_STUCK_TIMEOUT_MS = 1200;
export const PRACTICE_STUCK_SPEED_EPSILON = 0.7;
export const PRACTICE_STUCK_WALL_MARGIN = 54;
export const PRACTICE_STUCK_PLAYER_MARGIN = 22;

export const SCORE_ORDER: (keyof ScoreState)[] = ['white', 'blue', 'orange', 'green'];
export const DISABLED_GOAL_COLOR = 0x4f5d52;
export const CORNER_GOAL_COLOR = 0x848b90;

export const PLAYER_DEFINITIONS: PlayerDefinition[] = [
  {
    id: 0,
    key: 'white',
    label: 'GOLD',
    color: '#f4c542',
    glow: '#ffe7a1',
    railSide: 'north',
    axis: 'x',
    fixedCoord: -ARENA_HALF_SIZE + 82,
    railMin: -GOAL_HALF_WIDTH + PLAYER_RADIUS,
    railMax: GOAL_HALF_WIDTH - PLAYER_RADIUS,
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
    railMin: -GOAL_HALF_WIDTH + PLAYER_RADIUS,
    railMax: GOAL_HALF_WIDTH - PLAYER_RADIUS,
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
    railMin: -GOAL_HALF_WIDTH + PLAYER_RADIUS,
    railMax: GOAL_HALF_WIDTH - PLAYER_RADIUS,
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
    railMin: -GOAL_HALF_WIDTH + PLAYER_RADIUS,
    railMax: GOAL_HALF_WIDTH - PLAYER_RADIUS,
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

const CORNER_GOAL_INSET = CHAMFER_SIZE * 0.18;

export const CORNER_GOAL_SEGMENTS = [
  {
    from: { x: ARENA_HALF_SIZE - CHAMFER_SIZE + CORNER_GOAL_INSET, y: -ARENA_HALF_SIZE + CORNER_GOAL_INSET },
    to: { x: ARENA_HALF_SIZE - CORNER_GOAL_INSET, y: -ARENA_HALF_SIZE + CHAMFER_SIZE - CORNER_GOAL_INSET },
  },
  {
    from: { x: ARENA_HALF_SIZE - CORNER_GOAL_INSET, y: ARENA_HALF_SIZE - CHAMFER_SIZE + CORNER_GOAL_INSET },
    to: { x: ARENA_HALF_SIZE - CHAMFER_SIZE + CORNER_GOAL_INSET, y: ARENA_HALF_SIZE - CORNER_GOAL_INSET },
  },
  {
    from: { x: -ARENA_HALF_SIZE + CHAMFER_SIZE - CORNER_GOAL_INSET, y: ARENA_HALF_SIZE - CORNER_GOAL_INSET },
    to: { x: -ARENA_HALF_SIZE + CORNER_GOAL_INSET, y: ARENA_HALF_SIZE - CHAMFER_SIZE + CORNER_GOAL_INSET },
  },
  {
    from: { x: -ARENA_HALF_SIZE + CORNER_GOAL_INSET, y: -ARENA_HALF_SIZE + CHAMFER_SIZE - CORNER_GOAL_INSET },
    to: { x: -ARENA_HALF_SIZE + CHAMFER_SIZE - CORNER_GOAL_INSET, y: -ARENA_HALF_SIZE + CORNER_GOAL_INSET },
  },
] as const;

export const getActivePlayerIds = (matchSize: MatchSize): PlayerId[] =>
  matchSize === 2 ? [0, 2] : [0, 1, 2, 3];

export const isPlayerActive = (playerId: PlayerId, matchSize: MatchSize): boolean =>
  getActivePlayerIds(matchSize).includes(playerId);

export const getActiveGoalSides = (matchSize: MatchSize): RailSide[] =>
  matchSize === 2 ? ['north', 'south'] : ['north', 'east', 'south', 'west'];

export const isGoalSideActive = (side: RailSide, matchSize: MatchSize): boolean =>
  getActiveGoalSides(matchSize).includes(side);

export const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302',
];

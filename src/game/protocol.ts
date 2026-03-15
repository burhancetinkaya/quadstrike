import { INTERPOLATION_DELAY_MS, SCORE_ORDER } from './constants';
import type { GameSnapshot, InputFrame, MatchPhase, PlayerId, ScoreState } from './types';

export const INPUT_PACKET_BYTES = 8;
export const STATE_PACKET_BYTES = 48;

export enum PacketType {
  Input = 1,
  State = 2,
}

// Physics values are quantized to keep WebRTC packets compact and fixed-size.
const POSITION_SCALE = 8;
const VELOCITY_SCALE = 8;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const quantize = (value: number, scale: number): number =>
  clamp(Math.round(value * scale), -32768, 32767);
const dequantize = (value: number, scale: number): number => value / scale;

const encodeCooldown = (cooldownMs: number): number => clamp(Math.round(cooldownMs / 8), 0, 255);
const decodeCooldown = (value: number): number => value * 8;

const encodeNullablePlayerId = (playerId: PlayerId | null): number => (playerId === null ? 255 : playerId);
const decodeNullablePlayerId = (encoded: number): PlayerId | null =>
  encoded === 255 ? null : (encoded as PlayerId);

const encodePhase = (phase: MatchPhase): number => (phase === 'goal' ? 1 : 0);
const decodePhase = (value: number): MatchPhase => (value === 1 ? 'goal' : 'playing');

const defaultScore = (): ScoreState => ({
  white: 0,
  blue: 0,
  orange: 0,
  green: 0,
});

export const serializeInputPacket = (input: InputFrame): ArrayBuffer => {
  // Input packets stay tiny because clients only need to send intent, not state.
  const buffer = new ArrayBuffer(INPUT_PACKET_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, PacketType.Input);
  view.setUint8(1, input.playerId);
  view.setUint16(2, input.sequence);
  view.setInt8(4, input.axis);
  view.setUint8(5, input.boost ? 1 : 0);
  view.setUint16(6, input.clientTime & 0xffff);
  return buffer;
};

export const deserializeInputPacket = (buffer: ArrayBuffer): InputFrame => {
  if (buffer.byteLength < INPUT_PACKET_BYTES) {
    throw new Error(`Input packet too short: expected ${INPUT_PACKET_BYTES} bytes.`);
  }
  const view = new DataView(buffer);
  return {
    playerId: view.getUint8(1) as PlayerId,
    sequence: view.getUint16(2),
    axis: clamp(view.getInt8(4), -1, 1) as -1 | 0 | 1,
    boost: view.getUint8(5) === 1,
    clientTime: view.getUint16(6),
  };
};

export const serializeStatePacket = (snapshot: GameSnapshot): ArrayBuffer => {
  // State packets pack the full authoritative frame into a fixed byte layout so
  // hosts can broadcast them without per-field JSON overhead.
  const buffer = new ArrayBuffer(STATE_PACKET_BYTES);
  const view = new DataView(buffer);

  view.setUint8(0, PacketType.State);
  view.setUint8(1, encodePhase(snapshot.phase));
  view.setUint16(2, snapshot.tick & 0xffff);
  view.setUint16(4, snapshot.hostTime & 0xffff);
  view.setInt16(6, quantize(snapshot.ball.x, POSITION_SCALE));
  view.setInt16(8, quantize(snapshot.ball.y, POSITION_SCALE));
  view.setInt16(10, quantize(snapshot.ball.vx, VELOCITY_SCALE));
  view.setInt16(12, quantize(snapshot.ball.vy, VELOCITY_SCALE));

  let offset = 14;
  snapshot.players.forEach((player) => {
    view.setInt16(offset, quantize(player.railPosition, POSITION_SCALE));
    view.setInt16(offset + 2, quantize(player.velocity, VELOCITY_SCALE));
    view.setUint8(offset + 4, encodeCooldown(player.boostCooldownMs));
    view.setUint8(offset + 5, player.connected ? 1 : 0);
    offset += 6;
  });

  SCORE_ORDER.forEach((key, index) => {
    view.setUint8(38 + index, snapshot.score[key]);
  });

  view.setUint8(42, encodeNullablePlayerId(snapshot.scorerId));
  view.setUint8(43, encodeNullablePlayerId(snapshot.lastTouchedBy));
  view.setUint16(44, snapshot.sequence & 0xffff);
  view.setUint16(46, snapshot.interpolationDelayMs & 0xffff);

  return buffer;
};

export const deserializeStatePacket = (buffer: ArrayBuffer): GameSnapshot => {
  if (buffer.byteLength < STATE_PACKET_BYTES) {
    throw new Error(`State packet too short: expected ${STATE_PACKET_BYTES} bytes.`);
  }

  const view = new DataView(buffer);
  const score = defaultScore();
  SCORE_ORDER.forEach((key, index) => {
    score[key] = view.getUint8(38 + index);
  });

  const players = Array.from({ length: 4 }, (_, index) => {
    // Player slots are always serialized in fixed id order.
    const offset = 14 + index * 6;
    return {
      id: index as PlayerId,
      railPosition: dequantize(view.getInt16(offset), POSITION_SCALE),
      velocity: dequantize(view.getInt16(offset + 2), VELOCITY_SCALE),
      boostCooldownMs: decodeCooldown(view.getUint8(offset + 4)),
      connected: view.getUint8(offset + 5) === 1,
    };
  });

  return {
    tick: view.getUint16(2),
    phase: decodePhase(view.getUint8(1)),
    hostTime: view.getUint16(4),
    ball: {
      x: dequantize(view.getInt16(6), POSITION_SCALE),
      y: dequantize(view.getInt16(8), POSITION_SCALE),
      vx: dequantize(view.getInt16(10), VELOCITY_SCALE),
      vy: dequantize(view.getInt16(12), VELOCITY_SCALE),
    },
    players,
    score,
    scorerId: decodeNullablePlayerId(view.getUint8(42)),
    lastTouchedBy: decodeNullablePlayerId(view.getUint8(43)),
    sequence: view.getUint16(44),
    interpolationDelayMs: view.getUint16(46) || INTERPOLATION_DELAY_MS,
  };
};

export const getPacketType = (payload: ArrayBuffer): PacketType | null => {
  if (payload.byteLength === 0) {
    return null;
  }
  return new DataView(payload).getUint8(0) as PacketType;
};

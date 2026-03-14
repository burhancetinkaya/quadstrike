import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port });
const OPEN = 1;

/** @type {Map<string, { peers: Map<string, import('ws').WebSocket>, playerAssignments: Map<string, number>, hostPeerId: string | null, matchSize: 2 | 4 }>} */
const rooms = new Map();

const getRoom = (roomId) => {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      peers: new Map(),
      playerAssignments: new Map(),
      hostPeerId: null,
      matchSize: 4,
    };
    rooms.set(roomId, room);
  }
  return room;
};

const sendJson = (socket, payload) => {
  if (socket.readyState === OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const broadcast = (room, payload, excludePeerId = null) => {
  room.peers.forEach((socket, peerId) => {
    if (peerId !== excludePeerId) {
      sendJson(socket, payload);
    }
  });
};

const getAllowedPlayerIds = (room) => (room.matchSize === 2 ? [0, 2] : [0, 1, 2, 3]);

const getLowestFreePlayerId = (room) => {
  for (const playerId of getAllowedPlayerIds(room)) {
    if (![...room.playerAssignments.values()].includes(playerId)) {
      return playerId;
    }
  }
  return null;
};

const electHost = (room) => {
  const sorted = [...room.playerAssignments.entries()].sort((a, b) => a[1] - b[1]);
  room.hostPeerId = sorted[0]?.[0] ?? null;
  return room.hostPeerId;
};

wss.on('connection', (socket) => {
  let roomId = null;
  let peerId = null;

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      sendJson(socket, { type: 'error', message: 'Invalid JSON payload.' });
      return;
    }

    if (message.type === 'join') {
      roomId = String(message.roomId ?? '').trim().toUpperCase();
      peerId = String(message.peerId ?? '').trim();
      const requestedMatchSize = message.matchSize === 2 ? 2 : message.matchSize === 4 ? 4 : null;

      if (!roomId || !peerId) {
        sendJson(socket, { type: 'error', message: 'roomId and peerId are required.' });
        return;
      }

      const room = getRoom(roomId);
      if (room.peers.size === 0 && requestedMatchSize) {
        room.matchSize = requestedMatchSize;
      }

      if (requestedMatchSize && room.peers.size > 0 && requestedMatchSize !== room.matchSize) {
        sendJson(socket, { type: 'error', message: `Room is configured for ${room.matchSize} players.` });
        return;
      }

      if (room.peers.size >= room.matchSize && !room.peers.has(peerId)) {
        sendJson(socket, { type: 'error', message: 'Room is full.' });
        return;
      }

      const assignedPlayerId = room.playerAssignments.get(peerId) ?? getLowestFreePlayerId(room);
      if (assignedPlayerId === null) {
        sendJson(socket, { type: 'error', message: 'No free player slots remain.' });
        return;
      }

      room.peers.set(peerId, socket);
      room.playerAssignments.set(peerId, assignedPlayerId);
      const isHost = room.hostPeerId === null || room.hostPeerId === peerId;
      if (isHost) {
        room.hostPeerId = peerId;
      }

      sendJson(socket, {
        type: 'joined',
        roomId,
        peerId,
        playerId: assignedPlayerId,
        matchSize: room.matchSize,
        isHost,
        hostPeerId: room.hostPeerId,
        peers: [...room.playerAssignments.entries()].map(([id, playerId]) => ({ peerId: id, playerId })),
      });

      broadcast(
        room,
        {
          type: 'peer-joined',
          roomId,
          peerId,
          matchSize: room.matchSize,
          playerId: assignedPlayerId,
          hostPeerId: room.hostPeerId,
          peers: [...room.playerAssignments.entries()].map(([id, playerId]) => ({ peerId: id, playerId })),
        },
        peerId,
      );
      return;
    }

    if (!roomId || !peerId) {
      sendJson(socket, { type: 'error', message: 'Join a room before sending other messages.' });
      return;
    }

    const room = getRoom(roomId);

    if (message.type === 'signal') {
      const targetPeerId = String(message.targetPeerId ?? '');
      const targetSocket = room.peers.get(targetPeerId);
      if (!targetSocket) {
        sendJson(socket, { type: 'error', message: 'Target peer not found.' });
        return;
      }

      sendJson(targetSocket, {
        type: 'signal',
        roomId,
        fromPeerId: peerId,
        targetPeerId,
        signal: message.signal,
      });
      return;
    }

    if (message.type === 'match-countdown') {
      if (peerId !== room.hostPeerId) {
        sendJson(socket, { type: 'error', message: 'Only the host can start the match countdown.' });
        return;
      }

      const startAtMs = Number(message.startAtMs);
      if (!Number.isFinite(startAtMs)) {
        sendJson(socket, { type: 'error', message: 'startAtMs must be a valid number.' });
        return;
      }

      broadcast(room, {
        type: 'match-countdown',
        roomId,
        matchSize: room.matchSize,
        startAtMs,
      });
      return;
    }

    if (message.type === 'leave') {
      socket.close();
    }
  });

  socket.on('close', () => {
    if (!roomId || !peerId) {
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    room.peers.delete(peerId);
    room.playerAssignments.delete(peerId);

    const hostChanged = room.hostPeerId === peerId;
    if (hostChanged) {
      electHost(room);
    }

    broadcast(room, {
      type: hostChanged ? 'host-migrated' : 'peer-left',
      roomId,
      peerId,
      matchSize: room.matchSize,
      hostPeerId: room.hostPeerId,
      peers: [...room.playerAssignments.entries()].map(([id, playerId]) => ({ peerId: id, playerId })),
    });

    if (room.peers.size === 0) {
      rooms.delete(roomId);
    }
  });
});

console.log(`QuadStrike signaling server listening on ws://localhost:${port}`);

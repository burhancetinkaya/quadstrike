import http from 'node:http';
import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT ?? 8080);
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, service: 'quadstrike-signaling' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('QuadStrike signaling server is running.\n');
});
const wss = new WebSocketServer({ server });
const OPEN = 1;

/** @type {Map<string, { peers: Map<string, import('ws').WebSocket>, playerAssignments: Map<string, number>, hostPeerId: string | null, matchSize: 2 | 4 }>} */
const rooms = new Map();

const getRoom = (roomId) => {
  // `getRoom` is intentionally lazy so reconnecting clients can revive a room
  // record without every call site reimplementing the same setup.
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

const createRoom = (roomId) => {
  const room = {
    peers: new Map(),
    playerAssignments: new Map(),
    hostPeerId: null,
    matchSize: 4,
  };
  rooms.set(roomId, room);
  return room;
};

const sendJson = (socket, payload) => {
  if (socket.readyState === OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const broadcast = (room, payload, excludePeerId = null) => {
  // Room events are fan-out only; authoritative gameplay stays on the host's
  // direct data channels once peers discover each other.
  room.peers.forEach((socket, peerId) => {
    if (peerId !== excludePeerId) {
      sendJson(socket, payload);
    }
  });
};

const getAllowedPlayerIds = (room) => (room.matchSize === 2 ? [0, 2] : [0, 1, 2, 3]);

const getLowestFreePlayerId = (room) => {
  // Slots are deterministic so reconnects keep stable identities whenever possible.
  for (const playerId of getAllowedPlayerIds(room)) {
    if (![...room.playerAssignments.values()].includes(playerId)) {
      return playerId;
    }
  }
  return null;
};

const electHost = (room) => {
  // Lowest player id becomes host to keep migration deterministic for all clients.
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

    if (message.type === 'join' || message.type === 'host') {
      // The initial signaling message both creates/joins the room and assigns a
      // stable player slot before any WebRTC negotiation begins.
      roomId = String(message.roomId ?? '').trim().toUpperCase();
      peerId = String(message.peerId ?? '').trim();
      const requestedMode = message.type === 'host' || message.requestedMode === 'host' ? 'host' : 'client';
      const requestedMatchSize = message.matchSize === 2 ? 2 : message.matchSize === 4 ? 4 : null;

      if (!roomId || !peerId) {
        sendJson(socket, { type: 'error', message: 'roomId and peerId are required.' });
        return;
      }

      let room = rooms.get(roomId);
      if (!room) {
        if (requestedMode === 'client') {
          sendJson(socket, { type: 'error', message: `Room ${roomId} was not found.` });
          return;
        }
        room = createRoom(roomId);
      }

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
      // SDP offers/answers and ICE candidates are only relayed; the server never
      // inspects or mutates their payload.
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
      // Countdown timing comes from the host so every client can start play off
      // a single shared timestamp.
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
      // Host migration is server-driven so clients can re-negotiate cleanly.
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

server.listen(port, () => {
  console.log(`QuadStrike signaling server listening on ws://localhost:${port}`);
});

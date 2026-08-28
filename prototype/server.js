'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const BOARD_NUMBERS = 36; // numbers 1..36, arranged differently for each player
const TOTAL_BOXES = 10;   // fill all of them to win

/**
 * Game phases
 *   waiting   - fewer than two players connected
 *   selecting - the selector must pick a number; nobody may fill boxes
 *   searching - the seeker hunts the target; ONLY the selector may fill boxes
 *   finished  - somebody filled every box
 */
const rooms = new Map();

function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createRoom(code) {
  const room = {
    code,
    players: [],
    phase: 'waiting',
    selectorId: null,
    target: null,
    used: new Set(),
    turnId: 0,      // bumped on every atomic transition; stale actions are rejected
    version: 0,     // bumped on every broadcast
    winnerId: null,
    lastEvent: null
  };
  rooms.set(code, room);
  return room;
}

function makePlayer(socketId, name) {
  return {
    id: socketId,
    name: name,
    board: shuffled(BOARD_NUMBERS),
    boxes: 0,
    found: []       // numbers this player has successfully guessed
  };
}

function other(room, id) {
  return room.players.find(p => p.id !== id) || null;
}

function startRound(room, selectorId) {
  room.phase = 'selecting';
  room.selectorId = selectorId;
  room.target = null;
  room.turnId++;
}

/** Personalised, authoritative snapshot. The client renders this and nothing else. */
function snapshotFor(room, playerId) {
  const me = room.players.find(p => p.id === playerId);
  const foe = other(room, playerId);
  const isSelector = room.selectorId === playerId;

  return {
    version: room.version,
    turnId: room.turnId,
    phase: room.phase,
    room: room.code,
    totalBoxes: TOTAL_BOXES,
    role: (room.phase === 'waiting' || room.phase === 'finished')
      ? 'none'
      : (isSelector ? 'selector' : 'seeker'),
    // The single source of truth for the client's box lock.
    canFillBoxes: room.phase === 'searching' && isSelector && !room.winnerId,
    canSelect: room.phase === 'selecting' && isSelector,
    canGuess: room.phase === 'searching' && !isSelector,
    target: room.target,        // public: selector sees "YOUR NUMBER", seeker sees "NUMBER TO GUESS"
    usedNumbers: [...room.used],
    winnerId: room.winnerId,
    lastEvent: room.lastEvent,
    me: me && {
      id: me.id, name: me.name, board: me.board, boxes: me.boxes, found: me.found
    },
    opponent: foe && {
      id: foe.id, name: foe.name, boxes: foe.boxes, found: foe.found
    }
  };
}

function broadcast(room, event) {
  room.version++;
  room.lastEvent = event || null;
  for (const p of room.players) {
    io.to(p.id).emit('state', snapshotFor(room, p.id));
  }
}

function reject(socket, reason) {
  socket.emit('rejected', { reason });
}

io.on('connection', socket => {
  socket.data.roomCode = null;

  socket.on('join', (payload) => {
    const data = payload || {};
    const code = (String(data.room || '').trim().toUpperCase().slice(0, 8)) || 'LOBBY';
    const name = (String(data.name || '').trim().slice(0, 12)) || 'PLAYER';

    const room = rooms.get(code) || createRoom(code);
    if (room.players.length >= 2) return reject(socket, 'ROOM IS FULL');

    room.players.push(makePlayer(socket.id, name));
    socket.join(code);
    socket.data.roomCode = code;

    if (room.players.length === 2) {
      room.used.clear();
      room.winnerId = null;
      for (const p of room.players) { p.boxes = 0; p.found = []; }
      startRound(room, room.players[0].id);
      broadcast(room, { type: 'start' });
    } else {
      broadcast(room, { type: 'waiting' });
    }
  });

  // ---- Selector picks the number the opponent must find -------------------
  socket.on('select', (payload) => {
    const data = payload || {};
    const room = rooms.get(socket.data.roomCode);
    if (!room) return reject(socket, 'NOT IN A GAME');
    if (room.phase !== 'selecting') return reject(socket, 'NOT SELECTION PHASE');
    if (room.selectorId !== socket.id) return reject(socket, 'NOT YOUR TURN');
    if (data.turnId !== undefined && data.turnId !== room.turnId) return reject(socket, 'TURN ALREADY OVER');

    const number = Number(data.number);
    if (!Number.isInteger(number) || number < 1 || number > BOARD_NUMBERS) {
      return reject(socket, 'BAD NUMBER');
    }
    if (room.used.has(number)) return reject(socket, 'ALREADY USED');

    // Atomic transition: selecting -> searching. Box filling opens for the selector
    // and the opponent's target appears on their screen in the same broadcast.
    room.target = number;
    room.used.add(number);
    room.phase = 'searching';
    room.turnId++;
    broadcast(room, { type: 'selected', number });
  });

  // ---- Seeker taps a number on their own board ---------------------------
  socket.on('guess', (payload) => {
    const data = payload || {};
    const room = rooms.get(socket.data.roomCode);
    if (!room) return reject(socket, 'NOT IN A GAME');
    if (room.phase !== 'searching') return reject(socket, 'NOTHING TO GUESS');
    if (room.selectorId === socket.id) return reject(socket, 'YOU PICKED IT');
    if (data.turnId !== undefined && data.turnId !== room.turnId) return reject(socket, 'TURN ALREADY OVER');

    const number = Number(data.number);
    if (number !== room.target) {
      socket.emit('wrong', { number });
      return;
    }

    // ---- ATOMIC STATE TRANSITION (one synchronous block) -----------------
    // 1. guess validated  2. target still active  3. mark it guessed
    // 4. end the selector's filling phase  5. swap roles  6. seeker becomes selector
    // 7. broadcast. Nothing interleaves: Node runs this handler to completion, and
    // the turnId bump invalidates any fill/guess message already in flight.
    const seeker = room.players.find(p => p.id === socket.id);
    seeker.found.push(number);
    const lockedPlayer = room.selectorId;
    room.target = null;
    startRound(room, socket.id);   // phase -> 'selecting', turnId++
    broadcast(room, { type: 'guessed', number, by: socket.id, lockedPlayer });
  });

  // ---- Selector fills one blank box --------------------------------------
  socket.on('fillBox', (payload) => {
    const data = payload || {};
    const room = rooms.get(socket.data.roomCode);
    if (!room) return reject(socket, 'NOT IN A GAME');
    // These checks are what enforce the core rule server-side.
    if (room.winnerId) return reject(socket, 'GAME OVER');
    if (room.phase !== 'searching') return reject(socket, 'BOXES LOCKED');
    if (room.selectorId !== socket.id) return reject(socket, 'BOXES LOCKED');
    // A tap that raced a successful guess: the turn has already moved on.
    if (data.turnId !== undefined && data.turnId !== room.turnId) return reject(socket, 'TOO LATE - LOCKED');

    const me = room.players.find(p => p.id === socket.id);
    if (me.boxes >= TOTAL_BOXES) return reject(socket, 'ALL BOXES FILLED');

    me.boxes++;
    if (me.boxes >= TOTAL_BOXES) {
      room.winnerId = me.id;
      room.phase = 'finished';
      room.target = null;
      room.turnId++;
      broadcast(room, { type: 'win', by: me.id });
      return;
    }
    broadcast(room, { type: 'fill', by: me.id, boxes: me.boxes });
  });

  socket.on('restart', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.players.length < 2) return;
    room.used.clear();
    room.winnerId = null;
    for (const p of room.players) { p.boxes = 0; p.found = []; p.board = shuffled(BOARD_NUMBERS); }
    startRound(room, room.players[0].id);
    broadcast(room, { type: 'start' });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) { rooms.delete(room.code); return; }
    room.phase = 'waiting';
    room.selectorId = null;
    room.target = null;
    room.turnId++;
    broadcast(room, { type: 'left' });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function () {
  console.log('GUESS AND PASS running on http://localhost:' + PORT);
});

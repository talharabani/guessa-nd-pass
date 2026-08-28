import type { Server, Socket } from 'socket.io';
import { repo } from '../db/index.js';
import {
  beginCountdown,
  beginPlay,
  bothWantRematch,
  fillBox,
  guessNumber,
  joinGame,
  playerOf,
  progressOf,
  requestRematch,
  selectNumber,
  setConnected,
  setReady,
  startRematch
} from '../game/engine.js';
import {
  attachSocket,
  bindUser,
  createRoom,
  destroyRoom,
  detachSocket,
  getRoom,
  roomOfUser,
  socketIdsFor,
  type Room
} from '../game/rooms.js';
import { isContentType, maxBoardSize, type ContentType } from '../game/content.js';
import type { EngineResult, GameEvent } from '../game/types.js';
import { lobbyView, snapshotFor } from '../game/view.js';
import { verifyToken } from '../auth/service.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Socket layer.

   Every handler follows the same shape:
     1. resolve the caller's room from their AUTHENTICATED user id (never from
        anything the client sends),
     2. run the engine, which validates and mutates atomically,
     3. broadcast a fresh personalised snapshot to both players,
     4. emit named events purely so the UI can animate.

   The snapshot is authoritative. Named events never carry permissions.
   ═══════════════════════════════════════════════════════════════════════════ */

interface SocketUser {
  userId: string;
  username: string;
}

declare module 'socket.io' {
  interface SocketData {
    user: SocketUser;
    /** sliding-window action counter, to blunt event floods */
    windowStart: number;
    windowCount: number;
  }
}

const ACTIONS_PER_SECOND = 40; // generous: box filling is meant to be frantic

function rateLimited(socket: Socket): boolean {
  const now = Date.now();
  if (now - socket.data.windowStart > 1000) {
    socket.data.windowStart = now;
    socket.data.windowCount = 0;
  }
  socket.data.windowCount++;
  return socket.data.windowCount > ACTIONS_PER_SECOND;
}

type Ack = ((res: { ok: boolean; error?: string; roomCode?: string }) => void) | undefined;

/** Accept a client-supplied setting only if it is a whole number in range. */
function clampInt(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  return i >= min && i <= max ? i : undefined;
}

export function registerSockets(io: Server): void {
  /* ─────────────────────── handshake authentication ──────────────────────── */
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.slice(7)
        : undefined);

    const payload = token ? verifyToken(token) : null;
    if (!payload) return next(new Error('UNAUTHENTICATED'));

    socket.data.user = { userId: payload.sub, username: payload.username };
    socket.data.windowStart = Date.now();
    socket.data.windowCount = 0;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    /* ── helpers bound to this connection ── */

    const pushState = (room: Room): void => {
      room.state.version++;
      room.lastActivity = Date.now();
      for (const p of room.state.players) {
        const view = snapshotFor(room.state, p.userId);
        for (const sid of socketIdsFor(room, p.userId)) io.to(sid).emit('game_state', view);
      }
    };

    const emitEvents = (room: Room, events: GameEvent[]): void => {
      for (const e of events) io.to(room.state.roomCode).emit(e.type, e);
    };

    /** Run an engine call, broadcast on success, ack the error on failure. */
    const apply = (room: Room, result: EngineResult, ack: Ack): boolean => {
      if (!result.ok) {
        socket.emit('action_rejected', { code: result.code, message: result.message });
        ack?.({ ok: false, error: result.message });
        return false;
      }
      pushState(room);
      emitEvents(room, result.events);
      ack?.({ ok: true });
      return true;
    };

    const myRoom = (ack?: Ack): Room | null => {
      const room = roomOfUser(user.userId);
      if (!room) {
        socket.emit('action_rejected', { code: 'NOT_IN_GAME', message: 'You are not in a game.' });
        ack?.({ ok: false, error: 'You are not in a game.' });
        return null;
      }
      return room;
    };

    const guard = (ack?: Ack): boolean => {
      if (rateLimited(socket)) {
        socket.emit('action_rejected', { code: 'RATE_LIMITED', message: 'Slow down.' });
        ack?.({ ok: false, error: 'Slow down.' });
        return false;
      }
      return true;
    };

    /* ── countdown, driven server-side so both clients tick together ── */
    const runCountdown = (room: Room): void => {
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      let remaining = room.state.config.countdownSeconds;
      io.to(room.state.roomCode).emit('countdown', { seconds: remaining });

      room.countdownTimer = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          io.to(room.state.roomCode).emit('countdown', { seconds: remaining });
          return;
        }
        if (room.countdownTimer) clearInterval(room.countdownTimer);
        room.countdownTimer = null;

        const started = beginPlay(room.state);
        if (started.ok) {
          pushState(room);
          emitEvents(room, started.events);
          if (room.state.gameId) {
            repo.markGameInProgress(room.state.gameId).catch((e) => console.error('db start', e));
          }
        }
      }, 1000);
    };

    const persistFinish = (room: Room): void => {
      const s = room.state;
      if (!s.gameId) return;
      repo
        .finishGame({
          gameId: s.gameId,
          winnerId: s.winnerUserId,
          rounds: s.rounds,
          players: s.players.map((p) => ({
            userId: p.userId,
            seat: p.seat,
            progress: progressOf(p),
            tokensFound: p.completedTokens.length,
            boardTokens: p.board,
            completedTokens: p.completedTokens
          }))
        })
        .catch((e) => console.error('db finish', e));
    };

    /* ───────────────── reconnect: put the player back where they were ─────── */
    const existing = roomOfUser(user.userId);
    if (existing && playerOf(existing.state, user.userId)) {
      const grace = existing.graceTimers.get(user.userId);
      if (grace) {
        clearTimeout(grace);
        existing.graceTimers.delete(user.userId);
      }
      attachSocket(existing, user.userId, socket.id);
      void socket.join(existing.state.roomCode);
      const res = setConnected(existing.state, user.userId, true);
      pushState(existing);
      if (res.ok && res.events.length) emitEvents(existing, res.events);
      socket.emit('session_restored', { roomCode: existing.state.roomCode });
    }

    /* ══════════════════════════════ lobby ════════════════════════════════ */

    socket.on(
      'create_game',
      (
        payload: { boxCount?: number; boardSize?: number; contentType?: string } | undefined,
        ack: Ack
      ) => {
      if (!guard(ack)) return;
      const previous = roomOfUser(user.userId);
      if (previous && previous.state.status !== 'FINISHED') {
        // one live room per player — leave the old one first
        detachSocket(previous, user.userId, socket.id);
      }

      // Settings are host-chosen but server-clamped: a hostile client cannot
      // ask for a 5000-box game or an unknown token set.
      const contentType: ContentType = isContentType(payload?.contentType)
        ? payload.contentType
        : 'DIGITS';
      const boxCount = clampInt(payload?.boxCount, 5, 200);
      const boardSize = clampInt(payload?.boardSize, 9, maxBoardSize(contentType));

      const room = createRoom(user, {
        contentType,
        ...(boxCount ? { boxCount } : {}),
        ...(boardSize ? { boardSize } : {})
      });
      attachSocket(room, user.userId, socket.id);
      void socket.join(room.state.roomCode);

      repo
        .createGame({
          roomCode: room.state.roomCode,
          hostId: user.userId,
          boxCount: room.state.config.boxCount,
          boardSize: room.state.config.boardSize,
          contentType: room.state.config.contentType
        })
        .then((gameId) => {
          room.state.gameId = gameId;
          const host = playerOf(room.state, user.userId);
          return host ? repo.addGamePlayer(gameId, user.userId, 1, host.board) : undefined;
        })
        .catch((e) => console.error('db create', e));

      pushState(room);
      io.to(room.state.roomCode).emit('lobby_state', lobbyView(room.state));
      ack?.({ ok: true, roomCode: room.state.roomCode });
      }
    );

    socket.on('join_game', (payload: { roomCode?: string } | undefined, ack: Ack) => {
      if (!guard(ack)) return;
      const code = String(payload?.roomCode ?? '')
        .trim()
        .toUpperCase();
      const room = getRoom(code);
      if (!room) {
        socket.emit('action_rejected', { code: 'NO_SUCH_ROOM', message: 'No game with that code.' });
        return ack?.({ ok: false, error: 'No game with that code.' });
      }

      const already = playerOf(room.state, user.userId);
      if (!already) {
        const res = joinGame(room.state, user);
        if (!res.ok) {
          socket.emit('action_rejected', { code: res.code, message: res.message });
          return ack?.({ ok: false, error: res.message });
        }
        emitEvents(room, res.events);
        const joined = playerOf(room.state, user.userId);
        if (room.state.gameId && joined) {
          repo
            .addGamePlayer(room.state.gameId, user.userId, joined.seat, joined.board)
            .catch((e) => console.error('db join', e));
        }
      }

      bindUser(user.userId, room.state.roomCode);
      attachSocket(room, user.userId, socket.id);
      void socket.join(room.state.roomCode);
      setConnected(room.state, user.userId, true);

      pushState(room);
      io.to(room.state.roomCode).emit('lobby_state', lobbyView(room.state));
      ack?.({ ok: true, roomCode: room.state.roomCode });
    });

    socket.on('player_ready', (payload: { ready?: boolean } | undefined, ack: Ack) => {
      if (!guard(ack)) return;
      const room = myRoom(ack);
      if (!room) return;
      if (apply(room, setReady(room.state, user.userId, payload?.ready !== false), ack)) {
        io.to(room.state.roomCode).emit('lobby_state', lobbyView(room.state));
      }
    });

    socket.on('start_game', (_payload: unknown, ack: Ack) => {
      if (!guard(ack)) return;
      const room = myRoom(ack);
      if (!room) return;
      if (apply(room, beginCountdown(room.state, user.userId), ack)) runCountdown(room);
    });

    /* ═════════════════════════════ gameplay ══════════════════════════════ */

    // 1. SELECT — hands the opponent their target and opens your boxes.
    socket.on('select_number', (payload: { value?: string; turnId?: number } | undefined, ack: Ack) => {
      if (!guard(ack)) return;
      const room = myRoom(ack);
      if (!room) return;
      apply(room, selectNumber(room.state, user.userId, String(payload?.value ?? ''), payload?.turnId), ack);
    });

    // 2. GUESS — a correct tap flips the roles atomically; a wrong tap changes nothing.
    socket.on('guess_number', (payload: { value?: string; turnId?: number } | undefined, ack: Ack) => {
      if (!guard(ack)) return;
      const room = myRoom(ack);
      if (!room) return;

      const value = String(payload?.value ?? '');
      const res = guessNumber(room.state, user.userId, value, payload?.turnId);
      if (!res.ok) {
        socket.emit('action_rejected', { code: res.code, message: res.message });
        return ack?.({ ok: false, error: res.message });
      }
      // A wrong guess now WIPES the guesser's boxes, so it changes shared state:
      // both clients need the new snapshot, and the opponent should see the
      // progress bar collapse. The target itself is never revealed by it.
      pushState(room);
      emitEvents(room, res.events);
      ack?.({ ok: true });
    });

    // 3. FILL BOX — the parallel action, legal only while your opponent hunts.
    socket.on('fill_box', (payload: { boxIndex?: number; turnId?: number } | undefined, ack: Ack) => {
      if (!guard(ack)) return;
      const room = myRoom(ack);
      if (!room) return;

      const res = fillBox(room.state, user.userId, Number(payload?.boxIndex), payload?.turnId);
      if (!apply(room, res, ack)) return;

      const me = playerOf(room.state, user.userId);
      if (me) {
        io.to(room.state.roomCode).emit('progress_updated', {
          seat: me.seat,
          userId: me.userId,
          progress: progressOf(me),
          total: room.state.config.boxCount
        });
      }
      if (room.state.status === 'FINISHED') persistFinish(room);
    });

    /* ═════════════════════════════ rematch ═══════════════════════════════ */

    socket.on('request_rematch', (_payload: unknown, ack: Ack) => {
      if (!guard(ack)) return;
      const room = myRoom(ack);
      if (!room) return;
      if (!apply(room, requestRematch(room.state, user.userId), ack)) return;

      if (bothWantRematch(room.state)) {
        const res = startRematch(room.state);
        if (res.ok) {
          repo
            .createGame({
              roomCode: room.state.roomCode,
              hostId: room.state.hostUserId,
              boxCount: room.state.config.boxCount,
              boardSize: room.state.config.boardSize,
              contentType: room.state.config.contentType
            })
            .then(async (gameId) => {
              room.state.gameId = gameId;
              for (const p of room.state.players) await repo.addGamePlayer(gameId, p.userId, p.seat, p.board);
            })
            .catch((e) => console.error('db rematch', e));

          pushState(room);
          emitEvents(room, res.events);
          runCountdown(room);
        }
      }
    });

    socket.on('leave_game', (_payload: unknown, ack: Ack) => {
      const room = roomOfUser(user.userId);
      if (!room) return ack?.({ ok: true });
      detachSocket(room, user.userId, socket.id);
      void socket.leave(room.state.roomCode);
      setConnected(room.state, user.userId, false);
      pushState(room);
      io.to(room.state.roomCode).emit('player_left', { userId: user.userId });
      if (room.sockets.size === 0) destroyRoom(room.state.roomCode);
      ack?.({ ok: true });
    });

    /* ═══════════════ disconnect, with a reconnection window ══════════════ */

    socket.on('disconnect', () => {
      const room = roomOfUser(user.userId);
      if (!room) return;
      const gone = detachSocket(room, user.userId, socket.id);
      if (!gone) return; // another tab is still open

      const res = setConnected(room.state, user.userId, false);
      pushState(room);
      if (res.ok && res.events.length) emitEvents(room, res.events);

      const timer = setTimeout(() => {
        room.graceTimers.delete(user.userId);
        const stillGone = !room.sockets.has(user.userId);
        if (!stillGone) return;

        const playing = room.state.status !== 'FINISHED';
        const opponent = room.state.players.find((p) => p.userId !== user.userId);
        if (playing && opponent) {
          // Forfeit: the player who stayed takes the match.
          room.state.status = 'FINISHED';
          room.state.winnerUserId = opponent.userId;
          room.state.finishedAt = Date.now();
          room.state.target = null;
          room.state.turnId++;
          pushState(room);
          io.to(room.state.roomCode).emit('opponent_forfeit', { userId: user.userId });
          io.to(room.state.roomCode).emit('game_finished', {
            type: 'game_finished',
            winnerUserId: opponent.userId,
            winnerSeat: opponent.seat
          });
          persistFinish(room);
        }
        if (room.sockets.size === 0) destroyRoom(room.state.roomCode);
      }, room.state.config.reconnectGraceMs);

      room.graceTimers.set(user.userId, timer);
    });
  });
}

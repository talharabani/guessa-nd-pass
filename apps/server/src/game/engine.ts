import { makeBoards, makePool } from './boards.js';
import { maxBoardSize } from './content.js';
import {
  DEFAULT_CONFIG,
  fail,
  ok,
  type EngineResult,
  type GameConfig,
  type GameState,
  type NamedState,
  type PlayerState,
  type Seat,
  type Token
} from './types.js';

/* ═══════════════════════════════════════════════════════════════════════════
   The authoritative game engine.

   Pure and synchronous: every mutation happens inside one function call, so a
   guess can never interleave with a box fill. Sockets, database and timers live
   outside this file — everything here is directly unit-testable.
   ═══════════════════════════════════════════════════════════════════════════ */

const otherSeat = (seat: Seat): Seat => (seat === 1 ? 2 : 1);

export function createGame(
  roomCode: string,
  host: { userId: string; username: string },
  config: Partial<GameConfig> = {}
): GameState {
  const cfg: GameConfig = { ...DEFAULT_CONFIG, ...config };
  // A board can never ask for more tiles than its alphabet can supply.
  cfg.boardSize = Math.min(cfg.boardSize, maxBoardSize(cfg.contentType));
  const pool = makePool(cfg.boardSize, cfg.contentType);
  const [boardA] = makeBoards(pool);

  return {
    roomCode,
    gameId: null,
    status: 'WAITING_FOR_PLAYER',
    config: cfg,
    players: [newPlayer(host.userId, host.username, 1, boardA, cfg)],
    pool,
    usedTokens: [],
    selectorSeat: 1,
    target: null,
    turnId: 0,
    version: 0,
    rounds: 0,
    winnerUserId: null,
    hostUserId: host.userId,
    createdAt: Date.now(),
    finishedAt: null
  };
}

function newPlayer(
  userId: string,
  username: string,
  seat: Seat,
  board: Token[],
  cfg: GameConfig
): PlayerState {
  return {
    userId,
    username,
    seat,
    board,
    completedTokens: [],
    filledBoxes: new Array<boolean>(cfg.boxCount).fill(false),
    ready: false,
    connected: true,
    wantsRematch: false,
    totalFound: 0,
    wrongGuesses: 0,
    boxesLost: 0,
    streak: 0,
    bestStreak: 0
  };
}

/* ───────────────────────────────── lookups ───────────────────────────────── */

export const playerOf = (s: GameState, userId: string): PlayerState | undefined =>
  s.players.find((p) => p.userId === userId);

export const seatPlayer = (s: GameState, seat: Seat): PlayerState | undefined =>
  s.players.find((p) => p.seat === seat);

export const progressOf = (p: PlayerState): number => p.filledBoxes.filter(Boolean).length;

/** The spec's state-machine label. PLAYER_2_GUESSING ⇒ P2 searches, P1 fills. */
export function namedState(s: GameState): NamedState {
  switch (s.status) {
    case 'SELECTING':
      return s.selectorSeat === 1 ? 'PLAYER_1_SELECTING' : 'PLAYER_2_SELECTING';
    case 'GUESSING':
      return s.selectorSeat === 1 ? 'PLAYER_2_GUESSING' : 'PLAYER_1_GUESSING';
    default:
      return s.status;
  }
}

/* ── The three permissions. Every UI affordance derives from exactly these. ── */

/** Fill boxes ONLY while the opponent is actively searching for your number. */
export const canFillBoxes = (s: GameState, seat: Seat): boolean =>
  s.status === 'GUESSING' && s.selectorSeat === seat && !s.winnerUserId;

export const canGuess = (s: GameState, seat: Seat): boolean =>
  s.status === 'GUESSING' && s.selectorSeat !== seat && !s.winnerUserId;

export const canSelect = (s: GameState, seat: Seat): boolean =>
  s.status === 'SELECTING' && s.selectorSeat === seat && !s.winnerUserId;

/* ─────────────────────────────── lobby actions ───────────────────────────── */

export function joinGame(
  s: GameState,
  user: { userId: string; username: string }
): EngineResult {
  if (playerOf(s, user.userId)) return fail('ALREADY_JOINED', 'You are already in this game.');
  if (s.players.length >= 2) return fail('ROOM_FULL', 'This room already has two players.');

  const [, boardB] = makeBoards(s.pool);
  s.players.push(newPlayer(user.userId, user.username, 2, boardB, s.config));
  s.status = 'READY';
  return ok({ type: 'player_joined', seat: 2, username: user.username });
}

export function setReady(s: GameState, userId: string, ready: boolean): EngineResult {
  const p = playerOf(s, userId);
  if (!p) return fail('NOT_IN_GAME', 'You are not in this game.');
  if (s.status !== 'READY' && s.status !== 'WAITING_FOR_PLAYER') {
    return fail('WRONG_PHASE', 'The game has already started.');
  }
  p.ready = ready;
  return ok({ type: 'player_ready', seat: p.seat, ready });
}

export const bothReady = (s: GameState): boolean =>
  s.players.length === 2 && s.players.every((p) => p.ready && p.connected);

/** Host presses START. The countdown is driven by the room, not the engine. */
export function beginCountdown(s: GameState, userId: string): EngineResult {
  if (s.hostUserId !== userId) return fail('NOT_HOST', 'Only the host can start the game.');
  if (s.status !== 'READY') return fail('WRONG_PHASE', 'Not ready to start.');
  if (!bothReady(s)) return fail('NOT_READY', 'Both players must be ready.');

  s.status = 'COUNTDOWN';
  s.turnId++;
  return ok({ type: 'countdown', seconds: s.config.countdownSeconds });
}

/** Countdown elapsed: the first selector is chosen at random. */
export function beginPlay(s: GameState): EngineResult {
  if (s.status !== 'COUNTDOWN') return fail('WRONG_PHASE', 'No countdown in progress.');
  s.selectorSeat = Math.random() < 0.5 ? 1 : 2;
  s.status = 'SELECTING';
  s.target = null;
  s.turnId++;
  return ok(
    { type: 'game_start', selectorSeat: s.selectorSeat },
    { type: 'turn_changed', selectorSeat: s.selectorSeat, turnId: s.turnId }
  );
}

/* ══════════════════════════ the three gameplay actions ═══════════════════════ */

/**
 * SELECT — the selector picks the number their opponent must hunt.
 * Transition: SELECTING → GUESSING. This is what opens box filling for the
 * selector and puts the target on the opponent's screen, in one broadcast.
 */
export function selectNumber(
  s: GameState,
  userId: string,
  token: Token,
  clientTurnId?: number
): EngineResult {
  const p = playerOf(s, userId);
  if (!p) return fail('NOT_IN_GAME', 'You are not in this game.');
  if (s.status === 'FINISHED') return fail('GAME_OVER', 'The game is over.');
  if (s.status !== 'SELECTING') return fail('WRONG_PHASE', 'It is not the selection phase.');
  if (s.selectorSeat !== p.seat) return fail('NOT_YOUR_TURN', 'It is not your turn to select.');
  if (clientTurnId !== undefined && clientTurnId !== s.turnId) {
    return fail('STALE_ACTION', 'That turn has already ended.');
  }
  if (typeof token !== 'string' || token.length === 0) return fail('INVALID_TOKEN', 'Not a tile.');
  if (!p.board.includes(token)) return fail('NOT_ON_YOUR_BOARD', 'That tile is not on your board.');
  if (s.usedTokens.includes(token)) return fail('TOKEN_ALREADY_USED', 'That one was already used.');

  s.target = token;
  s.usedTokens.push(token);
  s.status = 'GUESSING';
  s.turnId++;
  return ok(
    { type: 'number_selected', value: token, bySeat: p.seat },
    { type: 'turn_changed', selectorSeat: s.selectorSeat, turnId: s.turnId }
  );
}

/**
 * GUESS — the seeker taps a tile on their own board.
 *
 * A wrong tap changes NOTHING: the target stays live, the seeker keeps hunting,
 * and the opponent keeps filling. A correct tap performs the whole transition in
 * one synchronous block — mark completed, lock the filler, invert the roles,
 * bump turnId — so no fill can slip in between.
 */
export function guessNumber(
  s: GameState,
  userId: string,
  token: Token,
  clientTurnId?: number
): EngineResult & { correct?: boolean } {
  const p = playerOf(s, userId);
  if (!p) return fail('NOT_IN_GAME', 'You are not in this game.');
  if (s.status === 'FINISHED') return fail('GAME_OVER', 'The game is over.');
  if (s.status !== 'GUESSING') return fail('WRONG_PHASE', 'There is nothing to guess right now.');
  if (s.selectorSeat === p.seat) return fail('NOT_YOUR_TURN', 'You chose this number.');
  if (clientTurnId !== undefined && clientTurnId !== s.turnId) {
    return fail('STALE_ACTION', 'That target is no longer active.');
  }
  if (!p.board.includes(token)) return fail('NOT_ON_YOUR_BOARD', 'That tile is not on your board.');

  if (token !== s.target) {
    /*
     * WRONG GUESS — the penalty that gives the hunt its weight.
     *
     * The turn does NOT switch and the target stays live: the hunter must keep
     * searching while their opponent keeps filling. What they lose is their own
     * progress — every box they had banked is wiped. Boxes are earned as the
     * selector and destroyed by carelessness as the hunter.
     */
    const boxesLost = progressOf(p);
    p.filledBoxes.fill(false);
    p.wrongGuesses++;
    p.boxesLost += boxesLost;
    p.streak = 0;
    return {
      ok: true,
      events: [{ type: 'wrong_guess', value: token, bySeat: p.seat, boxesLost }],
      correct: false
    };
  }

  const lockedSeat = s.selectorSeat; // whoever was filling stops RIGHT NOW
  p.completedTokens.push(token);
  p.totalFound++;
  p.streak++;
  if (p.streak > p.bestStreak) p.bestStreak = p.streak;
  s.rounds++;
  s.target = null;
  s.selectorSeat = p.seat; // the finder becomes the selector
  s.status = 'SELECTING';
  s.turnId++;

  const events = [
    { type: 'correct_guess', value: token, bySeat: p.seat, lockedSeat } as const,
    { type: 'turn_changed', selectorSeat: s.selectorSeat, turnId: s.turnId } as const
  ];

  // Every token consumed? Deal a fresh pool so the race can continue.
  if (s.usedTokens.length >= s.pool.length) {
    replenish(s);
    return { ok: true, events: [...events, { type: 'boards_replenished' }], correct: true };
  }
  return { ok: true, events, correct: true };
}

function replenish(s: GameState): void {
  s.pool = makePool(s.config.boardSize, s.config.contentType);
  const [a, b] = makeBoards(s.pool);
  const p1 = seatPlayer(s, 1);
  const p2 = seatPlayer(s, 2);
  if (p1) {
    p1.board = a;
    p1.completedTokens = [];
  }
  if (p2) {
    p2.board = b;
    p2.completedTokens = [];
  }
  s.usedTokens = [];
}

/**
 * FILL BOX — the parallel action, and the only way to make progress.
 * Legal ONLY while you are the selector and your opponent is still hunting.
 * The client sends a box index; the server owns the array and rejects re-fills,
 * so a hostile client cannot jump straight to a full board.
 */
export function fillBox(
  s: GameState,
  userId: string,
  boxIndex: number,
  clientTurnId?: number
): EngineResult {
  const p = playerOf(s, userId);
  if (!p) return fail('NOT_IN_GAME', 'You are not in this game.');
  if (s.status === 'FINISHED' || s.winnerUserId) return fail('GAME_OVER', 'The game is over.');
  if (s.status !== 'GUESSING') return fail('BOXES_LOCKED', 'Your boxes are locked.');
  if (s.selectorSeat !== p.seat) return fail('BOXES_LOCKED', 'You can only fill while your opponent searches.');
  // A tap that raced the winning guess arrives under the previous turnId.
  if (clientTurnId !== undefined && clientTurnId !== s.turnId) {
    return fail('STALE_ACTION', 'Too late — the turn already switched.');
  }
  if (!Number.isInteger(boxIndex) || boxIndex < 0 || boxIndex >= s.config.boxCount) {
    return fail('INVALID_BOX', 'No such box.');
  }
  if (p.filledBoxes[boxIndex]) return fail('BOX_ALREADY_FILLED', 'That box is already filled.');

  p.filledBoxes[boxIndex] = true;
  const progress = progressOf(p);
  const events = [{ type: 'box_filled', bySeat: p.seat, boxIndex, progress } as const];

  if (progress >= s.config.boxCount) {
    s.winnerUserId = p.userId;
    s.status = 'FINISHED';
    s.target = null;
    s.finishedAt = Date.now();
    s.turnId++;
    return ok(...events, { type: 'game_finished', winnerUserId: p.userId, winnerSeat: p.seat });
  }
  return ok(...events);
}

/* ───────────────────────── connection & rematch ──────────────────────────── */

export function setConnected(s: GameState, userId: string, connected: boolean): EngineResult {
  const p = playerOf(s, userId);
  if (!p) return fail('NOT_IN_GAME', 'You are not in this game.');
  if (p.connected === connected) return ok();
  p.connected = connected;
  return ok({ type: connected ? 'player_reconnected' : 'player_disconnected', seat: p.seat });
}

export function requestRematch(s: GameState, userId: string): EngineResult {
  const p = playerOf(s, userId);
  if (!p) return fail('NOT_IN_GAME', 'You are not in this game.');
  if (s.status !== 'FINISHED') return fail('WRONG_PHASE', 'The game is still running.');
  p.wantsRematch = true;
  return ok({ type: 'rematch_requested', seat: p.seat });
}

export const bothWantRematch = (s: GameState): boolean =>
  s.players.length === 2 && s.players.every((p) => p.wantsRematch);

/** Fresh boards, zeroed progress, random first selector. */
export function startRematch(s: GameState): EngineResult {
  if (!bothWantRematch(s)) return fail('NOT_READY', 'Both players must want a rematch.');
  s.pool = makePool(s.config.boardSize, s.config.contentType);
  const [a, b] = makeBoards(s.pool);
  const p1 = seatPlayer(s, 1);
  const p2 = seatPlayer(s, 2);
  for (const [p, board] of [
    [p1, a],
    [p2, b]
  ] as const) {
    if (!p) continue;
    p.board = board as Token[];
    p.completedTokens = [];
    p.filledBoxes = new Array<boolean>(s.config.boxCount).fill(false);
    p.wantsRematch = false;
    p.ready = true;
    p.totalFound = 0;
    p.wrongGuesses = 0;
    p.boxesLost = 0;
    p.streak = 0;
    p.bestStreak = 0;
  }
  s.usedTokens = [];
  s.target = null;
  s.winnerUserId = null;
  s.finishedAt = null;
  s.gameId = null;
  s.status = 'COUNTDOWN';
  s.turnId++;
  return ok({ type: 'rematch_started' }, { type: 'countdown', seconds: s.config.countdownSeconds });
}

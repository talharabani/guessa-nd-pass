/**
 * Core game types.
 *
 * THE MECHANIC, in one paragraph:
 * One player is the SELECTOR, the other is the SEEKER. The selector taps a number
 * on their own board; it is transmitted instantly and appears on the seeker's
 * screen as the number to guess. The seeker hunts that number on their own board
 * (same numbers, different arrangement). While the seeker searches, and ONLY
 * then, the selector taps their blank boxes — one fill per tap. The instant the
 * seeker taps the correct number, the selector's boxes lock and the roles invert.
 * First player to fill every box wins.
 */

import type { ContentType } from './content.js';

export type Seat = 1 | 2;

/** A board tile. Opaque on purpose: '57', 'K' and '★' are all just tokens. */
export type Token = string;

export type GameStatus =
  | 'WAITING_FOR_PLAYER' // room created, second player has not arrived
  | 'READY' // both present, waiting for ready-up / host start
  | 'COUNTDOWN' // 3-2-1 before the first selection
  | 'SELECTING' // selector must pick a number; NOBODY may fill boxes
  | 'GUESSING' // seeker hunts the target; ONLY the selector may fill boxes
  | 'FINISHED'; // a winner exists; every gameplay action is rejected

/**
 * The spec's state-machine names, derived from `status` + `selectorSeat`.
 * PLAYER_2_GUESSING means: player 2 is searching AND player 1 may fill boxes.
 */
export type NamedState =
  | 'WAITING_FOR_PLAYER'
  | 'READY'
  | 'COUNTDOWN'
  | 'PLAYER_1_SELECTING'
  | 'PLAYER_2_SELECTING'
  | 'PLAYER_1_GUESSING'
  | 'PLAYER_2_GUESSING'
  | 'FINISHED';

export interface GameConfig {
  /** Blank boxes per player. Fill them all to win. */
  boxCount: number;
  /** Tiles on each board. */
  boardSize: number;
  /** What the tiles are made of: digits, letters, symbols or a mix. */
  contentType: ContentType;
  /** Seconds of countdown before play begins. */
  countdownSeconds: number;
  /** Grace period, in ms, before a disconnected player forfeits. */
  reconnectGraceMs: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  boxCount: 100,
  boardSize: 20,
  contentType: 'DIGITS',
  countdownSeconds: 3,
  reconnectGraceMs: 60_000
};

export interface PlayerState {
  userId: string;
  username: string;
  seat: Seat;
  /** This player's arrangement of the shared pool. */
  board: Token[];
  /** Tokens this player has successfully found. */
  completedTokens: Token[];
  /** One flag per box; a box can only be filled once. */
  filledBoxes: boolean[];
  ready: boolean;
  connected: boolean;
  wantsRematch: boolean;

  /* ── lifetime match stats, for the result screen ── */
  /** Targets found across the whole match; survives a board replenish. */
  totalFound: number;
  wrongGuesses: number;
  /** Boxes wiped by wrong guesses — the real cost of a mis-tap. */
  boxesLost: number;
  /** Consecutive correct finds, and the best such run this match. */
  streak: number;
  bestStreak: number;
}

export interface GameState {
  roomCode: string;
  /** Persisted game row id, when a database is configured. */
  gameId: string | null;
  status: GameStatus;
  config: GameConfig;
  /** Index 0 is seat 1, index 1 is seat 2. */
  players: PlayerState[];
  /** The shared set of tokens. Both boards hold exactly these, shuffled apart. */
  pool: Token[];
  /** Targets already spent from this pool — never re-selectable. */
  usedTokens: Token[];
  selectorSeat: Seat;
  /** The live target the seeker must find, or null outside GUESSING. */
  target: Token | null;
  /**
   * Incremented on EVERY state transition. Clients echo the turnId they acted
   * under, so an action that raced a transition arrives stale and is rejected.
   */
  turnId: number;
  /** Incremented on every broadcast, for client-side ordering. */
  version: number;
  /** Completed targets across the whole match, including past pools. */
  rounds: number;
  winnerUserId: string | null;
  hostUserId: string;
  createdAt: number;
  finishedAt: number | null;
}

/* ────────────────────────────── engine results ───────────────────────────── */

export type RejectCode =
  | 'NOT_IN_GAME'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'STALE_ACTION'
  | 'INVALID_TOKEN'
  | 'TOKEN_ALREADY_USED'
  | 'NOT_ON_YOUR_BOARD'
  | 'BOX_ALREADY_FILLED'
  | 'INVALID_BOX'
  | 'BOXES_LOCKED'
  | 'GAME_OVER'
  | 'ROOM_FULL'
  | 'NOT_HOST'
  | 'NOT_READY'
  | 'ALREADY_JOINED';

export type GameEvent =
  | { type: 'player_joined'; seat: Seat; username: string }
  | { type: 'player_ready'; seat: Seat; ready: boolean }
  | { type: 'countdown'; seconds: number }
  | { type: 'game_start'; selectorSeat: Seat }
  | { type: 'number_selected'; value: Token; bySeat: Seat }
  | { type: 'correct_guess'; value: Token; bySeat: Seat; lockedSeat: Seat }
  | { type: 'wrong_guess'; value: Token; bySeat: Seat; boxesLost: number }
  | { type: 'box_filled'; bySeat: Seat; boxIndex: number; progress: number }
  | { type: 'turn_changed'; selectorSeat: Seat; turnId: number }
  | { type: 'boards_replenished' }
  | { type: 'game_finished'; winnerUserId: string; winnerSeat: Seat }
  | { type: 'player_disconnected'; seat: Seat }
  | { type: 'player_reconnected'; seat: Seat }
  | { type: 'rematch_requested'; seat: Seat }
  | { type: 'rematch_started' };

export type EngineResult =
  | { ok: true; events: GameEvent[] }
  | { ok: false; code: RejectCode; message: string };

export const ok = (...events: GameEvent[]): EngineResult => ({ ok: true, events });
export const fail = (code: RejectCode, message: string): EngineResult => ({ ok: false, code, message });

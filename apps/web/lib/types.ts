/** Mirrors the server's `GameView` (apps/server/src/game/view.ts). */

export type GameStatus =
  | 'WAITING_FOR_PLAYER'
  | 'READY'
  | 'COUNTDOWN'
  | 'SELECTING'
  | 'GUESSING'
  | 'FINISHED';

export type NamedState =
  | 'WAITING_FOR_PLAYER'
  | 'READY'
  | 'COUNTDOWN'
  | 'PLAYER_1_SELECTING'
  | 'PLAYER_2_SELECTING'
  | 'PLAYER_1_GUESSING'
  | 'PLAYER_2_GUESSING'
  | 'FINISHED';

export type ContentType = 'DIGITS' | 'LETTERS' | 'SYMBOLS' | 'MIXED';

/** A board tile. Opaque on purpose: '57', 'K' and '★' are all just tokens. */
export type Token = string;

/** Match stats, live in the HUD and totalled on the result screen. */
export interface PlayerStats {
  totalFound: number;
  wrongGuesses: number;
  boxesLost: number;
  streak: number;
  bestStreak: number;
}

export interface PlayerView {
  userId: string;
  username: string;
  seat: 1 | 2;
  board: Token[];
  completedTokens: Token[];
  filledBoxes: boolean[];
  progress: number;
  ready: boolean;
  connected: boolean;
  wantsRematch: boolean;
  stats: PlayerStats;
}

export interface OpponentView {
  userId: string;
  username: string;
  seat: 1 | 2;
  progress: number;
  ready: boolean;
  connected: boolean;
  wantsRematch: boolean;
  stats: PlayerStats;
}

export interface GameView {
  roomCode: string;
  status: GameStatus;
  namedState: NamedState;
  version: number;
  turnId: number;
  totalBoxes: number;
  boardSize: number;
  /** Boxes a wrong guess takes back. Server-owned; the UI only reads it. */
  wrongGuessPenalty: number;
  contentType: ContentType;
  countdownSeconds: number;
  isHost: boolean;
  role: 'selector' | 'seeker' | 'none';
  /** Server-computed. The UI mirrors these and never decides for itself. */
  canSelect: boolean;
  canGuess: boolean;
  canFillBoxes: boolean;
  target: Token | null;
  usedTokens: Token[];
  winnerUserId: string | null;
  me: PlayerView | null;
  opponent: OpponentView | null;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface Rejection {
  code: string;
  message: string;
}

/** Named notifications used purely to trigger animation and sound. */
export interface CorrectGuessEvent {
  type: 'correct_guess';
  value: Token;
  bySeat: 1 | 2;
  lockedSeat: 1 | 2;
}

export interface NumberSelectedEvent {
  type: 'number_selected';
  value: Token;
  bySeat: 1 | 2;
}

export interface BoxFilledEvent {
  type: 'box_filled';
  bySeat: 1 | 2;
  boxIndex: number;
  progress: number;
}

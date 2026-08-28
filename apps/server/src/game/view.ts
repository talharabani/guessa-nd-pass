import { canFillBoxes, canGuess, canSelect, namedState, playerOf, progressOf, seatPlayer } from './engine.js';
import type { ContentType } from './content.js';
import type { GameState, NamedState, Seat, Token } from './types.js';

/**
 * The personalised snapshot a client renders. It is the ONLY thing the UI reads,
 * which is why permissions are shipped as booleans the server computed — the
 * client never derives whether it may act.
 *
 * Note what is absent: the opponent's board. Only their progress is public.
 */
/** Match stats, shown live in the HUD and totalled on the result screen. */
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
  seat: Seat;
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
  seat: Seat;
  progress: number;
  ready: boolean;
  connected: boolean;
  wantsRematch: boolean;
  stats: PlayerStats;
}

export interface GameView {
  roomCode: string;
  status: GameState['status'];
  namedState: NamedState;
  version: number;
  turnId: number;
  totalBoxes: number;
  boardSize: number;
  /** What the tiles are made of, so the client can size the type to suit. */
  contentType: ContentType;
  countdownSeconds: number;
  isHost: boolean;
  role: 'selector' | 'seeker' | 'none';
  /** Server-computed permissions. The client mirrors these and nothing else. */
  canSelect: boolean;
  canGuess: boolean;
  canFillBoxes: boolean;
  /** Public on purpose: the selector sees "YOUR TILE", the seeker "FIND THIS". */
  target: Token | null;
  /**
   * Targets already consumed — used to grey out tiles you may no longer select.
   *
   * The LIVE target is withheld from the player who is hunting it. It is a used
   * number, so including it would let their board mark the very tile they are
   * supposed to be searching for, which hands them the answer.
   */
  usedTokens: Token[];
  winnerUserId: string | null;
  me: PlayerView | null;
  opponent: OpponentView | null;
}

export function snapshotFor(s: GameState, userId: string): GameView {
  const me = playerOf(s, userId) ?? null;
  const foe = s.players.find((p) => p.userId !== userId) ?? null;
  const seat = me?.seat ?? null;
  const playing = s.status === 'SELECTING' || s.status === 'GUESSING';

  // Never tell the hunter which tile is the answer, not even indirectly.
  const statsOf = (p: { totalFound: number; wrongGuesses: number; boxesLost: number; streak: number; bestStreak: number }): PlayerStats => ({
    totalFound: p.totalFound,
    wrongGuesses: p.wrongGuesses,
    boxesLost: p.boxesLost,
    streak: p.streak,
    bestStreak: p.bestStreak
  });

  const isHunter = seat !== null && s.status === 'GUESSING' && s.selectorSeat !== seat;
  const visibleUsed =
    isHunter && s.target !== null ? s.usedTokens.filter((t) => t !== s.target) : [...s.usedTokens];

  return {
    roomCode: s.roomCode,
    status: s.status,
    namedState: namedState(s),
    version: s.version,
    turnId: s.turnId,
    totalBoxes: s.config.boxCount,
    boardSize: s.config.boardSize,
    contentType: s.config.contentType,
    countdownSeconds: s.config.countdownSeconds,
    isHost: s.hostUserId === userId,
    role: !seat || !playing ? 'none' : s.selectorSeat === seat ? 'selector' : 'seeker',
    canSelect: seat ? canSelect(s, seat) : false,
    canGuess: seat ? canGuess(s, seat) : false,
    canFillBoxes: seat ? canFillBoxes(s, seat) : false,
    target: s.target,
    usedTokens: visibleUsed,
    winnerUserId: s.winnerUserId,
    me: me
      ? {
          userId: me.userId,
          username: me.username,
          seat: me.seat,
          board: [...me.board],
          completedTokens: [...me.completedTokens],
          filledBoxes: [...me.filledBoxes],
          progress: progressOf(me),
          ready: me.ready,
          connected: me.connected,
          wantsRematch: me.wantsRematch,
          stats: statsOf(me)
        }
      : null,
    opponent: foe
      ? {
          userId: foe.userId,
          username: foe.username,
          seat: foe.seat,
          progress: progressOf(foe),
          ready: foe.ready,
          connected: foe.connected,
          wantsRematch: foe.wantsRematch,
          stats: statsOf(foe)
        }
      : null
  };
}

/** Lobby summary, safe to hand to anyone holding the room code. */
export function lobbyView(s: GameState) {
  const p1 = seatPlayer(s, 1);
  const p2 = seatPlayer(s, 2);
  return {
    roomCode: s.roomCode,
    status: s.status,
    hostUserId: s.hostUserId,
    contentType: s.config.contentType,
    boxCount: s.config.boxCount,
    boardSize: s.config.boardSize,
    players: [p1, p2].map((p) =>
      p
        ? { userId: p.userId, username: p.username, seat: p.seat, ready: p.ready, connected: p.connected }
        : null
    )
  };
}

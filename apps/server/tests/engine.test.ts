import { describe, expect, it } from 'vitest';
import {
  beginCountdown,
  beginPlay,
  bothWantRematch,
  canFillBoxes,
  canGuess,
  canSelect,
  createGame,
  fillBox,
  guessNumber,
  joinGame,
  namedState,
  playerOf,
  progressOf,
  requestRematch,
  seatPlayer,
  selectNumber,
  setConnected,
  setReady,
  startRematch,
  WRONG_GUESS_PENALTY
} from '../src/game/engine.js';
import { snapshotFor } from '../src/game/view.js';
import { DEFAULT_CONFIG, type GameState, type Seat } from '../src/game/types.js';

const HOST = { userId: 'u1', username: 'ALPHA' };
const GUEST = { userId: 'u2', username: 'BRAVO' };

/** A game sitting in SELECTING with a known selector. */
function playingGame(selector: Seat = 1, config = {}): GameState {
  const s = createGame('TEST1', HOST, config);
  joinGame(s, GUEST);
  setReady(s, HOST.userId, true);
  setReady(s, GUEST.userId, true);
  beginCountdown(s, HOST.userId);
  beginPlay(s);
  s.selectorSeat = selector; // beginPlay randomises; pin it for determinism
  return s;
}

const seatOf = (s: GameState, seat: Seat) => seatPlayer(s, seat)!;
const idOf = (s: GameState, seat: Seat) => seatOf(s, seat).userId;

/* ═══════════════════════════ setup & boards ══════════════════════════ */

describe('game creation', () => {
  it('starts waiting for the second player', () => {
    const s = createGame('ABC12', HOST);
    expect(s.status).toBe('WAITING_FOR_PLAYER');
    expect(s.players).toHaveLength(1);
    expect(s.hostUserId).toBe(HOST.userId);
  });

  it('deals a board of unique digit tiles', () => {
    const s = createGame('ABC12', HOST);
    const board = s.players[0]!.board;
    expect(board).toHaveLength(20);
    expect(new Set(board).size).toBe(20);
    expect(board.every((t) => /^[1-9][0-9]?$/.test(t))).toBe(true);
  });

  it('gives both players the SAME numbers in a different order', () => {
    const s = createGame('ABC12', HOST);
    joinGame(s, GUEST);
    const [a, b] = [s.players[0]!.board, s.players[1]!.board];
    // Same set: a target chosen by one always exists on the other's board.
    expect([...a].sort()).toEqual([...b].sort());
    // Different arrangement: that's what makes the visual hunt hard.
    expect(a).not.toEqual(b);
  });

  it('rejects a third player and a duplicate join', () => {
    const s = createGame('ABC12', HOST);
    expect(joinGame(s, GUEST).ok).toBe(true);
    expect(joinGame(s, GUEST)).toMatchObject({ ok: false, code: 'ALREADY_JOINED' });
    expect(joinGame(s, { userId: 'u3', username: 'CHARLIE' })).toMatchObject({
      ok: false,
      code: 'ROOM_FULL'
    });
  });
});

describe('lobby and start', () => {
  it('only the host can start, and only when both are ready', () => {
    const s = createGame('ABC12', HOST);
    joinGame(s, GUEST);
    expect(beginCountdown(s, GUEST.userId)).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(beginCountdown(s, HOST.userId)).toMatchObject({ ok: false, code: 'NOT_READY' });
    setReady(s, HOST.userId, true);
    setReady(s, GUEST.userId, true);
    expect(beginCountdown(s, HOST.userId).ok).toBe(true);
    expect(s.status).toBe('COUNTDOWN');
  });
});

/* ═══════════════════════ the core turn mechanic ══════════════════════ */

describe('permissions — who may do what, when', () => {
  it('during SELECTING nobody may fill boxes', () => {
    const s = playingGame(1);
    expect(s.status).toBe('SELECTING');
    expect(canSelect(s, 1)).toBe(true);
    expect(canSelect(s, 2)).toBe(false);
    expect(canFillBoxes(s, 1)).toBe(false);
    expect(canFillBoxes(s, 2)).toBe(false);
  });

  it('during GUESSING only the selector fills and only the seeker guesses', () => {
    const s = playingGame(1);
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    expect(s.status).toBe('GUESSING');
    expect(canFillBoxes(s, 1)).toBe(true); // selector fills
    expect(canFillBoxes(s, 2)).toBe(false); // seeker may NOT fill while searching
    expect(canGuess(s, 2)).toBe(true);
    expect(canGuess(s, 1)).toBe(false);
  });

  it('exposes the spec state-machine names', () => {
    const s = playingGame(1);
    expect(namedState(s)).toBe('PLAYER_1_SELECTING');
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    // P2 searches AND P1 fills
    expect(namedState(s)).toBe('PLAYER_2_GUESSING');
  });
});

describe('number selection', () => {
  it('sets the target and opens the selector’s boxes', () => {
    const s = playingGame(1);
    const n = seatOf(s, 1).board[3]!;
    const res = selectNumber(s, idOf(s, 1), n);
    expect(res.ok).toBe(true);
    expect(s.target).toBe(n);
    expect(s.usedTokens).toContain(n);
    expect(s.status).toBe('GUESSING');
  });

  it('rejects selecting out of turn, off-board, used, or stale', () => {
    const s = playingGame(1);
    const board1 = seatOf(s, 1).board;
    expect(selectNumber(s, idOf(s, 2), board1[0]!)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(selectNumber(s, idOf(s, 1), 'ZZZ')).toMatchObject({ ok: false, code: 'NOT_ON_YOUR_BOARD' });
    expect(selectNumber(s, idOf(s, 1), board1[0]!, s.turnId + 5)).toMatchObject({
      ok: false,
      code: 'STALE_ACTION'
    });

    // consume one, finish the round, then try to reuse it
    const n = board1[0]!;
    selectNumber(s, idOf(s, 1), n);
    guessNumber(s, idOf(s, 2), n);
    expect(selectNumber(s, idOf(s, 2), n)).toMatchObject({ ok: false, code: 'TOKEN_ALREADY_USED' });
  });
});

describe('guessing', () => {
  it('a wrong guess keeps the hunt alive and takes back what the hunter banked', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    const turnBefore = s.turnId;

    // Seat 2 banked fewer than the penalty, so a mis-tap costs all of them.
    seatOf(s, 2).filledBoxes[0] = true;
    seatOf(s, 2).filledBoxes[1] = true;
    seatOf(s, 2).filledBoxes[2] = true;
    expect(progressOf(seatOf(s, 2))).toBe(3);

    const wrong = seatOf(s, 2).board.find((n) => n !== target)!;
    const res = guessNumber(s, idOf(s, 2), wrong);

    expect(res).toMatchObject({ ok: true, correct: false });
    expect(res.events[0]).toMatchObject({ type: 'wrong_guess', boxesLost: 3 });

    // The penalty
    expect(progressOf(seatOf(s, 2))).toBe(0);
    expect(seatOf(s, 2).wrongGuesses).toBe(1);
    expect(seatOf(s, 2).boxesLost).toBe(3);

    // Everything else is untouched: the hunt continues exactly as before.
    expect(s.target).toBe(target); // still live
    expect(s.turnId).toBe(turnBefore); // no transition
    expect(s.status).toBe('GUESSING');
    expect(canFillBoxes(s, 1)).toBe(true); // opponent keeps filling
    expect(canFillBoxes(s, 2)).toBe(false); // and the hunter still cannot
    expect(seatOf(s, 2).completedTokens).toHaveLength(0);
  });

  /**
   * Puts seat 2 in the filler's chair with `banked` boxes on the board, then
   * hands the turn back so seat 2 is hunting and can mis-tap.
   *
   * Roles alternate, so reaching "seat 2 has banked boxes AND is now the
   * hunter" takes a full round trip: seat 2 has to win the tile to become the
   * selector, fill, and then lose the role again.
   */
  function hunterWithBankedBoxes(banked: number) {
    const s = playingGame(1);
    const id1 = idOf(s, 1);
    const id2 = idOf(s, 2);

    const first = seatOf(s, 1).board[0]!;
    selectNumber(s, id1, first);
    guessNumber(s, id2, first); // seat 2 finds it and becomes the selector

    const second = seatOf(s, 2).board.find((n) => n !== first)!;
    selectNumber(s, id2, second); // now seat 2 is the one filling
    for (let i = 0; i < banked; i++) fillBox(s, id2, i);

    guessNumber(s, id1, second); // seat 1 finds it and takes the selector role
    const third = seatOf(s, 1).board.find((n) => n !== first && n !== second)!;
    selectNumber(s, id1, third); // seat 2 is hunting again, boxes intact

    const wrong = seatOf(s, 2).board.find((n) => n !== third)!;
    return { s, id2, wrong };
  }

  it('takes back only the last ten boxes, newest first', () => {
    const { s, id2, wrong } = hunterWithBankedBoxes(25);
    expect(progressOf(seatOf(s, 2))).toBe(25);

    const res = guessNumber(s, id2, wrong);

    expect(res.events[0]).toMatchObject({ type: 'wrong_guess', boxesLost: WRONG_GUESS_PENALTY });
    expect(progressOf(seatOf(s, 2))).toBe(25 - WRONG_GUESS_PENALTY);
    expect(seatOf(s, 2).boxesLost).toBe(WRONG_GUESS_PENALTY);

    // WHICH ten matters, not just how many: clearing an arbitrary ten would
    // satisfy the count and still show the player the wrong grid.
    const filled = seatOf(s, 2).filledBoxes;
    for (let i = 0; i < 15; i++) expect(filled[i]).toBe(true);
    for (let i = 15; i < 25; i++) expect(filled[i]).toBe(false);
  });

  it('charges a second mis-tap only what is left, and never goes below zero', () => {
    const { s, id2, wrong } = hunterWithBankedBoxes(12);

    guessNumber(s, id2, wrong);
    expect(progressOf(seatOf(s, 2))).toBe(2);

    // Two left to take, so two is what it costs.
    const second = guessNumber(s, id2, wrong);
    expect(second.events[0]).toMatchObject({ type: 'wrong_guess', boxesLost: 2 });
    expect(progressOf(seatOf(s, 2))).toBe(0);
    expect(seatOf(s, 2).boxesLost).toBe(WRONG_GUESS_PENALTY + 2);

    // A third costs nothing rather than reporting a negative.
    const third = guessNumber(s, id2, wrong);
    expect(third.events[0]).toMatchObject({ type: 'wrong_guess', boxesLost: 0 });
    expect(progressOf(seatOf(s, 2))).toBe(0);
  });

  it('never touches the SELECTOR’s boxes when the hunter guesses wrong', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    fillBox(s, idOf(s, 1), 0);
    fillBox(s, idOf(s, 1), 1);

    const wrong = seatOf(s, 2).board.find((n) => n !== target)!;
    guessNumber(s, idOf(s, 2), wrong);

    // The filler is mid-run and must lose nothing.
    expect(progressOf(seatOf(s, 1))).toBe(2);
    expect(seatOf(s, 1).wrongGuesses).toBe(0);
  });

  it('wipes only what was banked, and a second mis-tap costs nothing more', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    const wrong = seatOf(s, 2).board.find((n) => n !== target)!;

    guessNumber(s, idOf(s, 2), wrong); // nothing banked yet
    expect(seatOf(s, 2).boxesLost).toBe(0);
    guessNumber(s, idOf(s, 2), wrong);
    expect(seatOf(s, 2).wrongGuesses).toBe(2);
    expect(progressOf(seatOf(s, 2))).toBe(0);
  });

  it('a correct guess flips the roles atomically', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    const turnBefore = s.turnId;

    const res = guessNumber(s, idOf(s, 2), target);
    expect(res).toMatchObject({ ok: true, correct: true });
    expect(s.turnId).toBe(turnBefore + 1);
    expect(s.status).toBe('SELECTING');
    expect(s.selectorSeat).toBe(2); // the finder now selects
    expect(s.target).toBeNull();
    expect(seatOf(s, 2).completedTokens).toEqual([target]);
    expect(canFillBoxes(s, 1)).toBe(false); // the old filler is LOCKED
    expect(canFillBoxes(s, 2)).toBe(false); // nobody fills during selection
  });

  it('rejects guessing when you are the selector, or off-board, or stale', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    expect(guessNumber(s, idOf(s, 1), target)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(guessNumber(s, idOf(s, 2), 'ZZZ')).toMatchObject({ ok: false, code: 'NOT_ON_YOUR_BOARD' });
    expect(guessNumber(s, idOf(s, 2), target, s.turnId - 1)).toMatchObject({
      ok: false,
      code: 'STALE_ACTION'
    });
  });

  it('cannot be guessed twice — the second attempt hits the wrong phase', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    expect(guessNumber(s, idOf(s, 2), target).ok).toBe(true);
    expect(guessNumber(s, idOf(s, 2), target)).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
  });
});

/* ═════════════════════════ box filling & winning ═════════════════════ */

describe('box filling', () => {
  it('fills one box per tap and tracks progress', () => {
    const s = playingGame(1);
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    expect(fillBox(s, idOf(s, 1), 0).ok).toBe(true);
    expect(fillBox(s, idOf(s, 1), 1).ok).toBe(true);
    expect(progressOf(seatOf(s, 1))).toBe(2);
  });

  it('rejects filling the same box twice', () => {
    const s = playingGame(1);
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    expect(fillBox(s, idOf(s, 1), 4).ok).toBe(true);
    expect(fillBox(s, idOf(s, 1), 4)).toMatchObject({ ok: false, code: 'BOX_ALREADY_FILLED' });
    expect(progressOf(seatOf(s, 1))).toBe(1);
  });

  it('rejects out-of-range boxes — a client cannot invent progress', () => {
    const s = playingGame(1);
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    // one past the last real box, whatever the configured count is
    expect(fillBox(s, idOf(s, 1), s.config.boxCount)).toMatchObject({ ok: false, code: 'INVALID_BOX' });
    expect(fillBox(s, idOf(s, 1), 9999)).toMatchObject({ ok: false, code: 'INVALID_BOX' });
    expect(fillBox(s, idOf(s, 1), -1)).toMatchObject({ ok: false, code: 'INVALID_BOX' });
    expect(fillBox(s, idOf(s, 1), 1.5)).toMatchObject({ ok: false, code: 'INVALID_BOX' });
  });

  it('rejects the seeker filling while they search', () => {
    const s = playingGame(1);
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    expect(fillBox(s, idOf(s, 2), 0)).toMatchObject({ ok: false, code: 'BOXES_LOCKED' });
  });

  it('rejects filling during the selection phase', () => {
    const s = playingGame(1);
    expect(fillBox(s, idOf(s, 1), 0)).toMatchObject({ ok: false, code: 'BOXES_LOCKED' });
    expect(fillBox(s, idOf(s, 2), 0)).toMatchObject({ ok: false, code: 'BOXES_LOCKED' });
  });

  it('LOCKS INSTANTLY: a tap that raced the winning guess is rejected as stale', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    const turnDuringSearch = s.turnId;

    fillBox(s, idOf(s, 1), 0, turnDuringSearch);
    fillBox(s, idOf(s, 1), 1, turnDuringSearch);
    fillBox(s, idOf(s, 1), 2, turnDuringSearch);
    expect(progressOf(seatOf(s, 1))).toBe(3);

    // The guess lands first...
    guessNumber(s, idOf(s, 2), target, turnDuringSearch);

    // ...so the in-flight tap is refused. The phase alone already forbids it,
    // which is why this reports BOXES_LOCKED rather than STALE_ACTION.
    expect(fillBox(s, idOf(s, 1), 3, turnDuringSearch)).toMatchObject({
      ok: false,
      code: 'BOXES_LOCKED'
    });
    expect(fillBox(s, idOf(s, 1), 3)).toMatchObject({ ok: false, code: 'BOXES_LOCKED' });
    expect(progressOf(seatOf(s, 1))).toBe(3); // frozen where it was
  });

  it('the turnId guard alone rejects a tap carried over from an earlier turn', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    const oldTurn = s.turnId;

    // Round ends; seat 2 becomes selector and picks, so filling is legal again
    // for seat 2 — but only under the CURRENT turnId.
    guessNumber(s, idOf(s, 2), target);
    selectNumber(s, idOf(s, 2), seatOf(s, 2).board.find((n) => n !== target)!);
    expect(canFillBoxes(s, 2)).toBe(true);

    expect(fillBox(s, idOf(s, 2), 0, oldTurn)).toMatchObject({ ok: false, code: 'STALE_ACTION' });
    expect(fillBox(s, idOf(s, 2), 0, s.turnId)).toMatchObject({ ok: true });
  });
});

describe('winning', () => {
  it('declares a winner when the last box is filled, and then rejects everything', () => {
    const s = playingGame(1, { boxCount: 3 });
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);

    fillBox(s, idOf(s, 1), 0);
    fillBox(s, idOf(s, 1), 1);
    const last = fillBox(s, idOf(s, 1), 2);

    expect(last.ok).toBe(true);
    expect(s.status).toBe('FINISHED');
    expect(s.winnerUserId).toBe(idOf(s, 1));
    expect(s.finishedAt).toBeTypeOf('number');

    expect(fillBox(s, idOf(s, 1), 0)).toMatchObject({ ok: false, code: 'GAME_OVER' });
    expect(guessNumber(s, idOf(s, 2), target)).toMatchObject({ ok: false, code: 'GAME_OVER' });
    expect(selectNumber(s, idOf(s, 2), seatOf(s, 2).board[1]!)).toMatchObject({
      ok: false,
      code: 'GAME_OVER'
    });
  });

  it('is won on boxes, not on numbers found', () => {
    const s = playingGame(1, { boxCount: 2 });
    // Seat 2 finds several numbers but fills nothing.
    for (let i = 0; i < 3; i++) {
      const n = seatOf(s, s.selectorSeat).board.find((x) => !s.usedTokens.includes(x))!;
      selectNumber(s, idOf(s, s.selectorSeat), n);
      const seeker = s.selectorSeat === 1 ? 2 : 1;
      guessNumber(s, idOf(s, seeker), n);
    }
    expect(s.winnerUserId).toBeNull();
    expect(s.status).not.toBe('FINISHED');
  });
});

/* ══════════════════════ multi-round & housekeeping ═══════════════════ */

describe('a full alternating race', () => {
  it('keeps swapping roles, and only ever the waiting player fills', () => {
    const s = playingGame(1);
    for (let round = 0; round < 6; round++) {
      const sel = s.selectorSeat;
      const seek: Seat = sel === 1 ? 2 : 1;

      expect(s.status).toBe('SELECTING');
      const n = seatOf(s, sel).board.find((x) => !s.usedTokens.includes(x))!;
      expect(selectNumber(s, idOf(s, sel), n).ok).toBe(true);

      // exactly one player may fill, and it is the one who is NOT searching
      expect(canFillBoxes(s, sel)).toBe(true);
      expect(canFillBoxes(s, seek)).toBe(false);
      expect(fillBox(s, idOf(s, sel), round).ok).toBe(true);
      expect(fillBox(s, idOf(s, seek), round)).toMatchObject({ ok: false, code: 'BOXES_LOCKED' });

      expect(guessNumber(s, idOf(s, seek), n)).toMatchObject({ correct: true });
      expect(s.selectorSeat).toBe(seek); // roles inverted
    }
    expect(s.rounds).toBe(6);
  });

  it('deals fresh boards when the pool is exhausted', () => {
    const s = playingGame(1, { boardSize: 9, boxCount: 20 });
    const firstBoard = [...seatOf(s, 1).board];
    for (let i = 0; i < 9; i++) {
      const sel = s.selectorSeat;
      const seek: Seat = sel === 1 ? 2 : 1;
      const n = seatOf(s, sel).board.find((x) => !s.usedTokens.includes(x))!;
      selectNumber(s, idOf(s, sel), n);
      guessNumber(s, idOf(s, seek), n);
    }
    expect(s.usedTokens).toHaveLength(0); // pool reset
    expect(seatOf(s, 1).board).not.toEqual(firstBoard);
    expect(s.status).toBe('SELECTING'); // race continues uninterrupted
  });
});

describe('connection and rematch', () => {
  it('tracks disconnect and reconnect without losing progress', () => {
    const s = playingGame(1);
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    fillBox(s, idOf(s, 1), 0);

    expect(setConnected(s, idOf(s, 2), false).ok).toBe(true);
    expect(seatOf(s, 2).connected).toBe(false);
    expect(s.target).not.toBeNull(); // game state preserved
    expect(progressOf(seatOf(s, 1))).toBe(1);

    expect(setConnected(s, idOf(s, 2), true).ok).toBe(true);
    expect(seatOf(s, 2).connected).toBe(true);
    expect(canGuess(s, 2)).toBe(true); // can carry straight on
  });

  it('needs both players to agree before a rematch resets everything', () => {
    const s = playingGame(1, { boxCount: 1 });
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    fillBox(s, idOf(s, 1), 0);
    expect(s.status).toBe('FINISHED');

    expect(requestRematch(s, idOf(s, 1)).ok).toBe(true);
    expect(bothWantRematch(s)).toBe(false);
    expect(startRematch(s)).toMatchObject({ ok: false, code: 'NOT_READY' });

    expect(requestRematch(s, idOf(s, 2)).ok).toBe(true);
    expect(startRematch(s).ok).toBe(true);
    expect(s.status).toBe('COUNTDOWN');
    expect(s.winnerUserId).toBeNull();
    expect(progressOf(seatOf(s, 1))).toBe(0);
    expect(s.usedTokens).toHaveLength(0);
  });
});

describe('the hunter is never shown the answer', () => {
  it('withholds the live target from the hunter’s used-number list', () => {
    const s = playingGame(1);
    // burn one number so the used list is not trivially empty
    const first = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), first);
    guessNumber(s, idOf(s, 2), first);

    // seat 2 now selects; seat 1 hunts
    const target = seatOf(s, 2).board.find((n) => n !== first)!;
    selectNumber(s, idOf(s, 2), target);

    const hunter = snapshotFor(s, idOf(s, 1));
    const selector = snapshotFor(s, idOf(s, 2));

    // The target IS used server-side — that is what stops it being re-selected.
    expect(s.usedTokens).toContain(target);
    // But the hunter must not receive it, or their board would mark the answer.
    expect(hunter.usedTokens).not.toContain(target);
    expect(hunter.usedTokens).toContain(first); // older history still shown
    expect(hunter.me!.completedTokens).not.toContain(target);

    // The selector already knows the number, so nothing is hidden from them.
    expect(selector.usedTokens).toContain(target);
  });

  it('restores the full used list the moment the hunt ends', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    expect(snapshotFor(s, idOf(s, 2)).usedTokens).not.toContain(target);

    guessNumber(s, idOf(s, 2), target);
    // Round over: seat 2 is the selector now and needs the complete list.
    expect(snapshotFor(s, idOf(s, 2)).usedTokens).toContain(target);
  });
});

describe('default configuration', () => {
  it('gives each player 100 boxes', () => {
    const s = createGame('ABC12', HOST);
    expect(DEFAULT_CONFIG.boxCount).toBe(100);
    expect(s.players[0]!.filledBoxes).toHaveLength(100);
    expect(snapshotFor(s, HOST.userId).totalBoxes).toBe(100);
  });

  it('still needs every one of them filled to win', () => {
    const s = playingGame(1);
    selectNumber(s, idOf(s, 1), seatOf(s, 1).board[0]!);
    for (let i = 0; i < 99; i++) fillBox(s, idOf(s, 1), i);
    expect(s.status).toBe('GUESSING'); // 99/100 is not a win
    expect(s.winnerUserId).toBeNull();
    fillBox(s, idOf(s, 1), 99);
    expect(s.status).toBe('FINISHED');
    expect(s.winnerUserId).toBe(idOf(s, 1));
  });
});

describe('board content types', () => {
  const sample = (type: 'DIGITS' | 'LETTERS' | 'SYMBOLS' | 'MIXED', size = 20) => {
    const s = createGame('ABC12', HOST, { contentType: type, boardSize: size });
    joinGame(s, GUEST);
    return s;
  };

  it('deals letter tiles when asked for letters', () => {
    const s = sample('LETTERS');
    expect(s.players[0]!.board.every((t) => /^[A-Z]$/.test(t))).toBe(true);
    expect(new Set(s.players[0]!.board).size).toBe(20);
  });

  it('deals symbol tiles when asked for symbols', () => {
    const s = sample('SYMBOLS');
    expect(s.players[0]!.board.every((t) => /^[0-9A-Za-z]$/.test(t))).toBe(false);
    expect(new Set(s.players[0]!.board).size).toBe(20);
  });

  it('mixes letters and digits when asked for mixed', () => {
    const s = sample('MIXED', 40);
    const board = s.players[0]!.board;
    expect(board.some((t) => /^[A-Z]$/.test(t))).toBe(true);
    expect(board.some((t) => /^[0-9]+$/.test(t))).toBe(true);
  });

  it('keeps both boards on the same token set whatever the type', () => {
    for (const type of ['DIGITS', 'LETTERS', 'SYMBOLS', 'MIXED'] as const) {
      const s = sample(type);
      const [a, b] = [s.players[0]!.board, s.players[1]!.board];
      expect([...a].sort()).toEqual([...b].sort());
      expect(a).not.toEqual(b);
    }
  });

  it('never asks an alphabet for more tiles than it has', () => {
    // 26 letters cannot fill a 40-tile board — the board is clamped, not broken.
    const s = createGame('ABC12', HOST, { contentType: 'LETTERS', boardSize: 40 });
    expect(s.config.boardSize).toBe(26);
    expect(s.players[0]!.board).toHaveLength(26);
    expect(new Set(s.players[0]!.board).size).toBe(26);
  });

  it('plays a full round on letters exactly like digits', () => {
    const s = createGame('TEST1', HOST, { contentType: 'LETTERS' });
    joinGame(s, GUEST);
    setReady(s, HOST.userId, true);
    setReady(s, GUEST.userId, true);
    beginCountdown(s, HOST.userId);
    beginPlay(s);
    s.selectorSeat = 1;

    const target = seatOf(s, 1).board[0]!;
    expect(selectNumber(s, idOf(s, 1), target).ok).toBe(true);
    expect(s.target).toBe(target);
    expect(canFillBoxes(s, 1)).toBe(true);

    const wrong = seatOf(s, 2).board.find((t) => t !== target)!;
    expect(guessNumber(s, idOf(s, 2), wrong)).toMatchObject({ correct: false });
    expect(guessNumber(s, idOf(s, 2), target)).toMatchObject({ correct: true });
    expect(s.selectorSeat).toBe(2);
    expect(canFillBoxes(s, 1)).toBe(false);
  });
});

describe('match statistics', () => {
  it('counts finds, wrong guesses and the best streak', () => {
    const s = playingGame(1, { boxCount: 100 });

    // three correct finds in a row for whoever is hunting each round
    for (let i = 0; i < 3; i++) {
      const sel = s.selectorSeat;
      const seek: Seat = sel === 1 ? 2 : 1;
      const n = seatOf(s, sel).board.find((x) => !s.usedTokens.includes(x))!;
      selectNumber(s, idOf(s, sel), n);
      guessNumber(s, idOf(s, seek), n);
    }

    const finds = seatOf(s, 1).totalFound + seatOf(s, 2).totalFound;
    expect(finds).toBe(3);
    expect(Math.max(seatOf(s, 1).bestStreak, seatOf(s, 2).bestStreak)).toBeGreaterThanOrEqual(1);

    // a wrong guess breaks the current streak but not the recorded best
    const sel = s.selectorSeat;
    const seek: Seat = sel === 1 ? 2 : 1;
    const n = seatOf(s, sel).board.find((x) => !s.usedTokens.includes(x))!;
    selectNumber(s, idOf(s, sel), n);
    const before = seatOf(s, seek).bestStreak;
    const wrong = seatOf(s, seek).board.find((x) => x !== n)!;
    guessNumber(s, idOf(s, seek), wrong);

    expect(seatOf(s, seek).streak).toBe(0);
    expect(seatOf(s, seek).bestStreak).toBe(before);
    expect(seatOf(s, seek).wrongGuesses).toBe(1);
  });

  it('reports stats for both players in the snapshot', () => {
    const s = playingGame(1);
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    guessNumber(s, idOf(s, 2), target);

    const view = snapshotFor(s, idOf(s, 2));
    expect(view.me!.stats.totalFound).toBe(1);
    expect(view.me!.stats.bestStreak).toBe(1);
    expect(view.opponent!.stats.totalFound).toBe(0);
  });

  it('clears every stat on a rematch', () => {
    const s = playingGame(1, { boxCount: 1 });
    const target = seatOf(s, 1).board[0]!;
    selectNumber(s, idOf(s, 1), target);
    const wrong = seatOf(s, 2).board.find((x) => x !== target)!;
    guessNumber(s, idOf(s, 2), wrong);
    guessNumber(s, idOf(s, 2), target);
    selectNumber(s, idOf(s, 2), seatOf(s, 2).board.find((x) => x !== target)!);
    fillBox(s, idOf(s, 2), 0);
    expect(s.status).toBe('FINISHED');

    requestRematch(s, idOf(s, 1));
    requestRematch(s, idOf(s, 2));
    startRematch(s);

    for (const seat of [1, 2] as const) {
      expect(seatOf(s, seat).wrongGuesses).toBe(0);
      expect(seatOf(s, seat).totalFound).toBe(0);
      expect(seatOf(s, seat).bestStreak).toBe(0);
      expect(seatOf(s, seat).boxesLost).toBe(0);
      expect(progressOf(seatOf(s, seat))).toBe(0);
    }
  });
});

describe('actions from strangers', () => {
  it('rejects everything from a user who is not in the game', () => {
    const s = playingGame(1);
    expect(selectNumber(s, 'nobody', '1')).toMatchObject({ ok: false, code: 'NOT_IN_GAME' });
    expect(guessNumber(s, 'nobody', '1')).toMatchObject({ ok: false, code: 'NOT_IN_GAME' });
    expect(fillBox(s, 'nobody', 0)).toMatchObject({ ok: false, code: 'NOT_IN_GAME' });
    expect(playerOf(s, 'nobody')).toBeUndefined();
  });
});

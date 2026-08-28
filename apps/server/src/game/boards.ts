import { randomInt } from 'node:crypto';
import { alphabetFor, type ContentType } from './content.js';

/** Fisher-Yates, cryptographically seeded so boards aren't predictable. */
export function shuffle<T>(input: readonly T[]): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const ai = a[i] as T;
    a[i] = a[j] as T;
    a[j] = ai;
  }
  return a;
}

/**
 * The shared token pool: `size` unique tokens drawn from the chosen alphabet.
 * Both players get THIS SAME set, so a target chosen by one is guaranteed to
 * exist somewhere on the opponent's board.
 */
export function makePool(size: number, type: ContentType): string[] {
  const alphabet = alphabetFor(type);
  if (size > alphabet.length) {
    throw new Error(`cannot draw ${size} unique tokens from ${type} (${alphabet.length} available)`);
  }
  return shuffle(alphabet).slice(0, size);
}

/** Two independent arrangements of the same pool — that's what makes the hunt hard. */
export function makeBoards(pool: readonly string[]): [string[], string[]] {
  return [shuffle(pool), shuffle(pool)];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

export function makeRoomCode(length = 5): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * What the boards are made of.
 *
 * A board tile is a TOKEN — an opaque string. Digits are just the token set
 * whose members happen to look like numbers, which is why nothing downstream
 * does arithmetic on them.
 */

export type ContentType = 'DIGITS' | 'LETTERS' | 'SYMBOLS' | 'MIXED';

export const CONTENT_TYPES: ContentType[] = ['DIGITS', 'LETTERS', 'SYMBOLS', 'MIXED'];

export const isContentType = (v: unknown): v is ContentType =>
  typeof v === 'string' && (CONTENT_TYPES as string[]).includes(v);

const DIGITS: string[] = Array.from({ length: 99 }, (_, i) => String(i + 1));

const LETTERS: string[] = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

/**
 * Symbols chosen to be (a) visually distinct at a glance, so hunting stays a
 * search rather than a squint, and (b) present in the standard system font
 * stacks on Windows, macOS, Android and iOS. No emoji: their rendering differs
 * enough between platforms that two players could see different shapes.
 */
const SYMBOLS: string[] = [
  '★', '☆', '●', '◆', '■', '▲', '▼', '♠', '♥', '♦',
  '♣', '♪', '♫', '☀', '☁', '☂', '☯', '✚', '✦', '✈',
  '✉', '✂', '✓', '❄', '❤', '➤', '⌘', '⌛', '⚑', '⚙',
  '⚡', '☘', '☺', '◐', '◑', '⬟'
];

/** Letters and digits together — hardest to scan, because shapes and glyphs mix. */
const MIXED: string[] = [...LETTERS, ...DIGITS.slice(0, 30)];

const ALPHABETS: Record<ContentType, string[]> = {
  DIGITS,
  LETTERS,
  SYMBOLS,
  MIXED
};

export const alphabetFor = (type: ContentType): string[] => ALPHABETS[type];

export const alphabetSize = (type: ContentType): number => ALPHABETS[type].length;

/** The largest board this token set can fill without repeating a tile. */
export const maxBoardSize = (type: ContentType): number => ALPHABETS[type].length;

export const CONTENT_LABELS: Record<ContentType, { name: string; hint: string; sample: string }> = {
  DIGITS: { name: 'Numbers', hint: '1 – 99', sample: '7 42 91' },
  LETTERS: { name: 'Letters', hint: 'A – Z', sample: 'A K Z' },
  SYMBOLS: { name: 'Symbols', hint: 'Shapes and marks', sample: '★ ♦ ⚙' },
  MIXED: { name: 'Mixed', hint: 'Letters and numbers — hardest', sample: 'B 7 Q' }
};

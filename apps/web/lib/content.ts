import type { ContentType } from './types';

/** Presentation for each token set. The server owns the alphabets themselves. */
export const CONTENT_OPTIONS: {
  value: ContentType;
  name: string;
  hint: string;
  sample: string[];
  maxTiles: number;
}[] = [
  { value: 'DIGITS', name: 'Numbers', hint: '1 – 99', sample: ['7', '42', '91'], maxTiles: 99 },
  { value: 'LETTERS', name: 'Letters', hint: 'A – Z', sample: ['A', 'K', 'Z'], maxTiles: 26 },
  { value: 'SYMBOLS', name: 'Symbols', hint: 'Shapes & marks', sample: ['★', '♦', '⚙'], maxTiles: 36 },
  { value: 'MIXED', name: 'Mixed', hint: 'Letters + numbers', sample: ['B', '7', 'Q'], maxTiles: 56 }
];

export const contentInfo = (type: ContentType) =>
  CONTENT_OPTIONS.find((o) => o.value === type) ?? CONTENT_OPTIONS[0]!;

/**
 * Tile text sizing. A symbol needs more room than 'K', and '42' needs less than
 * either, so the board would look ragged with one fixed size.
 */
export function tileScale(type: ContentType): string {
  switch (type) {
    case 'SYMBOLS':
      return 'clamp(22px, 6.5vw, 32px)';
    case 'LETTERS':
      return 'clamp(20px, 5.5vw, 30px)';
    default:
      return 'clamp(18px, 5vw, 26px)';
  }
}

/** The big target readout: a single glyph can afford to be much larger. */
export function targetScale(token: string | null, type: ContentType): string {
  if (!token) return 'clamp(56px, 17vw, 92px)';
  if (type === 'SYMBOLS') return 'clamp(64px, 19vw, 104px)';
  return token.length > 2 ? 'clamp(44px, 13vw, 74px)' : 'clamp(56px, 17vw, 92px)';
}

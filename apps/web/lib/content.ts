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
 *
 * Sized to fill the tile face the way a moulded letter tile does — a glyph
 * floating in the middle of a large blank cap reads as a placeholder.
 */
export function tileScale(type: ContentType): string {
  switch (type) {
    case 'SYMBOLS':
      return 'clamp(26px, 7.5vw, 40px)';
    case 'LETTERS':
      return 'clamp(26px, 7vw, 38px)';
    default:
      return 'clamp(22px, 6vw, 34px)';
  }
}

/** The big target readout: a single glyph can afford to be much larger. */
export function targetScale(token: string | null, type: ContentType): string {
  if (!token) return 'clamp(56px, 17vw, 92px)';
  if (type === 'SYMBOLS') return 'clamp(64px, 19vw, 104px)';
  return token.length > 2 ? 'clamp(44px, 13vw, 74px)' : 'clamp(56px, 17vw, 92px)';
}

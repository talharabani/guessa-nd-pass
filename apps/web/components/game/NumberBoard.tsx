'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '@/components/ui';
import { useGame } from '@/components/GameProvider';
import { contentInfo, tileScale } from '@/lib/content';
import { sfx } from '@/lib/sfx';
import type { GameView, Token } from '@/lib/types';
import styles from './game.module.css';

/**
 * One board, two jobs — and the UI must never let you confuse them:
 *   • SELECT mode (violet): pick a tile to send to your opponent.
 *   • HUNT mode (cyan): find the tile they sent you.
 *
 * While hunting, every tile looks identical: the live target is a spent token,
 * so any history styling would point straight at the answer. The one exception
 * is your own wrong guesses — see `wrong` below.
 */

type TileState = 'plain' | 'used' | 'found' | 'hit';

const Tile = memo(function Tile({
  token,
  index,
  size,
  disabled,
  state,
  crossed,
  flash,
  onPick
}: {
  token: Token;
  index: number;
  size: string;
  disabled: boolean;
  state: TileState;
  /** Guessed this turn and wrong — carries the ✕. */
  crossed: boolean;
  /** The 400ms flinch on the tile you just got wrong. */
  flash: boolean;
  onPick: (token: Token) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(token)}
      aria-label={crossed ? `Tile ${token}, already guessed — wrong` : `Tile ${token}`}
      style={{ fontSize: size, ['--i' as string]: index }}
      className={[
        styles.tile,
        state === 'found' ? styles.tileFound : '',
        state === 'used' ? styles.tileUsed : '',
        state === 'hit' ? styles.tileHit : '',
        crossed ? styles.tileWrong : '',
        flash ? styles.tileMiss : '',
        disabled && state === 'plain' && !crossed ? styles.tileIdle : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.tileSheen} aria-hidden="true" />
      <span className={styles.tileFace}>{token}</span>
    </button>
  );
});

export function NumberBoard({ view }: { view: GameView }) {
  const { selectToken, guessToken, pulse } = useGame();
  const [missed, setMissed] = useState<Token | null>(null);
  const [hit, setHit] = useState<Token | null>(null);

  /*
   * Tiles you have already guessed wrong against the CURRENT target.
   *
   * A wrong guess does not end your turn — the target stays live and you keep
   * hunting — so without a mark there is nothing stopping you burning taps on
   * the same tile twice while your opponent fills boxes. Crossing them off
   * leaks nothing: a crossed tile is one the server has already told you is
   * not the answer.
   *
   * Keyed by turnId so the marks clear the instant a new target goes up.
   */
  const [wrong, setWrong] = useState<Token[]>([]);
  const wrongTurn = useRef(view.turnId);

  const mode: 'select' | 'hunt' | 'idle' = view.canSelect ? 'select' : view.canGuess ? 'hunt' : 'idle';
  const used = new Set(view.usedTokens);
  const found = new Set(view.me?.completedTokens ?? []);
  const size = tileScale(view.contentType);

  if (wrongTurn.current !== view.turnId) {
    // Render-phase reset: waiting for an effect would paint one frame of the
    // previous turn's crosses over the new target.
    wrongTurn.current = view.turnId;
    if (wrong.length) setWrong([]);
  }

  // Wrong taps shake; correct taps flare. Both are driven by server events.
  useEffect(() => {
    if (!pulse) return;
    if (pulse.kind === 'wrong' && pulse.value !== undefined) {
      const value = pulse.value;
      setWrong((prev) => (prev.includes(value) ? prev : [...prev, value]));
      setMissed(value);
      const t = setTimeout(() => setMissed(null), 420);
      return () => clearTimeout(t);
    }
    if (pulse.kind === 'correct' && pulse.value !== undefined) {
      setHit(pulse.value);
      const t = setTimeout(() => setHit(null), 560);
      return () => clearTimeout(t);
    }
    return;
  }, [pulse]);

  /*
   * Entrance stagger, armed only while the board is actually new.
   *
   * If the deal animation lived on .tile permanently it would replay every time
   * a tile's class changed — so each wrong guess would re-deal the board once
   * the shake class came off.
   */
  const boardKey = (view.me?.board ?? []).join('|');
  const [dealing, setDealing] = useState(true);
  useEffect(() => {
    setDealing(true);
    const t = setTimeout(() => setDealing(false), 900);
    return () => clearTimeout(t);
  }, [boardKey]);

  const onPick = useCallback(
    (token: Token) => {
      if (view.canSelect) {
        sfx.tap();
        void selectToken(token);
      } else if (view.canGuess) {
        void guessToken(token);
      }
    },
    [view.canSelect, view.canGuess, selectToken, guessToken]
  );

  const kind = contentInfo(view.contentType).name.toLowerCase().replace(/s$/, '');
  const title =
    mode === 'select'
      ? `Select a ${kind} for your opponent`
      : mode === 'hunt'
        ? 'Find this on your board'
        : 'Your board';

  return (
    <div className={styles.boardWrap} data-mode={mode}>
      <Panel>
        <div className={styles.boardHead}>
          <span className={styles.boardTitle}>{title}</span>
          {mode === 'hunt' && view.target !== null ? (
            <span className={styles.findChip}>
              <span className={styles.findChipLabel}>FIND</span>
              {view.target}
            </span>
          ) : null}
        </div>

        <div className={styles.board} data-deal={dealing}>
          {(view.me?.board ?? []).map((token, index) => {
            // History is a SELECTION aid only — never shown while hunting.
            const showHistory = mode !== 'hunt';
            const isUsed = showHistory && used.has(token);
            const isFound = showHistory && found.has(token);
            const crossed = wrong.includes(token);

            const state: TileState =
              hit === token ? 'hit' : isFound ? 'found' : isUsed ? 'used' : 'plain';

            return (
              <Tile
                key={token}
                token={token}
                index={index}
                size={size}
                state={state}
                crossed={crossed}
                flash={missed === token}
                disabled={mode === 'idle' || (mode === 'select' && isUsed) || crossed}
                onPick={onPick}
              />
            );
          })}
        </div>

        {/* Says what the marks mean the first time one appears. */}
        {mode === 'hunt' && wrong.length > 0 ? (
          <p className={styles.boardNote}>
            <span className={styles.noteCross} aria-hidden="true" />
            {wrong.length === 1 ? '1 tile ruled out' : `${wrong.length} tiles ruled out`} — keep
            hunting.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

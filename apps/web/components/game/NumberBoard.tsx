'use client';

import { memo, useCallback, useEffect, useState } from 'react';
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
 * so any history styling would point straight at the answer.
 */

const Tile = memo(function Tile({
  token,
  size,
  disabled,
  state,
  onPick
}: {
  token: Token;
  size: string;
  disabled: boolean;
  state: 'plain' | 'used' | 'found' | 'miss' | 'hit';
  onPick: (token: Token) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(token)}
      aria-label={`Tile ${token}`}
      style={{ fontSize: size }}
      className={[
        styles.tile,
        state === 'found' ? styles.tileFound : '',
        state === 'used' ? styles.tileUsed : '',
        state === 'miss' ? styles.tileMiss : '',
        state === 'hit' ? styles.tileHit : '',
        disabled && state === 'plain' ? styles.tileIdle : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {token}
    </button>
  );
});

export function NumberBoard({ view }: { view: GameView }) {
  const { selectToken, guessToken, pulse } = useGame();
  const [missed, setMissed] = useState<Token | null>(null);
  const [hit, setHit] = useState<Token | null>(null);

  const mode: 'select' | 'hunt' | 'idle' = view.canSelect ? 'select' : view.canGuess ? 'hunt' : 'idle';
  const used = new Set(view.usedTokens);
  const found = new Set(view.me?.completedTokens ?? []);
  const size = tileScale(view.contentType);

  // Wrong taps shake; correct taps flare. Both are driven by server events.
  useEffect(() => {
    if (!pulse) return;
    if (pulse.kind === 'wrong' && pulse.value !== undefined) {
      setMissed(pulse.value);
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

        <div className={styles.board}>
          {(view.me?.board ?? []).map((token) => {
            // History is a SELECTION aid only — never shown while hunting.
            const showHistory = mode !== 'hunt';
            const isUsed = showHistory && used.has(token);
            const isFound = showHistory && found.has(token);

            const state =
              missed === token
                ? 'miss'
                : hit === token
                  ? 'hit'
                  : isFound
                    ? 'found'
                    : isUsed
                      ? 'used'
                      : 'plain';

            return (
              <Tile
                key={token}
                token={token}
                size={size}
                state={state}
                disabled={mode === 'idle' || (mode === 'select' && isUsed)}
                onPick={onPick}
              />
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

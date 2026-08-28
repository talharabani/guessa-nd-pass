'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '@/components/ui';
import { useGame } from '@/components/GameProvider';
import { sfx } from '@/lib/sfx';
import type { GameView } from '@/lib/types';
import styles from './game.module.css';

/**
 * Your progress, and the only way to win.
 *
 * Unlocked ONLY while your opponent is hunting the tile you chose. The lock
 * closes the instant they find it. Guess wrong on your own turn and every box
 * here is wiped — which is why the wipe gets a deliberate, unmissable animation.
 */

/**
 * One box, memoised. At 100 boxes and a snapshot on every single tap, an
 * un-memoised grid re-renders 100 nodes per fill; this way only the box that
 * actually changed does any work.
 */
const Box = memo(function Box({
  index,
  filled,
  open,
  popped,
  wiping,
  onFill
}: {
  index: number;
  filled: boolean;
  open: boolean;
  popped: boolean;
  wiping: boolean;
  onFill: (index: number) => void;
}) {
  return (
    <button
      type="button"
      disabled={!open || filled}
      onClick={() => onFill(index)}
      aria-label={filled ? `Box ${index + 1}, filled` : `Fill box ${index + 1}`}
      style={wiping ? { animationDelay: `${Math.min(index, 40) * 6}ms` } : undefined}
      className={[
        styles.box,
        filled ? styles.boxFilled : '',
        open && !filled ? styles.boxOpen : '',
        popped ? styles.boxPop : '',
        wiping ? styles.boxWipe : ''
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
});

export function BoxBoard({ view }: { view: GameView }) {
  const { fillBox, pulse } = useGame();
  const [popped, setPopped] = useState<Set<number>>(new Set());
  const [wiping, setWiping] = useState(false);
  const previousFilled = useRef<boolean[]>([]);

  const filled = view.me?.filledBoxes ?? [];
  const open = view.canFillBoxes;
  const progress = view.me?.progress ?? 0;

  // Pop each box that has just landed.
  useEffect(() => {
    const before = previousFilled.current;
    const justFilled = filled.flatMap((f, i) => (f && !before[i] ? [i] : []));
    previousFilled.current = filled;
    if (justFilled.length === 0) return;
    setPopped(new Set(justFilled));
    const t = setTimeout(() => setPopped(new Set()), 240);
    return () => clearTimeout(t);
  }, [filled]);

  // The wipe: my own wrong guess just cost me everything I had banked.
  useEffect(() => {
    if (pulse?.kind !== 'wrong' || !pulse.boxesLost) return;
    setWiping(true);
    const t = setTimeout(() => setWiping(false), 620);
    return () => clearTimeout(t);
  }, [pulse]);

  const onFill = useCallback(
    (index: number) => {
      if (!open || filled[index]) return;
      sfx.fill();
      void fillBox(index);
    },
    [open, filled, fillBox]
  );

  const pct = view.totalBoxes > 0 ? (progress / view.totalBoxes) * 100 : 0;

  return (
    <Panel>
      <div className={styles.boxHead}>
        <span className={styles.boxTitle}>Your boxes</span>
        <span className={`${styles.lock} ${open ? styles.lockOpen : styles.lockShut}`}>
          {open ? '🔓 Fill now' : '🔒 Locked'}
        </span>
      </div>

      {/* A big readout, because at 100 boxes you cannot count the grid. */}
      <div className={styles.boxMeter}>
        <div className={styles.boxCount} data-wipe={wiping}>
          {progress}
          <span className={styles.boxCountTotal}>/{view.totalBoxes}</span>
        </div>
        <div className={styles.meterTrack}>
          <div className={styles.meterFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={`${styles.boxes} ${wiping ? styles.boxesWiping : ''}`}>
        {filled.map((isFilled, i) => (
          <Box
            key={i}
            index={i}
            filled={isFilled}
            open={open}
            popped={popped.has(i)}
            wiping={wiping}
            onFill={onFill}
          />
        ))}
      </div>

      <p className={styles.boxNote}>
        {open
          ? 'Tap fast — this stops the moment they find your tile.'
          : view.status === 'GUESSING'
            ? '🔒 Find their tile first. A wrong tap wipes your boxes.'
            : '🔒 You fill while your opponent is searching.'}
      </p>
    </Panel>
  );
}

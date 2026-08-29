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
 * closes the instant they find it. Guess wrong on your own turn and the last
 * few boxes you banked are taken back — the ones that go get the animation, so
 * you can see the size of the loss rather than being told a number.
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
      /*
       * Fill on POINTER DOWN, not click.
       *
       * A click only fires when the press and release land on the same element,
       * so a finger that moves a couple of pixels while tapping is discarded —
       * and this is a control you are meant to hammer. Pointerdown also lands
       * one event earlier, which is the difference between the grid feeling
       * instant and feeling soft.
       */
      onPointerDown={() => onFill(index)}
      aria-label={filled ? `Box ${index + 1}, filled` : `Fill box ${index + 1}`}
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
  const { fillBox } = useGame();
  const [popped, setPopped] = useState<Set<number>>(new Set());
  const [cleared, setCleared] = useState<Set<number>>(new Set());
  const previousFilled = useRef<boolean[]>([]);

  /*
   * Boxes tapped here but not yet confirmed by the server.
   *
   * Waiting for the round trip before painting makes every tap cost a whole
   * journey to Oregon and back, which on a hosted server is well over a tenth
   * of a second — on a control whose entire point is speed. So the box fills
   * immediately and the server confirms after. It is safe to be optimistic
   * because the server still decides: a rejected fill is rolled back below, and
   * the snapshot always wins over anything held here.
   */
  const [pending, setPending] = useState<Set<number>>(new Set());

  const filled = view.me?.filledBoxes ?? [];
  const open = view.canFillBoxes;
  const serverProgress = view.me?.progress ?? 0;
  const penalty = view.wrongGuessPenalty;

  const drop = useCallback((index: number) => {
    setPending((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, []);

  // Pop what has just landed, flash what has just been taken back.
  useEffect(() => {
    const before = previousFilled.current;
    const justFilled: number[] = [];
    const justCleared: number[] = [];
    for (let i = 0; i < filled.length; i++) {
      if (filled[i] && !before[i]) justFilled.push(i);
      if (!filled[i] && before[i]) justCleared.push(i);
    }
    previousFilled.current = filled;

    if (justFilled.length > 0) {
      // Confirmed by the server — stop tracking them locally.
      setPending((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const i of justFilled) next.delete(i);
        return next.size === prev.size ? prev : next;
      });
      setPopped(new Set(justFilled));
    }

    if (justCleared.length > 0) {
      setPending(new Set()); // whatever was in flight is void now
      setCleared(new Set(justCleared));
    }
  }, [filled]);

  // Clear the transient marks on their own timers, so a fill during a wipe
  // does not cut the wipe short.
  useEffect(() => {
    if (popped.size === 0) return;
    const t = setTimeout(() => setPopped(new Set()), 200);
    return () => clearTimeout(t);
  }, [popped]);

  useEffect(() => {
    if (cleared.size === 0) return;
    const t = setTimeout(() => setCleared(new Set()), 620);
    return () => clearTimeout(t);
  }, [cleared]);

  // Losing the lock voids anything still in flight.
  useEffect(() => {
    if (!open) setPending(new Set());
  }, [open]);

  const onFill = useCallback(
    (index: number) => {
      if (!open || filled[index]) return;
      setPending((prev) => {
        if (prev.has(index)) return prev;
        const next = new Set(prev);
        next.add(index);
        return next;
      });
      sfx.fill();
      void fillBox(index).then((ack) => {
        // Rejected — the turn switched, or it was already taken. Put it back.
        if (!ack.ok) drop(index);
      });
    },
    [open, filled, fillBox, drop]
  );

  // Count the optimistic ones too, or the readout lags the grid it sits above.
  let inFlight = 0;
  for (const i of pending) if (!filled[i]) inFlight++;
  const progress = Math.min(view.totalBoxes, serverProgress + inFlight);
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
        <div className={styles.boxCount} data-wipe={cleared.size > 0}>
          {progress}
          <span className={styles.boxCountTotal}>/{view.totalBoxes}</span>
        </div>
        <div className={styles.meterTrack}>
          <div className={styles.meterFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={styles.boxes}>
        {filled.map((isFilled, i) => (
          <Box
            key={i}
            index={i}
            filled={isFilled || pending.has(i)}
            open={open}
            popped={popped.has(i)}
            wiping={cleared.has(i)}
            onFill={onFill}
          />
        ))}
      </div>

      <p className={styles.boxNote}>
        {open
          ? 'Tap fast — this stops the moment they find your tile.'
          : view.status === 'GUESSING'
            ? `🔒 Find their tile first. A wrong tap costs you ${penalty} boxes.`
            : '🔒 You fill while your opponent is searching.'}
      </p>
    </Panel>
  );
}

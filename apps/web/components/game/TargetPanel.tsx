'use client';

import { useEffect, useRef, useState } from 'react';
import { contentInfo, targetScale } from '@/lib/content';
import type { GameView } from '@/lib/types';
import styles from './game.module.css';

/**
 * The one place the target lives. The selector reads "YOUR NUMBER"; the seeker
 * reads "NUMBER TO GUESS" — same value, opposite jobs, deliberately different
 * colour so nobody confuses the two.
 */
export function TargetPanel({ view }: { view: GameView }) {
  const [animate, setAnimate] = useState(false);
  const shown = useRef<string>('');

  const { label, value, sub, mode } = read(view);

  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    setAnimate(false);
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [value]);

  return (
    <div
      className={styles.target}
      data-mode={mode}
      style={{ ['--target-size' as string]: targetScale(view.target, view.contentType) }}
    >
      <div className={styles.targetLabel}>{label}</div>
      <div className={styles.targetNumber} data-animate={animate} key={value}>
        {value}
      </div>
      <div className={styles.targetSub}>{sub}</div>
    </div>
  );
}

function read(view: GameView): {
  label: string;
  value: string;
  sub: string;
  mode: 'hunt' | 'mine' | 'select' | 'idle';
} {
  const foe = view.opponent?.username ?? 'Your opponent';
  const kind = contentInfo(view.contentType).name.toLowerCase().replace(/s$/, '');

  if (view.status === 'FINISHED') {
    return { label: 'Game over', value: '★', sub: '', mode: 'idle' };
  }
  if (view.status === 'WAITING_FOR_PLAYER' || view.status === 'READY' || view.status === 'COUNTDOWN') {
    return { label: 'Get ready', value: '—', sub: 'The race is about to start.', mode: 'idle' };
  }
  if (view.status === 'SELECTING') {
    return view.canSelect
      ? {
          label: `Select a ${kind}`,
          value: '?',
          sub: `Choose one for ${foe} to find.`,
          mode: 'select'
        }
      : {
          label: `${foe} is choosing`,
          value: '···',
          sub: 'Your boxes are locked until they pick.',
          mode: 'idle'
        };
  }
  // GUESSING
  return view.role === 'selector'
    ? {
        label: `Your ${kind}`,
        value: String(view.target ?? '—'),
        sub: `${foe} is searching — fill your boxes!`,
        mode: 'mine'
      }
    : {
        label: 'Find this',
        value: String(view.target ?? '—'),
        sub: 'Find it on your board — fast.',
        mode: 'hunt'
      };
}

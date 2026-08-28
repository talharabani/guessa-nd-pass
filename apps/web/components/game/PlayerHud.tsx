'use client';

import type { GameView } from '@/lib/types';
import styles from './game.module.css';

/**
 * The race, always on screen. You must be able to read both bars without
 * looking away from the board, and know instantly whether you are ahead.
 */

type RoleKind = 'hunting' | 'filling' | 'choosing' | 'waiting' | 'offline';

function describe(view: GameView, who: 'me' | 'opponent'): { text: string; kind: RoleKind } {
  const isMe = who === 'me';
  const connected = isMe ? true : (view.opponent?.connected ?? false);
  if (!connected) return { text: 'Reconnecting', kind: 'offline' };

  const iAmSelector = view.role === 'selector';
  const selector = isMe ? iAmSelector : !iAmSelector;

  if (view.status === 'GUESSING') {
    return selector ? { text: 'Filling', kind: 'filling' } : { text: 'Searching', kind: 'hunting' };
  }
  if (view.status === 'SELECTING') {
    return selector ? { text: 'Choosing', kind: 'choosing' } : { text: 'Standing by', kind: 'waiting' };
  }
  return { text: 'Waiting', kind: 'waiting' };
}

function Side({
  name,
  progress,
  total,
  role,
  active,
  leading,
  mine
}: {
  name: string;
  progress: number;
  total: number;
  role: { text: string; kind: RoleKind };
  active: boolean;
  leading: boolean;
  mine?: boolean;
}) {
  const pct = total > 0 ? Math.min(100, (progress / total) * 100) : 0;
  return (
    <div className={styles.racer} data-active={active} data-mine={mine}>
      <div className={styles.racerTop}>
        <span className={styles.racerName}>
          {leading ? <span className={styles.crown}>♛</span> : null}
          {name}
        </span>
        <span className={styles.racerScore} data-mine={mine}>
          {progress}
          <span className={styles.racerTotal}>/{total}</span>
        </span>
      </div>

      <div className={styles.racerTrack}>
        <div className={styles.racerFill} data-mine={mine} style={{ width: `${pct}%` }} />
      </div>

      <div className={styles.racerRole} data-kind={role.kind}>
        {role.kind === 'hunting' ? '🔍 ' : role.kind === 'filling' ? '⚡ ' : ''}
        {role.text}
      </div>
    </div>
  );
}

export function PlayerHud({ view }: { view: GameView }) {
  const me = view.me;
  const foe = view.opponent;
  const myProgress = me?.progress ?? 0;
  const foeProgress = foe?.progress ?? 0;
  const gap = myProgress - foeProgress;

  return (
    <div className={styles.hud}>
      <Side
        name="You"
        mine
        progress={myProgress}
        total={view.totalBoxes}
        role={describe(view, 'me')}
        active={view.canSelect || view.canGuess}
        leading={!!foe && gap > 0}
      />

      <div className={styles.gap}>
        {foe ? (
          <span className={styles.gapValue} data-lead={gap > 0 ? 'up' : gap < 0 ? 'down' : 'level'}>
            {gap === 0 ? 'LEVEL' : gap > 0 ? `+${gap}` : gap}
          </span>
        ) : (
          <span className={styles.gapValue}>VS</span>
        )}
      </div>

      <Side
        name={foe?.username ?? 'Waiting…'}
        progress={foeProgress}
        total={view.totalBoxes}
        role={describe(view, 'opponent')}
        active={!!foe && view.status !== 'WAITING_FOR_PLAYER' && !(view.canSelect || view.canGuess)}
        leading={!!foe && gap < 0}
      />
    </div>
  );
}

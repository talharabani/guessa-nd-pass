'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useGame } from '@/components/GameProvider';
import { Button, Modal } from '@/components/ui';
import { sfx } from '@/lib/sfx';
import styles from './account.module.css';

/**
 * Who you are signed in as, and the way out.
 *
 * Signing out mid-match abandons the game, so that case asks first. Signing out
 * from the home screen is harmless and happens immediately — a confirmation
 * there would just be a speed bump.
 */
export function AccountBar() {
  const { user } = useAuth();
  const { connected, signOut, inLiveGame } = useGame();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  if (!user) return null;

  async function go() {
    setLeaving(true);
    sfx.tap();
    await signOut();
  }

  return (
    <>
      <div className={styles.bar}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {user.username.charAt(0).toUpperCase()}
          </span>
          <span className={styles.text}>
            <span className={styles.name}>{user.username}</span>
            <span className={styles.status} data-online={connected}>
              <i className={styles.dot} />
              {connected ? 'Online' : 'Connecting…'}
            </span>
          </span>
        </div>

        <button
          type="button"
          className={styles.signOut}
          disabled={leaving}
          onClick={() => {
            sfx.tap();
            if (inLiveGame) setConfirming(true);
            else void go();
          }}
        >
          {leaving ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      <Modal open={confirming}>
        <h2 className={styles.confirmTitle}>Sign out of your match?</h2>
        <p className="muted">
          You are in a live game. Signing out leaves the room and hands your opponent the win.
        </p>
        <div className="stack" style={{ marginTop: 22 }}>
          <Button variant="danger" disabled={leaving} onClick={go}>
            {leaving ? 'Leaving…' : 'Leave and sign out'}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Stay in the game
          </Button>
        </div>
      </Modal>
    </>
  );
}

'use client';

import Link from 'next/link';
import { Button, Panel } from '@/components/ui';
import styles from '../pages.module.css';

/** Teaches the mechanic by showing it, not by describing it abstractly. */
export default function HowToPlayPage() {
  return (
    <main className="shell" style={{ maxWidth: 620, paddingBottom: 40 }}>
      <div className={styles.brand} style={{ marginTop: 24 }}>
        <h1 className={styles.logo} style={{ fontSize: 34 }}>
          How to play
        </h1>
        <p className={styles.tagline}>Two players. One race. Nobody ever waits.</p>
      </div>

      <div className={styles.steps}>
        <div className={styles.step}>
          <span className={styles.stepNum}>1</span>
          <div>
            <div className={styles.stepTitle}>Pick a number for your opponent</div>
            <p className={styles.stepBody}>Tap any number on your board. They never hear you say it.</p>
            <div className={styles.demoRow}>
              <span className={styles.demoTile}>14</span>
              <span className={`${styles.demoTile} ${styles.demoTilePicked}`}>71</span>
              <span className={styles.demoTile}>32</span>
              <span className={styles.demoTile}>08</span>
            </div>
          </div>
        </div>

        <div className={styles.step}>
          <span className={styles.stepNum}>2</span>
          <div>
            <div className={styles.stepTitle}>It appears on their screen instantly</div>
            <p className={styles.stepBody}>
              Sent over the live connection — no refresh, no next-turn button.
            </p>
            <div className={styles.demoTarget}>
              <div className={styles.demoTargetLabel}>Number to guess</div>
              <div className={styles.demoTargetNum}>71</div>
            </div>
          </div>
        </div>

        <div className={styles.step}>
          <span className={styles.stepNum}>3</span>
          <div>
            <div className={styles.stepTitle}>They hunt it on their own board</div>
            <p className={styles.stepBody}>
              The same tiles as yours, shuffled differently. Nothing on the board marks the answer.
            </p>
          </div>
        </div>

        <div className={styles.step}>
          <span className={styles.stepNum}>!</span>
          <div>
            <div className={styles.stepTitle}>A wrong tap costs you ten boxes</div>
            <p className={styles.stepBody}>
              The turn does not switch and the tile stays live — but the last ten boxes you banked
              are taken back. A long run survives a mistake; a short one does not. The tile you
              guessed is crossed off so you never burn it twice.
            </p>
            <div className={styles.demoRow}>
              <span className={`${styles.demoBox} ${styles.demoBoxFilled}`} />
              <span className={`${styles.demoBox} ${styles.demoBoxFilled}`} />
              <span className={`${styles.demoBox} ${styles.demoBoxFilled}`} />
              <span className={styles.stepBody} style={{ alignSelf: 'center' }}>
                &nbsp;→&nbsp;
              </span>
              <span className={`${styles.demoBox} ${styles.demoBoxFilled}`} />
              <span className={styles.demoBox} />
              <span className={styles.demoBox} />
            </div>
          </div>
        </div>

        <div className={styles.step}>
          <span className={styles.stepNum}>4</span>
          <div>
            <div className={styles.stepTitle}>Meanwhile, you fill boxes</div>
            <p className={styles.stepBody}>
              One tap fills one box. This is the only way to make progress, and you can only do it
              while they are searching.
            </p>
            <div className={styles.demoRow}>
              <span className={`${styles.demoBox} ${styles.demoBoxFilled}`} />
              <span className={`${styles.demoBox} ${styles.demoBoxFilled}`} />
              <span className={`${styles.demoBox} ${styles.demoBoxFilled}`} />
              <span className={styles.demoBox} />
              <span className={styles.demoBox} />
            </div>
          </div>
        </div>

        <div className={styles.step}>
          <span className={styles.stepNum}>5</span>
          <div>
            <div className={styles.stepTitle}>The moment they find it, you are locked</div>
            <p className={styles.stepBody}>
              Roles flip instantly. Now they choose a number, you go hunting, and they fill boxes
              while you search. The faster you find numbers, the less time they get.
            </p>
          </div>
        </div>

        <div className={styles.step}>
          <span className={styles.stepNum}>6</span>
          <div>
            <div className={styles.stepTitle}>First to fill every box wins</div>
            <p className={styles.stepBody}>
              Not the fastest finder — the fullest board. Finding fast is how you starve your
              opponent of filling time.
            </p>
          </div>
        </div>
      </div>

      <Panel style={{ marginTop: 20 }}>
        <Link href="/">
          <Button variant="primary">Back to home</Button>
        </Link>
      </Panel>
    </main>
  );
}

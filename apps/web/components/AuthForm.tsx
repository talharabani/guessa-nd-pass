'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Panel } from '@/components/ui';
import { ApiError, lastUsername } from '@/lib/api';
import { sfx } from '@/lib/sfx';
import styles from '@/app/pages.module.css';

/**
 * Sign in and sign up are the same form with different copy, so they share one
 * component and can't drift apart.
 *
 * Validation mirrors the server's rules exactly (auth/service.ts). Checking here
 * is purely so you learn about a bad username before a round trip — the server
 * re-validates everything and remains the authority.
 */

export const USERNAME_RULE = /^[A-Za-z0-9_]+$/;

export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Pick a username.';
  if (v.length < 3) return 'At least 3 characters.';
  if (v.length > 16) return 'At most 16 characters.';
  if (!USERNAME_RULE.test(v)) return 'Letters, numbers and underscore only.';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Enter your password.';
  if (value.length < 6) return 'At least 6 characters.';
  return null;
}

interface Props {
  mode: 'login' | 'register';
  onSubmit: (username: string, password: string) => Promise<void>;
}

export function AuthForm({ mode, onSubmit }: Props) {
  const isRegister = mode === 'register';
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [touched, setTouched] = useState<{ username?: boolean; password?: boolean }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Coming back to sign in? Start with the name you used last time.
  useEffect(() => {
    if (isRegister) return;
    const previous = lastUsername.get();
    if (previous) setUsername(previous);
  }, [isRegister]);

  // Signing in must never lecture you about your existing password's length.
  const usernameError = isRegister ? validateUsername(username) : username.trim() ? null : 'Enter your username.';
  const passwordError = isRegister ? validatePassword(password) : password ? null : 'Enter your password.';

  const showUsernameError = touched.username && usernameError;
  const showPasswordError = touched.password && passwordError;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ username: true, password: true });
    setServerError(null);
    setErrorCode(null);
    if (usernameError || passwordError) return;

    setBusy(true);
    sfx.tap();
    try {
      await onSubmit(username.trim(), password);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
      setErrorCode(err instanceof ApiError ? (err.code ?? null) : null);
      setBusy(false);
    }
    // On success the page navigates away, so `busy` intentionally stays true.
  }

  return (
    <Panel>
      <form onSubmit={submit} className="stack" noValidate>
        {serverError ? (
          <div className={styles.error} role="alert">
            <p className={styles.errorText}>{serverError}</p>

            {/* Don't leave people bouncing between the two screens: if the name
                already exists, hand them straight to sign-in carrying it over. */}
            {errorCode === 'USERNAME_TAKEN' ? (
              <button
                type="button"
                className={styles.errorAction}
                onClick={() => {
                  lastUsername.set(username.trim());
                  router.push('/login');
                }}
              >
                Sign in as {username.trim()} instead →
              </button>
            ) : null}

            {errorCode === 'BAD_CREDENTIALS' ? (
              <p className={styles.errorHint}>
                Passwords are case-sensitive. Usernames are not — capitals do not matter.
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className={styles.fieldLabel} htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className={`${styles.input} ${showUsernameError ? styles.inputBad : ''}`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, username: true }))}
            placeholder={isRegister ? '3–16 characters' : 'Your username'}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
            aria-invalid={Boolean(showUsernameError)}
            aria-describedby="username-help"
          />
          <p id="username-help" className={showUsernameError ? styles.fieldError : styles.fieldHint}>
            {showUsernameError ? usernameError : isRegister ? 'Letters, numbers and underscore.' : ' '}
          </p>
        </div>

        <div>
          <label className={styles.fieldLabel} htmlFor="password">
            Password
          </label>
          <div className={styles.inputWrap}>
            <input
              id="password"
              type={reveal ? 'text' : 'password'}
              className={`${styles.input} ${styles.inputWithButton} ${showPasswordError ? styles.inputBad : ''}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
              placeholder={isRegister ? 'At least 6 characters' : 'Your password'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              aria-invalid={Boolean(showPasswordError)}
              aria-describedby="password-help"
            />
            <button
              type="button"
              className={styles.revealBtn}
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {reveal ? '🙈' : '👁'}
            </button>
          </div>
          <p id="password-help" className={showPasswordError ? styles.fieldError : styles.fieldHint}>
            {showPasswordError
              ? passwordError
              : capsLock
                ? '⚠ Caps Lock is on'
                : isRegister
                  ? 'Six characters or more.'
                  : ' '}
          </p>
        </div>

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? (isRegister ? 'Creating account…' : 'Signing in…') : isRegister ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className={styles.switch}>
        {isRegister ? (
          <>
            Already have an account? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/register">Create an account</Link>
          </>
        )}
      </p>
    </Panel>
  );
}

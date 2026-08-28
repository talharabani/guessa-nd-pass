'use client';

import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './ui.module.css';

/* Small, shared primitives. Everything else composes these. */

export function Panel({
  title,
  children,
  className,
  style
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`} style={style}>
      {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'default' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
};

export function Button({ variant = 'default', size = 'md', className, ...rest }: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? styles.primary
      : variant === 'ghost'
        ? styles.ghost
        : variant === 'danger'
          ? styles.danger
          : '';
  return (
    <button
      type="button"
      {...rest}
      className={`${styles.btn} ${variantClass} ${size === 'sm' ? styles.small : ''} ${className ?? ''}`}
    />
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; code?: boolean };

export function Field({ label, code, className, ...rest }: FieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input {...rest} className={`${styles.input} ${code ? styles.code : ''} ${className ?? ''}`} />
    </label>
  );
}

export function Progress({ value, total, tone }: { value: number; total: number; tone?: 'accent' }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div className={styles.progressFill} data-tone={tone} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Modal({ open, children }: { open: boolean; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>{children}</div>
    </div>
  );
}

/**
 * A loading state that says what is actually happening. Generic spinners make a
 * game feel broken; naming the step makes a two-second wait feel intentional.
 */
export function Loading({ label }: { label: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.loadingDots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className={styles.loadingLabel}>{label}…</span>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div className={styles.toast} role="status">
      {message}
    </div>
  );
}

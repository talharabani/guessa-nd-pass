'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { AuthForm } from '@/components/AuthForm';
import styles from '../pages.module.css';

export default function LoginPage() {
  const router = useRouter();
  const { login, user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  return (
    <main className="center-screen">
      <div className={styles.authCard}>
        <div className={styles.brand}>
          <h1 className={styles.logo}>Number Rush</h1>
          <p className={styles.tagline}>Sign in to race.</p>
        </div>

        <AuthForm
          mode="login"
          onSubmit={async (username, password) => {
            await login(username, password);
            router.replace('/');
          }}
        />
      </div>
    </main>
  );
}

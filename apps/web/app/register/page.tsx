'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { AuthForm } from '@/components/AuthForm';
import styles from '../pages.module.css';

export default function RegisterPage() {
  const router = useRouter();
  const { register, user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  return (
    <main className="center-screen">
      <div className={styles.authCard}>
        <div className={styles.brand}>
          <h1 className={styles.logo}>Number Rush</h1>
          <p className={styles.tagline}>Pick a name your opponent will remember.</p>
        </div>

        <AuthForm
          mode="register"
          onSubmit={async (username, password) => {
            await register(username, password);
            router.replace('/');
          }}
        />
      </div>
    </main>
  );
}

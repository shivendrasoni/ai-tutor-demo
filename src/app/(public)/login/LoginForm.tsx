'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, genericMessage } from '../_lib/api';
import { TextField } from '../_lib/fields';
import styles from '../public.module.css';

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await apiFetch<{ home: string }>('/api/auth/login', { method: 'POST', body: { username, password } });
    if (r.ok) {
      router.replace(r.data.home);
      return;
    }
    setBusy(false);
    setError(
      r.error.code === 'INVALID_CREDENTIALS'
        ? 'Incorrect username or password.'
        : r.error.code === 'ACCOUNT_REMOVED'
          ? 'This account is no longer active. Contact your school.'
          : genericMessage(r.error),
    );
  }

  return (
    <>
      <h1 className={styles.title}>Log in</h1>
      <form className={styles.form} onSubmit={submit}>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" required maxLength={200} />
        <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required maxLength={1000} />
        <button type="submit" className={styles.button} disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p><Link href="/join" className={styles.link}>New student? Sign up with your school code</Link></p>
    </>
  );
}

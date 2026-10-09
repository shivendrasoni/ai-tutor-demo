'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from '../public.module.css';
import { apiFetch, GENERIC_ERROR, NETWORK_ERROR, type ApiError } from '../_lib/api';
import { ErrorRegion, PasswordField } from '../_lib/fields';

function loginError(e: ApiError): string {
  switch (e.code) {
    case 'INVALID_CREDENTIALS':
    case 'VALIDATION':
      return 'Incorrect username or password.';
    case 'ACCOUNT_REMOVED':
      return 'This account is no longer active. Contact your school.';
    case 'NETWORK':
      return NETWORK_ERROR;
    default:
      return GENERIC_ERROR;
  }
}

export default function LoginForm() {
  const router = useRouter();
  const id = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await apiFetch('/api/auth/login', { method: 'POST', body: { username: username.trim(), password } });
    if (r.ok) {
      setPassword('');
      router.push('/status');
      return; // keep the button disabled while navigating
    }
    setBusy(false);
    setPassword('');
    setError(loginError(r.error));
  }

  return (
    <>
      <h1 className={styles.title}>Log in</h1>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id}>Username</label>
          <input
            id={id}
            className={styles.input}
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
        <ErrorRegion message={error} />
        <button className={styles.button} type="submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className={styles.footer}>
        New here? <Link href="/join">Join with your school&apos;s code</Link>
      </p>
    </>
  );
}

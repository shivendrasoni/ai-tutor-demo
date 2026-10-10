'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LogoutButton from '@/app/ui/LogoutButton';
import { apiFetch } from '../_lib/api';
import { resolveStatus, type Me, type StatusInfo } from './resolve';
import styles from '../public.module.css';

export default function StatusView() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const me = await apiFetch<Me>('/api/me');
      let outcome = resolveStatus(me);
      if (outcome.kind === 'need-status') {
        outcome = resolveStatus(me, await apiFetch<StatusInfo>('/api/me/status'));
      }
      if (!live) return;
      if (outcome.kind === 'redirect') router.replace(outcome.to);
      else if (outcome.kind === 'text') setText(outcome.text);
      else if (outcome.kind === 'error') setError(outcome.message);
    })();
    return () => {
      live = false;
    };
  }, [router]);

  return (
    <>
      <h1 className={styles.title}>Your account</h1>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {text ? <p className={styles.notice}>{text}</p> : null}
      {!text && !error ? <p className={styles.sub}>Loading…</p> : null}
      <LogoutButton />
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../public.module.css';
import { apiFetch } from '../_lib/api';
import { ErrorRegion } from '../_lib/fields';
import { resolveStatus, type Me, type Resolved, type StatusData } from './resolve';

type View = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'text'; text: string };

export default function StatusView() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const apply = (r: Resolved) => {
        if (r.kind === 'redirect') router.replace(r.to); // keep showing "Loading…" while navigating
        else if (r.kind !== 'need-status') setView(r);
      };
      const me = await apiFetch<Me>('/api/me');
      if (!live) return;
      const first = resolveStatus(me);
      if (first.kind !== 'need-status') return apply(first);
      const st = await apiFetch<StatusData>('/api/me/status');
      if (!live) return;
      apply(resolveStatus(me, st));
    })();
    return () => {
      live = false;
    };
  }, [router]);

  async function logout() {
    setBusy(true);
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <>
      <h1 className={styles.title}>Your account</h1>
      {view.kind === 'loading' && <p className={styles.hint} role="status">Loading…</p>}
      {view.kind === 'text' && <p className={styles.notice} role="status">{view.text}</p>}
      <ErrorRegion message={view.kind === 'error' ? view.message : ''} />
      {view.kind !== 'loading' && (
        <button type="button" className={styles.secondary} onClick={logout} disabled={busy}>
          {busy ? 'Logging out…' : 'Log out'}
        </button>
      )}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../public.module.css';
import { apiFetch, GENERIC_ERROR, NETWORK_ERROR } from '../_lib/api';
import { ErrorRegion } from '../_lib/fields';

type Me = { name: string; roles: string[]; isPlatformAdmin: boolean };
type Status = { status: 'pending_payment' | 'active' | 'lapsed' | 'removed'; planName: string | null; periodEnd: string | null };
type View = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'text'; text: string };

const COPY: Record<string, string> = {
  pending_payment:
    "Your account is waiting for activation. Once your payment is confirmed you'll be able to start learning.",
  lapsed: 'Your plan has expired. Please contact us to renew.',
  active: 'Your account is active.',
};

export default function StatusView() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const fail = (code: string) =>
      live && setView({ kind: 'error', message: code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR });
    (async () => {
      const me = await apiFetch<Me>('/api/me');
      if (!live) return;
      if (!me.ok) {
        if (me.error.status === 401) router.replace('/login');
        else fail(me.error.code);
        return;
      }
      if (!me.data.roles.includes('student')) {
        setView({ kind: 'text', text: `Signed in as ${me.data.name}.` });
        return;
      }
      const st = await apiFetch<Status>('/api/me/status');
      if (!live) return;
      if (!st.ok) {
        if (st.error.status === 401) router.replace('/login');
        else if (st.error.status === 403) setView({ kind: 'text', text: `Signed in as ${me.data.name}.` });
        else fail(st.error.code);
        return;
      }
      const text = COPY[st.data.status];
      if (text) setView({ kind: 'text', text });
      else fail('INTERNAL');
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

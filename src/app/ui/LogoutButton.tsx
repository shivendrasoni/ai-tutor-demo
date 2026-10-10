'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }
  return <button type="button" onClick={logout} disabled={busy}>{busy ? 'Logging out…' : 'Log out'}</button>;
}

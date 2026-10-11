'use client';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

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
  return (
    <Button type="button" variant="outline" size="sm" onClick={logout} disabled={busy}>
      <LogOut className="size-4" />
      {busy ? 'Logging out…' : 'Log out'}
    </Button>
  );
}

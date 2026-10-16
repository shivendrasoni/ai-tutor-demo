'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LogoutButton from '@/app/ui/LogoutButton';
import { setPersona } from '@/demo/core/store';
import { useSlice } from '@/demo/core/store';
import { apiFetch } from '../_lib/api';
import { resolveStatus, type Me, type StatusInfo } from './resolve';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function StatusView() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState(false);
  const [paying, setPaying] = useState(false);
  // Reload when a platform admin records the payment (the same store backs both personas).
  const platform = useSlice<unknown>('platform');

  const load = useCallback(async (live: () => boolean) => {
    const me = await apiFetch<Me>('/api/me');
    let outcome = resolveStatus(me);
    if (outcome.kind === 'need-status') {
      outcome = resolveStatus(me, await apiFetch<StatusInfo>('/api/me/status'));
    }
    if (!live()) return;
    if (outcome.kind === 'redirect' && outcome.to === '/learn') {
      setActive(true);
      setText('');
    } else if (outcome.kind === 'redirect') router.replace(outcome.to);
    else if (outcome.kind === 'text') {
      setActive(false);
      setText(outcome.text);
    } else if (outcome.kind === 'error') setError(outcome.message);
  }, [router]);

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load, platform]);

  async function iHavePaid() {
    setPaying(true);
    await apiFetch('/api/me/demo-pay', { method: 'POST' });
    setPaying(false);
  }

  function startLearning() {
    // Demo: the /learn guard only admits the three active-student personas.
    setPersona('student_middle');
    router.push('/learn');
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold leading-tight">Your account</h1>
      </CardHeader>
      <CardContent className="grid justify-items-start gap-4">
        {error ? <Alert variant="destructive" className="w-full"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {active ? (
          <>
            <Badge variant="secondary">Active</Badge>
            <p role="status" className="w-full rounded-lg border border-success/30 bg-success/15 px-4 py-3 text-sm text-success">
              Payment confirmed. Your account is active and you can start learning.
            </p>
            <Button type="button" size="lg" onClick={startLearning}>Start learning</Button>
          </>
        ) : null}
        {text ? (
          <>
            <Badge variant="secondary">Status</Badge>
            <p className="w-full rounded-lg bg-muted px-4 py-3 text-sm">{text}</p>
            <Button type="button" variant="secondary" size="sm" onClick={iHavePaid} disabled={paying}>
              {paying ? 'Confirming…' : "Demo: I've paid"}
            </Button>
          </>
        ) : null}
        {!text && !error && !active ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        <LogoutButton />
      </CardContent>
    </Card>
  );
}

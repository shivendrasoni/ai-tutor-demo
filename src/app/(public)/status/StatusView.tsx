'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LogoutButton from '@/app/ui/LogoutButton';
import { apiFetch } from '../_lib/api';
import { resolveStatus, type Me, type StatusInfo } from './resolve';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

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
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold leading-tight">Your account</h1>
      </CardHeader>
      <CardContent className="grid justify-items-start gap-4">
        {error ? <Alert variant="destructive" className="w-full"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {text ? (
          <>
            <Badge variant="secondary">Status</Badge>
            <p className="w-full rounded-lg bg-muted px-4 py-3 text-sm">{text}</p>
          </>
        ) : null}
        {!text && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        <LogoutButton />
      </CardContent>
    </Card>
  );
}

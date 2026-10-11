'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, genericMessage } from '../_lib/api';
import { TextField } from '../_lib/fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';

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
    setPassword('');
    setError(
      r.error.code === 'INVALID_CREDENTIALS'
        ? 'Incorrect username or password.'
        : r.error.code === 'ACCOUNT_REMOVED'
          ? 'This account is no longer active. Contact your school.'
          : genericMessage(r.error),
    );
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold leading-tight">Log in</h1>
      </CardHeader>
      <CardContent>
      <form className="grid gap-5" onSubmit={submit}>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" required maxLength={200} />
        <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required maxLength={1000} />
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</Button>
      </form>
      </CardContent>
      <CardFooter className="justify-center">
        <Link href="/join" className="text-sm font-medium text-primary underline-offset-4 hover:underline">New student? Sign up with your school code</Link>
      </CardFooter>
    </Card>
  );
}

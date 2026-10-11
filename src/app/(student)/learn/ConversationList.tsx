'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, GENERIC_ERROR, NETWORK_ERROR, type ApiError } from '@/app/(public)/_lib/api';
import { MessageSquare, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { choiceClass, choiceInputClass, selectClass } from '../_components/styles';

type Conversation = { id: string; title: string | null; skillKey: string; subjectId: string | null; updatedAt: string };
type Skill = { id: string; key: string; name: string };
type Subject = { id: string; name: string };

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (Number.isNaN(min) || min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

/** 401 sends the student to /login and 403 (not an active student) to /status. Returns true when it redirected. */
function redirectOn(e: ApiError, replace: (href: string) => void): boolean {
  if (e.status === 401) replace('/login');
  else if (e.status === 403) replace('/status');
  else return false;
  return true;
}

export default function ConversationList() {
  const router = useRouter();
  const skillGroup = useId();
  const subjectId = useId();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [skillKey, setSkillKey] = useState('socratic');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [list, sk, sub] = await Promise.all([
        apiFetch<Conversation[]>('/api/tutor/conversations'),
        apiFetch<Skill[]>('/api/tutor/skills?kind=chat'),
        apiFetch<Subject[]>('/api/tutor/subjects'),
      ]);
      if (!live) return;
      for (const r of [list, sk, sub]) if (!r.ok && redirectOn(r.error, router.replace)) return;
      if (!list.ok) {
        setError(list.error.code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR);
        return;
      }
      setConversations(list.data);
      if (sk.ok) {
        setSkills(sk.data);
        setSkillKey((cur) => (sk.data.some((s) => s.key === cur) ? cur : (sk.data[0]?.key ?? cur)));
      }
      if (sub.ok) setSubjects(sub.data);
    })();
    return () => {
      live = false;
    };
  }, [router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await apiFetch<{ id: string }>('/api/tutor/conversations', {
      method: 'POST',
      body: { skillKey, ...(subject ? { subjectId: subject } : {}) },
    });
    if (r.ok) {
      router.push(`/learn/c/${r.data.id}`);
      return;
    }
    setBusy(false);
    if (redirectOn(r.error, router.replace)) return;
    setError(r.error.code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Learn</h1>
        {!picking && (
          <Button type="button" onClick={() => setPicking(true)}>
            <Plus />
            New chat
          </Button>
        )}
      </div>
      {picking && (
        <Card>
          <CardContent>
            <form className="flex flex-col gap-5" onSubmit={create}>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-semibold">How should the tutor help?</legend>
                {skills.map((s) => (
                  <label key={s.id} className={choiceClass}>
                    <input
                      type="radio"
                      className={choiceInputClass}
                      name={skillGroup}
                      value={s.key}
                      checked={skillKey === s.key}
                      onChange={() => setSkillKey(s.key)}
                    />
                    {s.name}
                  </label>
                ))}
              </fieldset>
              {subjects.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={subjectId}>Subject (optional)</Label>
                  <select id={subjectId} className={selectClass} value={subject} onChange={(e) => setSubject(e.target.value)}>
                    <option value="">Any subject</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setPicking(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || skills.length === 0}>
                  {busy ? 'Starting…' : 'Start chat'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {conversations === null && !error && (
        <div className="space-y-3" role="status">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {conversations !== null && conversations.length === 0 && (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No chats yet. Start one above.
        </p>
      )}
      {conversations !== null && conversations.length > 0 && (
        <ul className="flex flex-col gap-3">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/learn/c/${c.id}`}
                className={cn(
                  'flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors',
                  'hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <MessageSquare className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.title ?? 'New chat'}</span>
                  <span className="block text-xs text-muted-foreground">{relativeTime(c.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

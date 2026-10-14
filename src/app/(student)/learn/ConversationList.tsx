'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, GENERIC_ERROR, NETWORK_ERROR, type ApiError } from '@/app/(public)/_lib/api';
import { Brain, Flame, Lightbulb, MessageCircleQuestion, MessagesSquare, Plus, Sparkles, type LucideIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import Tutu from '@/components/Tutu';
import { dayStreak, greeting, tagline } from '@/lib/student-band';
import { cn } from '@/lib/utils';
import { useStudent } from '../_components/StudentContext';
import { selectClass } from '../_components/styles';

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

const SKILL_STYLE: Record<string, { Icon: LucideIcon; blurb: string; tone: string }> = {
  socratic: { Icon: Brain, blurb: 'Guide me with questions so I find the answer myself', tone: 'bg-grape/20 text-grape' },
  explain: { Icon: Lightbulb, blurb: 'Show me how it works in a clear, simple way', tone: 'bg-sun/30 text-amber-600 dark:text-sun' },
};
const FALLBACK_STYLE = { Icon: Sparkles, blurb: 'Learn together with your tutor', tone: 'bg-sky/25 text-sky' };
const ROW_TONES = ['bg-grape/20 text-grape', 'bg-sky/25 text-sky', 'bg-mint/30 text-emerald-600 dark:text-mint', 'bg-coral/25 text-coral', 'bg-sun/30 text-amber-600 dark:text-sun'];

export default function ConversationList() {
  const { name, band } = useStudent();
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

  const streak = conversations ? dayStreak(conversations.map((c) => new Date(c.updatedAt).getTime()), Date.now()) : 0;
  const junior = band === 'junior';

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Learn</h1>
      <section className="anim-pop relative overflow-clip rounded-[2rem] border bg-card p-5 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-grape/15 blur-2xl" aria-hidden />
        <div className="relative flex items-center gap-4 sm:gap-6">
          <Tutu mood="happy" className={cn('anim-float shrink-0', junior ? 'size-28 sm:size-36' : 'size-24 sm:size-32')} />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-2xl font-extrabold leading-tight sm:text-3xl">{greeting(band, name, new Date().getHours())}</p>
              <p className="mt-1 text-muted-foreground">{tagline(band)}</p>
            </div>
            {!picking && (
              <Button type="button" size="lg" className="btn-chunky h-12 px-6 text-base" onClick={() => setPicking(true)}>
                <Plus className="size-5" />
                New chat
              </Button>
            )}
          </div>
        </div>
        {conversations !== null && conversations.length > 0 && (
          <ul className="relative mt-5 flex flex-wrap gap-2 text-sm font-bold" aria-label="Your stats">
            {streak > 0 && (
              <li className="flex items-center gap-1.5 rounded-full bg-coral/20 px-3 py-1.5 text-coral">
                <Flame className="size-4" aria-hidden />
                {streak} day{streak === 1 ? '' : 's'} in a row
              </li>
            )}
            <li className="flex items-center gap-1.5 rounded-full bg-sky/20 px-3 py-1.5 text-sky">
              <MessagesSquare className="size-4" aria-hidden />
              {conversations.length} chat{conversations.length === 1 ? '' : 's'} so far
            </li>
          </ul>
        )}
      </section>

      {picking && (
        <form className="anim-pop flex flex-col gap-5 rounded-[2rem] border bg-card p-5 shadow-sm sm:p-6" onSubmit={create}>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-lg font-extrabold">How should the tutor help?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {skills.map((s) => {
                const st = SKILL_STYLE[s.key] ?? FALLBACK_STYLE;
                return (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 bg-background p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
                  >
                    <span className={cn('grid size-11 shrink-0 place-items-center rounded-2xl', st.tone)} aria-hidden>
                      <st.Icon className="size-6" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-extrabold">{s.name}</span>
                      <span className="block text-sm text-muted-foreground">{st.blurb}</span>
                    </span>
                    <input
                      type="radio"
                      className="mt-1 size-5 shrink-0 accent-primary"
                      name={skillGroup}
                      value={s.key}
                      checked={skillKey === s.key}
                      onChange={() => setSkillKey(s.key)}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
          {subjects.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={subjectId} className="text-base font-bold">Subject (optional)</Label>
              <select id={subjectId} className={cn(selectClass, 'h-12 rounded-2xl text-base')} value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Any subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="lg" className="h-12" onClick={() => setPicking(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="lg" className="btn-chunky h-12 px-8 text-base" disabled={busy || skills.length === 0}>
              {busy ? 'Starting…' : 'Start chat'}
            </Button>
          </div>
        </form>
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {conversations === null && !error && (
        <div className="space-y-3" role="status">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      )}
      {conversations !== null && conversations.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[2rem] border-2 border-dashed py-10 text-center">
          <MessageCircleQuestion className="size-10 text-primary/60" aria-hidden />
          <p className="font-bold text-muted-foreground">No chats yet. Start one above.</p>
          <p className="text-sm text-muted-foreground">Ask about homework, a tricky topic, or anything you are curious about!</p>
        </div>
      )}
      {conversations !== null && conversations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold">Jump back in</h2>
          <ul className="flex flex-col gap-3">
            {conversations.map((c, i) => (
              <li key={c.id} className="anim-pop" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <Link
                  href={`/learn/c/${c.id}`}
                  className={cn(
                    'flex items-center gap-4 rounded-2xl border bg-card p-4 no-underline shadow-xs transition-all',
                    'hover:-translate-y-0.5 hover:border-primary/40 hover:no-underline hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  )}
                >
                  <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', ROW_TONES[i % ROW_TONES.length])}>
                    <MessagesSquare className="size-6" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-foreground">{c.title ?? 'New chat'}</span>
                    <span className="block text-sm text-muted-foreground">{relativeTime(c.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

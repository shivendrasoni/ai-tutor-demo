'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  authRedirect, studyFetch, type ArtifactType, type Chapter, type Pattern, type Subject, type Summary,
} from './_lib/api';
import { nextPollDelay } from './_lib/timing';
import { Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { choiceClass, choiceInputClass, selectClass } from '../../_components/styles';

const TABS: { type: ArtifactType; label: string }[] = [
  { type: 'practice_test', label: 'Practice tests' },
  { type: 'mock_exam', label: 'Mock exams' },
  { type: 'study_notes', label: 'Notes' },
  { type: 'last_night_notes', label: 'Last-night notes' },
];
const MAX_CHAPTERS = 6;

const badge = (s: string) => (s === 'generating' ? 'Generating…' : s === 'ready' ? 'Ready' : 'Failed — try again');

export default function StudyHub() {
  const router = useRouter();
  const [tab, setTab] = useState<ArtifactType>('practice_test');
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [error, setError] = useState('');

  // One polling loop per tab. `live` goes false on unmount or tab switch so a late response never
  // overwrites newer state or schedules another poll.
  const live = useRef<{ current: boolean }>({ current: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(async () => {
    clearTimeout(timer.current);
    const token = live.current;
    const r = await studyFetch<Summary[]>(`/api/study/artifacts?type=${tab}`);
    if (!token.current) return;
    if (!r.ok) {
      const to = authRedirect(r.error);
      if (to) router.replace(to);
      else setError('Could not load your study items. Please try again.');
      return;
    }
    setRows(r.data);
    if (r.data.some((a) => nextPollDelay(a.status) !== null)) timer.current = setTimeout(() => void refresh(), nextPollDelay('generating')!);
  }, [tab, router]);

  useEffect(() => {
    const token = { current: true };
    live.current = token;
    setRows(null);
    setError('');
    void refresh();
    return () => {
      token.current = false;
      clearTimeout(timer.current);
    };
  }, [refresh]);

  const label = TABS.find((t) => t.type === tab)!.label;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Study</h1>
      <div role="tablist" aria-label="Study tools" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-4">
        {TABS.map((t) => (
          <button
            key={t.type}
            role="tab"
            type="button"
            aria-selected={tab === t.type}
            className={cn(
              'min-h-9 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
              tab === t.type && 'bg-card text-foreground shadow-sm',
            )}
            onClick={() => setTab(t.type)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <section role="tabpanel" aria-label={label} className="space-y-4">
        <CreateForm key={tab} type={tab} onCreated={() => void refresh()} onAuth={(to) => router.replace(to)} />
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {rows === null && !error && (
          <div className="space-y-3" role="status">
            <span className="sr-only">Loading…</span>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {rows?.length === 0 && (
          <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
            Nothing here yet. Create one above.
          </p>
        )}
        {rows && rows.length > 0 && (
          <ul className="flex flex-col gap-3">
            {rows.map((a) => (
              <li key={a.id}>
                <Card className="py-0">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {a.status === 'ready' ? (
                        <Link className="truncate font-semibold text-primary hover:underline" href={`/learn/study/a/${a.id}`}>{a.title ?? label}</Link>
                      ) : (
                        <span className="truncate font-medium">{a.title ?? label}</span>
                      )}
                      {a.status === 'ready' && a.bestScorePct !== null && (
                        <span className="text-xs text-muted-foreground">Best {Math.round(a.bestScorePct)}% · {a.attemptCount} attempt{a.attemptCount === 1 ? '' : 's'}</span>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 border-transparent',
                        a.status === 'failed' ? 'bg-destructive/15 text-destructive'
                        : a.status === 'ready' ? 'bg-success/15 text-success'
                        : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {badge(a.status)}
                    </Badge>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreateForm({ type, onCreated, onAuth }: { type: ArtifactType; onCreated: () => void; onAuth: (to: string) => void }) {
  const ids = { subject: useId(), count: useId(), pattern: useId() };
  const [open, setOpen] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [patternKey, setPatternKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [s, p] = await Promise.all([
        studyFetch<Subject[]>('/api/tutor/subjects'),
        type === 'mock_exam' ? studyFetch<Pattern[]>('/api/study/patterns') : Promise.resolve(null),
      ]);
      if (s.ok) setSubjects(s.data);
      else if (authRedirect(s.error)) onAuth(authRedirect(s.error)!);
      if (p?.ok) {
        setPatterns(p.data);
        setPatternKey((cur) => cur || (p.data[0]?.key ?? ''));
      }
    })();
  }, [open, type, onAuth]);

  async function pickSubject(id: string) {
    setSubjectId(id);
    setPicked([]);
    setChapters([]);
    if (!id) return;
    const r = await studyFetch<Chapter[]>(`/api/study/chapters?subjectId=${id}`);
    if (r.ok) setChapters(r.data);
  }

  function toggle(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : cur.length >= MAX_CHAPTERS ? cur : [...cur, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      type, subjectId, chapterIds: picked,
      ...(type === 'practice_test' ? { questionCount: count } : {}),
      ...(type === 'mock_exam' && patternKey ? { patternKey } : {}),
    };
    const r = await studyFetch<{ id: string }>('/api/study/artifacts', { method: 'POST', body });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setPicked([]);
      onCreated();
      return;
    }
    const to = authRedirect(r.error);
    if (to) onAuth(to);
    else if (r.error.code === 'GENERATION_LIMIT') setError('You have reached today\'s limit of 10. Try again tomorrow.');
    else setError(r.error.message ?? 'Could not create it. Please try again.');
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus />
        Create
      </Button>
    );
  }
  return (
    <Card>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.subject}>Subject</Label>
            <select id={ids.subject} className={selectClass} value={subjectId} onChange={(e) => void pickSubject(e.target.value)}>
              <option value="">Choose a subject</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {chapters.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-semibold">Chapters (up to {MAX_CHAPTERS})</legend>
              {chapters.map((c) => (
                <label key={c.id} className={choiceClass}>
                  <input type="checkbox" className={choiceInputClass} checked={picked.includes(c.id)} disabled={!picked.includes(c.id) && picked.length >= MAX_CHAPTERS} onChange={() => toggle(c.id)} />
                  {c.title}
                </label>
              ))}
            </fieldset>
          )}
          {type === 'practice_test' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.count}>Number of questions (5–30)</Label>
              <Input id={ids.count} type="number" min={5} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
          )}
          {type === 'mock_exam' && patterns.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.pattern}>Exam pattern</Label>
              <select id={ids.pattern} className={selectClass} value={patternKey} onChange={(e) => setPatternKey(e.target.value)}>
                {patterns.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </div>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !subjectId || picked.length === 0}>
              {busy ? 'Creating…' : 'Generate'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

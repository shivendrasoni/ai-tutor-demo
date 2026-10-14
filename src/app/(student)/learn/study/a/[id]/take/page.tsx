'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { allQuestions, authRedirect, studyFetch, type Artifact, type ViewQuestion } from '../../../_lib/api';
import { startTake } from '../../../_lib/start';
import { formatClock } from '../../../_lib/timing';
import { useAutosave } from '../../../_lib/useAutosave';
import { useCountdown } from '../../../_lib/useCountdown';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import Tutu from '@/components/Tutu';
import { useStudent } from '../../../../../_components/StudentContext';
import { choiceClass, choiceInputClass } from '../../../../../_components/styles';

type Answers = Record<string, number | string>;

function cheer(band: 'junior' | 'middle' | 'senior', done: number, total: number): string {
  const f = total === 0 ? 0 : done / total;
  if (band === 'junior') return f === 1 ? 'You answered everything! 🎉' : f >= 0.5 ? 'More than halfway! Keep going! 🚀' : 'You can do it! 💪';
  if (band === 'middle') return f === 1 ? 'Everything answered. Check it over, then submit!' : f >= 0.5 ? 'Over halfway. Nice pace!' : 'Take your time. You’ve got this.';
  return f === 1 ? 'All answered. Review if you like, then submit.' : `${done} of ${total} answered`;
}

export default function TakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { band } = useStudent();
  const router = useRouter();
  const [art, setArt] = useState<Artifact | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const answersRef = useRef<Answers>({});
  const attemptRef = useRef<string | null>(null);
  const started = useRef(false);
  const expiredRef = useRef(false);

  // Create the attempt once on mount (the ref guards React strict-mode double effects).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const r = await startTake(id);
      if (!r.ok) {
        const to = authRedirect(r.error);
        if (to) router.replace(to);
        else setError(r.error.message ?? 'Could not start this test.'); // fatal: no attempt id, so autosave stays off
        return;
      }
      attemptRef.current = r.attemptId;
      answersRef.current = r.answers;
      setAnswers(r.answers);
      setArt(r.art);
      setDeadline(r.deadline);
      setAttemptId(r.attemptId);
    })();
  }, [id, router]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!attemptRef.current) return true;
    const r = await studyFetch(`/api/study/attempts/${attemptRef.current}/answers`, { method: 'PUT', body: { answers: answersRef.current } });
    if (!r.ok && r.error.code === 'ATTEMPT_EXPIRED') {
      expiredRef.current = true;
      setExpired(true);
    }
    return r.ok;
  }, []);
  const { markDirty, flush } = useAutosave(save, attemptId !== null && !expired);

  // Save when the student leaves the page.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [flush]);

  function setAnswer(q: ViewQuestion, value: number | string) {
    answersRef.current = { ...answersRef.current, [q.id]: value };
    setAnswers(answersRef.current);
    markDirty();
  }

  function go(to: number) {
    setIndex(to);
    void flush(); // save in the background so navigation is instant
  }

  const submit = useCallback(async (auto = false) => {
    if (!attemptRef.current || submitting) return;
    setSubmitting(true);
    setConfirming(false);
    const saved = await flush();
    if (!saved && !auto && !expiredRef.current) {
      setSubmitting(false);
      setError('Could not save your answers, so nothing was submitted. Check your connection and try again.');
      return;
    }
    const r = await studyFetch(`/api/study/attempts/${attemptRef.current}/submit`, { method: 'POST' });
    if (r.ok) {
      router.push(`/learn/study/attempt/${attemptRef.current}`);
      return;
    }
    setSubmitting(false);
    if (r.error.code === 'ATTEMPT_EXPIRED') {
      expiredRef.current = true;
      setExpired(true);
    } else setError('Could not submit. Please try again.');
  }, [flush, router, submitting]);

  const left = useCountdown(deadline);
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (left === 0 && !autoSubmitted.current && attemptId) {
      autoSubmitted.current = true;
      void submit(true);
    }
  }, [left, attemptId, submit]);

  if (error && !art) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Link href={`/learn/study/a/${id}`} className="text-sm font-medium text-primary hover:underline">Back</Link>
      </div>
    );
  }
  if (!art) {
    return (
      <div className="space-y-3" role="status">
        <span className="sr-only">Starting…</span>
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const qs = allQuestions(art);
  const q = qs[index];
  if (!q) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>This test has no questions.</AlertDescription>
      </Alert>
    );
  }
  const cur = answers[q.id];
  const done = qs.filter((x) => answers[x.id] !== undefined && answers[x.id] !== '').length;
  const unanswered = qs.length - done;

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 -mx-4 space-y-2 border-b bg-background/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <span className="text-base font-extrabold">Question {index + 1} of {qs.length}</span>
          {left !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-coral/20 px-3 py-1 font-mono text-sm font-bold tabular-nums text-coral">
              <Clock className="size-4" aria-hidden />
              <span role="timer" aria-label="Time left">{formatClock(left)}</span>
            </span>
          )}
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-grape transition-all duration-500" style={{ width: `${((index + 1) / qs.length) * 100}%` }} />
        </div>
      </div>
      {expired && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Time is up. Your answers could not be saved. <Link href={`/learn/study/a/${id}`} className="font-medium underline">Back to the test</Link>
          </AlertDescription>
        </Alert>
      )}
      <ol className="flex flex-wrap gap-2" aria-label="Questions">
        {qs.map((x, i) => (
          <li key={x.id}>
            <button
              type="button"
              className={cn(
                'size-10 rounded-full border-2 text-sm font-bold outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50',
                i === index
                  ? 'scale-110 border-primary bg-primary text-primary-foreground shadow-md'
                  : answers[x.id] !== undefined
                    ? 'border-success/50 bg-success/15 text-success'
                    : 'bg-card text-muted-foreground hover:bg-accent/50',
              )}
              aria-label={`Question ${i + 1}`}
              aria-current={i === index ? 'step' : undefined}
              onClick={() => go(i)}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
      <section key={q.id} className="anim-pop min-w-0 space-y-5 rounded-[2rem] border bg-card p-5 shadow-sm sm:p-7">
        <div className="space-y-2">
          <p className="text-xl font-extrabold leading-snug [overflow-wrap:anywhere]">{q.prompt}</p>
          <p className="text-sm font-bold text-muted-foreground">{q.marks} mark{q.marks === 1 ? '' : 's'}</p>
        </div>
        {q.type === 'mcq' && q.options ? (
          <fieldset className="flex flex-col gap-3" disabled={expired}>
            <legend className="mb-2 text-sm font-bold text-muted-foreground">Choose one</legend>
            {q.options.map((o, i) => (
              <label key={i} className={choiceClass}>
                <span aria-hidden data-letter={String.fromCharCode(65 + i)} className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent font-extrabold text-accent-foreground before:content-[attr(data-letter)]" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{o}</span>
                <input type="radio" className={choiceInputClass} name={`q-${q.id}`} checked={cur === i} onChange={() => setAnswer(q, i)} />
              </label>
            ))}
          </fieldset>
        ) : (
          <Textarea
            aria-label="Your answer"
            className="rounded-2xl border-2 p-4 text-base"
            rows={q.type === 'short' ? 4 : 8}
            maxLength={10000}
            disabled={expired}
            value={typeof cur === 'string' ? cur : ''}
            onChange={(e) => setAnswer(q, e.target.value)}
          />
        )}
      </section>
      <p className="flex items-center justify-center gap-2 text-sm font-bold text-muted-foreground">
        <Tutu mood={done === qs.length ? 'cheer' : 'happy'} className="size-8" />
        {cheer(band, done, qs.length)}
      </p>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" size="lg" className="h-12 border-2" disabled={index === 0} onClick={() => go(index - 1)}>
          <ArrowLeft />
          Previous
        </Button>
        <Button type="button" variant="outline" size="lg" className="h-12 border-2" disabled={index === qs.length - 1} onClick={() => go(index + 1)}>
          Next
          <ArrowRight />
        </Button>
      </div>
      {!confirming ? (
        <Button type="button" size="lg" className="btn-chunky h-12 w-full text-base" disabled={submitting || expired} onClick={() => setConfirming(true)}>Submit</Button>
      ) : (
        <div className="anim-pop space-y-3 rounded-2xl border-2 border-primary/40 bg-accent/60 p-4" role="alertdialog" aria-label="Confirm submit">
          <p className="font-bold">Submit your answers? You cannot change them afterwards.</p>
          {unanswered > 0 && (
            <p className="text-sm text-muted-foreground">
              {unanswered} question{unanswered === 1 ? ' is' : 's are'} still empty. You can go back and answer {unanswered === 1 ? 'it' : 'them'} first.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="lg" className="border-2" onClick={() => setConfirming(false)}>Keep working</Button>
            <Button type="button" size="lg" className="btn-chunky" disabled={submitting} onClick={() => void submit(false)}>Yes, submit</Button>
          </div>
        </div>
      )}
    </div>
  );
}

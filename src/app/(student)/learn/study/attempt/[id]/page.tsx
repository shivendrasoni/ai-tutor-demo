'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Citations from '../../_lib/Citations';
import { authRedirect, studyFetch, type Attempt } from '../../_lib/api';
import { POLL_MS, takeLinkLabel } from '../../_lib/timing';
import { ArrowLeft, CheckCircle2, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import Tutu from '@/components/Tutu';
import { resultMessage } from '@/lib/student-band';
import { cn } from '@/lib/utils';
import { useStudent } from '../../../../_components/StudentContext';
import { Confetti, ScoreRing } from '../../_lib/Celebrate';

export default function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { band } = useStudent();
  const router = useRouter();
  const [at, setAt] = useState<Attempt | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const r = await studyFetch<Attempt>(`/api/study/attempts/${id}`);
      if (!live) return;
      if (!r.ok) {
        const to = authRedirect(r.error);
        if (to) router.replace(to);
        else setError('Could not load this attempt.');
        return;
      }
      setAt(r.data);
      if (r.data.status === 'grading') timer = setTimeout(() => void run(), POLL_MS);
    };
    void run();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, router]);

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!at) {
    return (
      <div className="space-y-3" role="status">
        <span className="sr-only">Loading…</span>
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const titles = at.artifact.chapterTitles;
  return (
    <div className="space-y-5">
      <p>
        <Link href={`/learn/study/a/${at.artifactId}`} className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1.5 text-sm font-bold text-primary no-underline shadow-xs ring-1 ring-border hover:no-underline">
          <ArrowLeft className="size-4" aria-hidden />
          <span>{at.artifact.title ?? 'Back'}</span>
        </Link>
      </p>
      {at.status === 'in_progress' && (
        <div className="flex flex-col gap-4 rounded-[2rem] border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="font-bold text-muted-foreground">This attempt is still in progress.</p>
          <Button asChild size="lg" className="btn-chunky">
            <Link href={`/learn/study/a/${at.artifactId}/take`}>{takeLinkLabel(at.status, at.deadline, Date.now())}</Link>
          </Button>
        </div>
      )}
      {at.status === 'grading' && (
        <div className="flex flex-col items-center gap-3 rounded-[2rem] border bg-card p-8 text-center" role="status">
          <Tutu mood="thinking" className="anim-float size-28" />
          <p className="font-extrabold">Grading…</p>
          <p className="text-sm text-muted-foreground">Tutu is checking your answers. This only takes a moment.</p>
        </div>
      )}
      {at.status === 'graded' && (() => {
        const pct = at.maxScore ? ((at.score ?? 0) / at.maxScore) * 100 : 0;
        return (
          <>
            <section className="anim-pop relative overflow-clip rounded-[2rem] border bg-card p-6 text-center shadow-sm">
              {pct >= 80 && <Confetti />}
              <h1 className="text-3xl font-extrabold">Graded</h1>
              <div className="relative mt-3 flex flex-col items-center gap-2">
                <ScoreRing pct={pct} />
                <Tutu mood={pct >= 80 ? 'cheer' : 'happy'} className="absolute -right-1 bottom-0 size-20 sm:right-16" />
              </div>
              <div className="mt-2">
                <div className="text-4xl font-extrabold text-primary">{at.score} / {at.maxScore}</div>
                <div className="text-sm font-bold text-muted-foreground">Score</div>
              </div>
              <p className="mx-auto mt-3 max-w-sm font-bold">{resultMessage(band, pct)}</p>
              <Button asChild size="lg" className="btn-chunky mt-4 h-12 px-8 text-base">
                <Link href={`/learn/study/a/${at.artifactId}`}>Try again or pick another</Link>
              </Button>
            </section>
            {at.byChapter && (
              <section className="space-y-2">
                <h2 className="text-lg font-extrabold">How you did by chapter</h2>
                <ul className="flex flex-col gap-2" aria-label="By chapter">
                  {Object.entries(at.byChapter).map(([ch, v]) => {
                    const f = v.max ? v.scored / v.max : 0;
                    return (
                      <li key={ch} className="space-y-2 rounded-2xl border bg-card px-4 py-3 text-sm">
                        <div className="font-bold">{titles[ch] ?? 'Chapter'}: {v.scored} / {v.max}</div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div className={cn('h-full rounded-full', f >= 0.8 ? 'bg-success' : f >= 0.5 ? 'bg-primary' : 'bg-coral')} style={{ width: `${f * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        );
      })()}
      {at.submittedAt && at.questions && (
        <ol className="flex flex-col gap-4">
          {at.questions.map((q, i) => {
            const res = at.results?.[q.id];
            const ans = at.answers[q.id];
            const full = res ? res.score >= res.maxScore : null;
            return (
              <li
                key={q.id}
                className={cn(
                  'space-y-2 rounded-2xl border border-l-8 bg-card p-4 text-base shadow-xs',
                  full === true && 'border-l-success',
                  full === false && 'border-l-destructive',
                )}
              >
                <p className="font-extrabold">{i + 1}. {q.prompt}</p>
                {res && <p className="text-xs text-muted-foreground">Score: {res.score} / {res.maxScore}</p>}
                <p className="text-muted-foreground">
                  Your answer:{' '}
                  {ans === undefined ? 'No answer' : q.options && typeof ans === 'number' ? (q.options[ans] ?? 'No answer') : String(ans)}
                </p>
                {res?.feedback && <p className="rounded-lg bg-muted p-3">{res.feedback}</p>}
                {typeof q.correctIndex === 'number' && q.options && (
                  <p className="flex items-center gap-1.5 font-medium text-success">
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                    <span>Correct answer: {q.options[q.correctIndex]}</span>
                  </p>
                )}
                {q.modelAnswer && (
                  <p className="flex items-center gap-1.5 font-medium text-success">
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                    <span>Model answer: {q.modelAnswer}</span>
                  </p>
                )}
                {res?.needsReview && (
                  <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-warning">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden />
                    <span>Needs review: this answer could not be graded automatically.</span>
                  </p>
                )}
                <Citations citations={q.citations} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

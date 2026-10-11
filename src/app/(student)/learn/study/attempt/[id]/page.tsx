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
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Stat } from '@/app/ui/components';
import { cn } from '@/lib/utils';

export default function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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
        <Link href={`/learn/study/a/${at.artifactId}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          <span>{at.artifact.title ?? 'Back'}</span>
        </Link>
      </p>
      {at.status === 'in_progress' && (
        <Card>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">This attempt is still in progress.</p>
            <Button asChild>
              <Link href={`/learn/study/a/${at.artifactId}/take`}>{takeLinkLabel(at.status, at.deadline, Date.now())}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {at.status === 'grading' && (
        <div className="space-y-3" role="status">
          <p className="text-sm text-muted-foreground">Grading…</p>
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {at.status === 'graded' && (
        <>
          <h1 className="text-2xl font-bold">Graded</h1>
          <div className="[&_div.text-2xl]:text-4xl [&_div.text-2xl]:text-primary">
            <Stat label="Score" value={`${at.score} / ${at.maxScore}`} />
          </div>
          {at.byChapter && (
            <ul className="flex flex-col gap-2" aria-label="By chapter">
              {Object.entries(at.byChapter).map(([ch, v]) => (
                <li key={ch} className="rounded-xl border bg-card px-4 py-3 text-sm">{titles[ch] ?? 'Chapter'}: {v.scored} / {v.max}</li>
              ))}
            </ul>
          )}
        </>
      )}
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
                  'space-y-2 rounded-xl border border-l-4 bg-card p-4 text-sm shadow-xs',
                  full === true && 'border-l-success',
                  full === false && 'border-l-destructive',
                )}
              >
                <p className="font-semibold">{i + 1}. {q.prompt}</p>
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

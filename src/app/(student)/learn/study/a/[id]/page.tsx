'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Markdown from 'react-markdown';
import Citations from '../../_lib/Citations';
import { allQuestions, authRedirect, studyFetch, type Artifact, type AttemptRow } from '../../_lib/api';
import { nextPollDelay } from '../../_lib/timing';
import { ArrowLeft, ChevronRight, Play } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { markdownClass } from '../../../../_components/styles';

type Detail = Artifact & { attempts: AttemptRow[] };

export default function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [art, setArt] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const r = await studyFetch<Detail>(`/api/study/artifacts/${id}`);
      if (!live) return;
      if (!r.ok) {
        const to = authRedirect(r.error);
        if (to) router.replace(to);
        else setError(r.error.status === 404 ? 'Not found.' : 'Could not load this item.');
        return;
      }
      setArt(r.data);
      const d = nextPollDelay(r.data.status);
      if (d !== null) timer = setTimeout(() => void run(), d);
    };
    void run();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, router]);

  const isTest = art?.type === 'practice_test' || art?.type === 'mock_exam';
  return (
    <div className="space-y-5">
      <p>
        <Link href="/learn/study" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          <span>Study</span>
        </Link>
      </p>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!art && !error && (
        <div className="space-y-3" role="status">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {art && (
        <>
          <h1 className="text-2xl font-bold">{art.title ?? 'Study item'}</h1>
          {art.status === 'generating' && <p className="text-sm text-muted-foreground" role="status">Generating…</p>}
          {art.status === 'failed' && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>Failed — try again from the Study page.</AlertDescription>
            </Alert>
          )}
          {art.status === 'ready' && art.notes && (
            <div className="flex flex-col gap-4">
              {art.notes.map((n, i) => (
                <Card key={i}>
                  <CardContent>
                    <section>
                      <h2 className="mb-2 text-lg font-semibold">{n.heading}</h2>
                      <div className={markdownClass}>
                        <Markdown>{n.bodyMarkdown}</Markdown>
                      </div>
                      <Citations citations={n.citations} />
                    </section>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {art.status === 'ready' && isTest && (
            <>
              <Card>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {allQuestions(art).length} questions
                    {art.durationMinutes ? ` · ${art.durationMinutes} minutes` : ''}
                  </p>
                  <Button asChild size="lg">
                    <Link href={`/learn/study/a/${art.id}/take`}>
                      <Play />
                      Start test
                    </Link>
                  </Button>
                </CardContent>
              </Card>
              {art.attempts.length > 0 && (
                <>
                  <h2 className="text-lg font-semibold">Your attempts</h2>
                  <ul className="flex flex-col gap-2">
                    {art.attempts.map((a) => (
                      <li key={a.id}>
                        <Link
                          className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm font-medium shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/50"
                          href={`/learn/study/attempt/${a.id}`}
                        >
                          <span>
                            {new Date(a.startedAt).toLocaleString()} ·{' '}
                            {a.status === 'graded' ? `${a.score} / ${a.maxScore}` : a.status.replace('_', ' ')}
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

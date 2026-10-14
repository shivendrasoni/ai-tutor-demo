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
import Tutu from '@/components/Tutu';
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
        <Link href="/learn/study" className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1.5 text-sm font-bold text-primary no-underline shadow-xs ring-1 ring-border hover:no-underline">
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
          <h1 className="text-3xl font-extrabold">{art.title ?? 'Study item'}</h1>
          {art.status === 'generating' && (
            <div className="flex flex-col items-center gap-2 rounded-[2rem] border bg-card p-8 text-center" role="status">
              <Tutu mood="thinking" className="anim-float size-28" />
              <p className="font-extrabold">Generating…</p>
              <p className="text-sm text-muted-foreground">Tutu is putting this together for you.</p>
            </div>
          )}
          {art.status === 'failed' && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>Failed — try again from the Study page.</AlertDescription>
            </Alert>
          )}
          {art.status === 'ready' && art.notes && (
            <div className="flex flex-col gap-4">
              {art.notes.map((n, i) => (
                <section key={i} className="anim-pop rounded-[2rem] border border-l-8 border-l-primary bg-card p-5 shadow-sm sm:p-6">
                  <h2 className="mb-2 text-xl font-extrabold">{n.heading}</h2>
                  <div className={markdownClass}>
                    <Markdown>{n.bodyMarkdown}</Markdown>
                  </div>
                  <Citations citations={n.citations} />
                </section>
              ))}
            </div>
          )}
          {art.status === 'ready' && isTest && (
            <>
              <div className="anim-pop flex flex-col items-center gap-4 rounded-[2rem] border bg-card p-6 text-center shadow-sm sm:flex-row sm:text-left">
                <Tutu mood="cheer" className="anim-float size-24 shrink-0" />
                <div className="flex-1">
                  <p className="text-xl font-extrabold">Ready when you are!</p>
                  <p className="font-bold text-muted-foreground">
                    {allQuestions(art).length} questions
                    {art.durationMinutes ? ` · ${art.durationMinutes} minutes` : ''}
                  </p>
                </div>
                <Button asChild size="lg" className="btn-chunky h-12 px-8 text-base">
                  <Link href={`/learn/study/a/${art.id}/take`}>
                    <Play />
                    Start test
                  </Link>
                </Button>
              </div>
              {art.attempts.length > 0 && (
                <>
                  <h2 className="text-lg font-extrabold">Your attempts</h2>
                  <ul className="flex flex-col gap-2">
                    {art.attempts.map((a) => (
                      <li key={a.id}>
                        <Link
                          className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 font-bold no-underline shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:no-underline hover:shadow-md"
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

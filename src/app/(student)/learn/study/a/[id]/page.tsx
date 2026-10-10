'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Markdown from 'react-markdown';
import Citations from '../../_lib/Citations';
import { allQuestions, authRedirect, studyFetch, type Artifact, type AttemptRow } from '../../_lib/api';
import { nextPollDelay } from '../../_lib/timing';
import styles from '../../study.module.css';

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
    <>
      <p className={styles.back}><Link href="/learn/study">← Study</Link></p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!art && !error && <p className={styles.hint} role="status">Loading…</p>}
      {art && (
        <>
          <h1 className={styles.title}>{art.title ?? 'Study item'}</h1>
          {art.status === 'generating' && <p className={styles.hint} role="status">Generating…</p>}
          {art.status === 'failed' && <p className={styles.error} role="alert">Failed — try again from the Study page.</p>}
          {art.status === 'ready' && art.notes && (
            <div className={styles.notes}>
              {art.notes.map((n, i) => (
                <section key={i} className={styles.note}>
                  <h2>{n.heading}</h2>
                  <Markdown>{n.bodyMarkdown}</Markdown>
                  <Citations citations={n.citations} />
                </section>
              ))}
            </div>
          )}
          {art.status === 'ready' && isTest && (
            <>
              <p className={styles.hint}>
                {allQuestions(art).length} questions
                {art.durationMinutes ? ` · ${art.durationMinutes} minutes` : ''}
              </p>
              <Link className={styles.primaryLink} href={`/learn/study/a/${art.id}/take`}>Start test</Link>
              {art.attempts.length > 0 && (
                <>
                  <h2 className={styles.sub}>Your attempts</h2>
                  <ul className={styles.list}>
                    {art.attempts.map((a) => (
                      <li key={a.id}>
                        <Link className={styles.itemLink} href={`/learn/study/attempt/${a.id}`}>
                          {new Date(a.startedAt).toLocaleString()} ·{' '}
                          {a.status === 'graded' ? `${a.score} / ${a.maxScore}` : a.status.replace('_', ' ')}
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
    </>
  );
}

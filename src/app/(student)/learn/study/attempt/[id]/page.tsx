'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Citations from '../../_lib/Citations';
import { authRedirect, studyFetch, type Attempt } from '../../_lib/api';
import { POLL_MS } from '../../_lib/timing';
import styles from '../../study.module.css';

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

  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!at) return <p className={styles.hint} role="status">Loading…</p>;

  const titles = at.artifact.chapterTitles;
  return (
    <>
      <p className={styles.back}><Link href={`/learn/study/a/${at.artifactId}`}>← {at.artifact.title ?? 'Back'}</Link></p>
      {at.status === 'in_progress' && (
        <>
          <p className={styles.hint}>This attempt is still in progress.</p>
          <Link className={styles.primaryLink} href={`/learn/study/a/${at.artifactId}/take`}>Start a new attempt</Link>
        </>
      )}
      {at.status === 'grading' && <p className={styles.hint} role="status">Grading…</p>}
      {at.status === 'graded' && (
        <>
          <h1 className={styles.title}>Graded</h1>
          <p className={styles.score}>{at.score} / {at.maxScore}</p>
          {at.byChapter && (
            <ul className={styles.list} aria-label="By chapter">
              {Object.entries(at.byChapter).map(([ch, v]) => (
                <li key={ch} className={styles.item}>{titles[ch] ?? 'Chapter'}: {v.scored} / {v.max}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {at.submittedAt && at.questions && (
        <ol className={styles.review}>
          {at.questions.map((q, i) => {
            const res = at.results?.[q.id];
            const ans = at.answers[q.id];
            return (
              <li key={q.id} className={styles.reviewItem}>
                <p className={styles.prompt}>{i + 1}. {q.prompt}</p>
                {res && <p className={styles.hint}>Score: {res.score} / {res.maxScore}</p>}
                <p className={styles.yours}>
                  Your answer:{' '}
                  {ans === undefined ? 'No answer' : q.options && typeof ans === 'number' ? (q.options[ans] ?? 'No answer') : String(ans)}
                </p>
                {res?.feedback && <p className={styles.feedback}>{res.feedback}</p>}
                {typeof q.correctIndex === 'number' && q.options && (
                  <p className={styles.correct}>Correct answer: {q.options[q.correctIndex]}</p>
                )}
                {q.modelAnswer && <p className={styles.correct}>Model answer: {q.modelAnswer}</p>}
                {res?.needsReview && <p className={styles.review2}>Needs review: this answer could not be graded automatically.</p>}
                <Citations citations={q.citations} />
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

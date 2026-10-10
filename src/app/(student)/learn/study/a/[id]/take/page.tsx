'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { allQuestions, authRedirect, studyFetch, type Artifact, type ViewQuestion } from '../../../_lib/api';
import { formatClock } from '../../../_lib/timing';
import { useAutosave } from '../../../_lib/useAutosave';
import { useCountdown } from '../../../_lib/useCountdown';
import styles from '../../../study.module.css';

type Answers = Record<string, number | string>;
type Started = { attemptId: string; deadline: string | null };

export default function TakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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
      const [a, s] = await Promise.all([
        studyFetch<Artifact>(`/api/study/artifacts/${id}`),
        studyFetch<Started>(`/api/study/artifacts/${id}/attempts`, { method: 'POST' }),
      ]);
      if (!a.ok || !s.ok) {
        const e = (!a.ok ? a : s) as { error: { status: number; code: string; message?: string } };
        const to = authRedirect(e.error);
        if (to) router.replace(to);
        else setError(e.error.message ?? 'Could not start this test.');
        return;
      }
      attemptRef.current = s.data.attemptId;
      // A resumed attempt keeps its saved answers.
      const prev = await studyFetch<{ answers: Answers }>(`/api/study/attempts/${s.data.attemptId}`);
      if (prev.ok) {
        answersRef.current = { ...prev.data.answers };
        setAnswers(answersRef.current);
      }
      setArt(a.data);
      setDeadline(s.data.deadline);
      setAttemptId(s.data.attemptId);
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
      <>
        <p className={styles.error} role="alert">{error}</p>
        <Link href={`/learn/study/a/${id}`}>Back</Link>
      </>
    );
  }
  if (!art) return <p className={styles.hint} role="status">Starting…</p>;

  const qs = allQuestions(art);
  const q = qs[index];
  if (!q) return <p className={styles.error} role="alert">This test has no questions.</p>;
  const cur = answers[q.id];

  return (
    <>
      <div className={styles.topbar}>
        <span className={styles.hint}>Question {index + 1} of {qs.length}</span>
        {left !== null && <span className={styles.timer} role="timer" aria-label="Time left">{formatClock(left)}</span>}
      </div>
      {expired && (
        <p className={styles.error} role="alert">
          Time is up. Your answers could not be saved. <Link href={`/learn/study/a/${id}`}>Back to the test</Link>
        </p>
      )}
      <ol className={styles.strip} aria-label="Questions">
        {qs.map((x, i) => (
          <li key={x.id}>
            <button
              type="button"
              className={i === index ? styles.dotOn : answers[x.id] !== undefined ? styles.dotDone : styles.dot}
              aria-label={`Question ${i + 1}`}
              aria-current={i === index ? 'step' : undefined}
              onClick={() => go(i)}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
      <section className={styles.question}>
        <p className={styles.prompt}>{q.prompt}</p>
        <p className={styles.hint}>{q.marks} mark{q.marks === 1 ? '' : 's'}</p>
        {q.type === 'mcq' && q.options ? (
          <fieldset className={styles.fieldset} disabled={expired}>
            <legend className={styles.legend}>Choose one</legend>
            {q.options.map((o, i) => (
              <label key={i} className={styles.check}>
                <input type="radio" name={`q-${q.id}`} checked={cur === i} onChange={() => setAnswer(q, i)} />
                {o}
              </label>
            ))}
          </fieldset>
        ) : (
          <textarea
            className={styles.textarea}
            aria-label="Your answer"
            rows={q.type === 'short' ? 4 : 8}
            maxLength={10000}
            disabled={expired}
            value={typeof cur === 'string' ? cur : ''}
            onChange={(e) => setAnswer(q, e.target.value)}
          />
        )}
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.nav}>
        <button type="button" className={styles.secondary} disabled={index === 0} onClick={() => go(index - 1)}>Previous</button>
        <button type="button" className={styles.secondary} disabled={index === qs.length - 1} onClick={() => go(index + 1)}>Next</button>
      </div>
      {!confirming ? (
        <button type="button" className={styles.primary} disabled={submitting || expired} onClick={() => setConfirming(true)}>Submit</button>
      ) : (
        <div className={styles.confirm} role="alertdialog" aria-label="Confirm submit">
          <p>Submit your answers? You cannot change them afterwards.</p>
          <button type="button" className={styles.primary} disabled={submitting} onClick={() => void submit(false)}>Yes, submit</button>
          <button type="button" className={styles.secondary} onClick={() => setConfirming(false)}>Keep working</button>
        </div>
      )}
    </>
  );
}

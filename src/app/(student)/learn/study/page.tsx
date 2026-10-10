'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  authRedirect, studyFetch, type ArtifactType, type Chapter, type Pattern, type Subject, type Summary,
} from './_lib/api';
import { nextPollDelay } from './_lib/timing';
import styles from './study.module.css';

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

  const load = useCallback(async (): Promise<Summary[] | null> => {
    const r = await studyFetch<Summary[]>(`/api/study/artifacts?type=${tab}`);
    if (r.ok) {
      setRows(r.data);
      return r.data;
    }
    const to = authRedirect(r.error);
    if (to) router.replace(to);
    else setError('Could not load your study items. Please try again.');
    return null;
  }, [tab, router]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(async () => {
    clearTimeout(timer.current);
    const data = await load();
    if (data?.some((a) => nextPollDelay(a.status) !== null)) timer.current = setTimeout(() => void refresh(), nextPollDelay('generating')!);
  }, [load]);

  useEffect(() => {
    setRows(null);
    setError('');
    void refresh();
    return () => clearTimeout(timer.current);
  }, [refresh]);

  const label = TABS.find((t) => t.type === tab)!.label;
  return (
    <>
      <h1 className={styles.title}>Study</h1>
      <div role="tablist" aria-label="Study tools" className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.type}
            role="tab"
            type="button"
            aria-selected={tab === t.type}
            className={tab === t.type ? styles.tabOn : styles.tab}
            onClick={() => setTab(t.type)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <section role="tabpanel" aria-label={label}>
        <CreateForm key={tab} type={tab} onCreated={() => void refresh()} onAuth={(to) => router.replace(to)} />
        {error && <p className={styles.error} role="alert">{error}</p>}
        {rows === null && !error && <p className={styles.hint} role="status">Loading…</p>}
        {rows?.length === 0 && <p className={styles.hint}>Nothing here yet. Create one above.</p>}
        {rows && rows.length > 0 && (
          <ul className={styles.list}>
            {rows.map((a) => (
              <li key={a.id} className={styles.item}>
                <div className={styles.itemMain}>
                  {a.status === 'ready' ? (
                    <Link className={styles.itemLink} href={`/learn/study/a/${a.id}`}>{a.title ?? label}</Link>
                  ) : (
                    <span>{a.title ?? label}</span>
                  )}
                  {a.status === 'ready' && a.bestScorePct !== null && (
                    <span className={styles.hint}>Best {Math.round(a.bestScorePct)}% · {a.attemptCount} attempt{a.attemptCount === 1 ? '' : 's'}</span>
                  )}
                </div>
                <span className={a.status === 'failed' ? styles.badgeBad : a.status === 'ready' ? styles.badgeOk : styles.badge}>{badge(a.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
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
    return <button type="button" className={styles.primary} onClick={() => setOpen(true)}>Create</button>;
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label htmlFor={ids.subject} className={styles.legend}>Subject</label>
        <select id={ids.subject} className={styles.select} value={subjectId} onChange={(e) => void pickSubject(e.target.value)}>
          <option value="">Choose a subject</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {chapters.length > 0 && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Chapters (up to {MAX_CHAPTERS})</legend>
          {chapters.map((c) => (
            <label key={c.id} className={styles.check}>
              <input type="checkbox" checked={picked.includes(c.id)} disabled={!picked.includes(c.id) && picked.length >= MAX_CHAPTERS} onChange={() => toggle(c.id)} />
              {c.title}
            </label>
          ))}
        </fieldset>
      )}
      {type === 'practice_test' && (
        <div className={styles.field}>
          <label htmlFor={ids.count} className={styles.legend}>Number of questions (5–30)</label>
          <input id={ids.count} className={styles.input} type="number" min={5} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </div>
      )}
      {type === 'mock_exam' && patterns.length > 0 && (
        <div className={styles.field}>
          <label htmlFor={ids.pattern} className={styles.legend}>Exam pattern</label>
          <select id={ids.pattern} className={styles.select} value={patternKey} onChange={(e) => setPatternKey(e.target.value)}>
            {patterns.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button type="submit" className={styles.primary} disabled={busy || !subjectId || picked.length === 0}>
        {busy ? 'Creating…' : 'Generate'}
      </button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

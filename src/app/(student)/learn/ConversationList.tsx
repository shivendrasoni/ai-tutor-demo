'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, GENERIC_ERROR, NETWORK_ERROR, type ApiError } from '@/app/(public)/_lib/api';
import styles from './learn.module.css';

type Conversation = { id: string; title: string | null; skillKey: string; subjectId: string | null; updatedAt: string };
type Skill = { id: string; key: string; name: string };
type Subject = { id: string; name: string };

/** 401 sends the student to /login and 403 (not an active student) to /status. Returns true when it redirected. */
function redirectOn(e: ApiError, replace: (href: string) => void): boolean {
  if (e.status === 401) replace('/login');
  else if (e.status === 403) replace('/status');
  else return false;
  return true;
}

export default function ConversationList() {
  const router = useRouter();
  const skillGroup = useId();
  const subjectId = useId();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [skillKey, setSkillKey] = useState('socratic');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [list, sk, sub] = await Promise.all([
        apiFetch<Conversation[]>('/api/tutor/conversations'),
        apiFetch<Skill[]>('/api/tutor/skills?kind=chat'),
        apiFetch<Subject[]>('/api/tutor/subjects'),
      ]);
      if (!live) return;
      for (const r of [list, sk, sub]) if (!r.ok && redirectOn(r.error, router.replace)) return;
      if (!list.ok) {
        setError(list.error.code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR);
        return;
      }
      setConversations(list.data);
      if (sk.ok) {
        setSkills(sk.data);
        setSkillKey((cur) => (sk.data.some((s) => s.key === cur) ? cur : (sk.data[0]?.key ?? cur)));
      }
      if (sub.ok) setSubjects(sub.data);
    })();
    return () => {
      live = false;
    };
  }, [router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await apiFetch<{ id: string }>('/api/tutor/conversations', {
      method: 'POST',
      body: { skillKey, ...(subject ? { subjectId: subject } : {}) },
    });
    if (r.ok) {
      router.push(`/learn/c/${r.data.id}`);
      return;
    }
    setBusy(false);
    if (redirectOn(r.error, router.replace)) return;
    setError(r.error.code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR);
  }

  return (
    <>
      <h1 className={styles.title}>Learn</h1>
      {!picking && (
        <button type="button" className={styles.primary} onClick={() => setPicking(true)}>
          New chat
        </button>
      )}
      {picking && (
        <form className={styles.picker} onSubmit={create}>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>How should the tutor help?</legend>
            {skills.map((s) => (
              <label key={s.id} className={styles.radio}>
                <input
                  type="radio"
                  name={skillGroup}
                  value={s.key}
                  checked={skillKey === s.key}
                  onChange={() => setSkillKey(s.key)}
                />
                {s.name}
              </label>
            ))}
          </fieldset>
          {subjects.length > 0 && (
            <div className={styles.field}>
              <label className={styles.legend} htmlFor={subjectId}>Subject (optional)</label>
              <select id={subjectId} className={styles.select} value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Any subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className={styles.primary} disabled={busy || skills.length === 0}>
            {busy ? 'Starting…' : 'Start chat'}
          </button>
          <button type="button" className={styles.secondary} onClick={() => setPicking(false)} disabled={busy}>
            Cancel
          </button>
        </form>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {conversations === null && !error && <p className={styles.hint} role="status">Loading…</p>}
      {conversations !== null && conversations.length === 0 && (
        <p className={styles.hint}>No chats yet. Start one above.</p>
      )}
      {conversations !== null && conversations.length > 0 && (
        <ul className={styles.list}>
          {conversations.map((c) => (
            <li key={c.id}>
              <Link className={styles.row} href={`/learn/c/${c.id}`}>
                {c.title ?? 'New chat'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

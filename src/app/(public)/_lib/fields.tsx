'use client';

import { useId, useRef, useState, type HTMLInputTypeAttribute, type ReactNode } from 'react';
import { apiFetch } from './api';
import { USERNAME_RULES_HINT, usernameCheckOutcome, type UsernameCheck } from './username';
import styles from '../public.module.css';

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
  hint?: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>{props.label}</label>
      <input
        id={id}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        required={props.required}
        maxLength={props.maxLength}
        aria-describedby={props.hint ? hintId : undefined}
      />
      {props.hint ? <p id={hintId} className={styles.hint}>{props.hint}</p> : null}
    </div>
  );
}

export function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextField
      label="Password"
      type="password"
      value={value}
      onChange={onChange}
      autoComplete="new-password"
      required
      maxLength={128}
      hint="8–128 characters."
    />
  );
}

/** Username input with an availability check on blur and clickable suggestions. */
export function UsernameField(props: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  onSuggestions: (s: string[]) => void;
}) {
  const { value, onChange, suggestions, onSuggestions } = props;
  const id = useId();
  const hintId = `${id}-hint`;
  const [hint, setHint] = useState('');
  // The username of the newest check ('' when none is wanted); older responses are dropped.
  const latest = useRef('');

  async function check() {
    const name = value.trim();
    latest.current = name;
    if (name === '') {
      setHint('');
      onSuggestions([]);
      return;
    }
    const r = await apiFetch<UsernameCheck>(`/api/join/username?u=${encodeURIComponent(name)}`);
    if (latest.current !== name) return;
    const outcome = usernameCheckOutcome(r);
    setHint(outcome.hint);
    onSuggestions(outcome.suggestions);
  }

  function edit(v: string) {
    latest.current = '';
    setHint('');
    if (suggestions.length > 0) onSuggestions([]);
    onChange(v);
  }

  function pick(s: string) {
    latest.current = s;
    onChange(s);
    setHint(`${s} is available.`);
    onSuggestions([]);
  }

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>Username</label>
      <input
        id={id}
        value={value}
        onChange={(e) => edit(e.target.value)}
        onBlur={check}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        maxLength={200}
        aria-describedby={hintId}
      />
      <p id={hintId} className={styles.hint} role="status">{hint || USERNAME_RULES_HINT}</p>
      {suggestions.length > 0 ? (
        <div className={styles.chips}>
          <span className={styles.hint}>Try one of these:</span>
          {suggestions.map((s) => (
            <button key={s} type="button" className={styles.chip} onClick={() => pick(s)}>{s}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

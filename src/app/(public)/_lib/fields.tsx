'use client';

import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import styles from '../public.module.css';
import { apiFetch, formatPrice, intervalLabel, type Plan } from './api';
import { usernameCheckOutcome, type UsernameCheck } from './username';

/** Loads active plans once; `error` is set when they couldn't be fetched. */
export function usePlans(): { plans: Plan[] | null; error: boolean } {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    void apiFetch<{ plans: Plan[] }>('/api/plans').then((r) => {
      if (!live) return;
      if (r.ok) setPlans(r.data.plans);
      else setError(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return { plans, error };
}

export function PlanPicker({
  plans, error, value, onChange,
}: { plans: Plan[] | null; error: boolean; value: string; onChange: (id: string) => void }) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Plan</legend>
      {error && <p className={styles.hint}>Plans couldn&apos;t be loaded. Refresh the page to try again.</p>}
      {!error && plans === null && <p className={styles.hint}>Loading plans…</p>}
      {plans?.length === 0 && <p className={styles.hint}>No plans are available right now. Please contact your school.</p>}
      {plans?.map((p) => (
        <label key={p.id} className={styles.radio}>
          <input
            type="radio"
            name="plan"
            value={p.id}
            checked={value === p.id}
            onChange={() => onChange(p.id)}
            required
          />
          <span>
            {p.name} — {formatPrice(p.priceMinor, p.currency)} {intervalLabel(p.interval)}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Username input with an availability check on blur. `suggestions` is controlled by the parent so that
 * a USERNAME_TAKEN response from submit can show them too; clicking one fills the field.
 */
export function UsernameField({
  value, onChange, suggestions, onSuggestions,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  onSuggestions: (s: string[]) => void;
}) {
  const id = useId();
  const [hint, setHint] = useState('');
  const latest = useRef('');

  async function check(raw: string) {
    const u = raw.trim();
    latest.current = u;
    if (!u) {
      setHint('');
      onSuggestions([]);
      return;
    }
    const r = await apiFetch<UsernameCheck>(`/api/join/username?u=${encodeURIComponent(u)}`);
    if (latest.current !== u) return; // a newer check superseded this one
    const outcome = usernameCheckOutcome(r);
    onSuggestions(outcome.suggestions);
    setHint(outcome.hint);
  }

  function pick(s: string) {
    onChange(s);
    onSuggestions([]);
    latest.current = s;
    setHint(`${s} is available.`);
  }

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>Username</label>
      <input
        id={id}
        className={styles.input}
        name="username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        maxLength={32}
        required
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          onChange(e.target.value);
          setHint('');
        }}
        onBlur={(e) => void check(e.target.value)}
      />
      <div id={`${id}-hint`} aria-live="polite">
        <p className={styles.hint}>{hint || 'Letters, numbers, _ or . (4–32 characters). Not case-sensitive.'}</p>
        {suggestions.length > 0 && (
          <>
            <p className={styles.hint}>Try one of these:</p>
            <div className={styles.chips}>
              {suggestions.map((s) => (
                <button key={s} type="button" className={styles.chip} onClick={() => pick(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function PasswordField({
  value, onChange, autoComplete,
}: { value: string; onChange: (v: string) => void; autoComplete: 'new-password' | 'current-password' }) {
  const id = useId();
  const isNew = autoComplete === 'new-password';
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>Password</label>
      <input
        id={id}
        className={styles.input}
        name="password"
        type="password"
        autoComplete={autoComplete}
        minLength={isNew ? 8 : undefined}
        maxLength={128}
        required
        value={value}
        aria-describedby={isNew ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {isNew && <p id={`${id}-hint`} className={styles.hint}>At least 8 characters.</p>}
    </div>
  );
}

export function TextField({
  label, value, onChange, required = true, ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'required' | 'id' | 'className'>) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        className={styles.input}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </div>
  );
}

/** Always-mounted live region so screen readers announce errors as they appear. */
export function ErrorRegion({ message }: { message: string }) {
  return (
    <div role="alert" aria-live="assertive" aria-atomic="true">
      {message && <p className={styles.error}>{message}</p>}
    </div>
  );
}

import type { ReactNode } from 'react';
import styles from './ui.module.css';

export function PageShell({ title, nav, children }: { title: string; nav?: ReactNode; children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>{title}</h1>
      {nav ? <nav className={styles.nav}>{nav}</nav> : null}
      {children}
    </main>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.card}>
      {title ? <h2 className={styles.cardTitle}>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

export function DataTable<T>({
  columns,
  rows,
  empty,
  rowKey,
}: {
  columns: { header: string; cell: (row: T) => ReactNode }[];
  rows: T[];
  empty: string;
  /** Stable per-row key; defaults to the row index. */
  rowKey?: (row: T) => string;
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c, ci) => (
              <th key={ci} scope="col">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : i}>
              {columns.map((c, ci) => (
                <td key={ci}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

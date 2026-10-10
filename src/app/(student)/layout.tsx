import type { ReactNode } from 'react';
import Link from 'next/link';
import styles from './learn/learn.module.css';

export const metadata = { title: 'Learn · AI Tutor for Schools' };

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="Student">
        <Link href="/learn">Learn</Link>
        <Link href="/learn/study">Study</Link>
      </nav>
      {children}
    </main>
  );
}

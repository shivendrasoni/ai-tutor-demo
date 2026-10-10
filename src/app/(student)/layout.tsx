import type { ReactNode } from 'react';
import Link from 'next/link';
import { requirePageActor } from '@/lib/guard';
import styles from './learn/learn.module.css';

export const metadata = { title: 'Learn · AI Tutor for Schools' };

export default async function StudentLayout({ children }: { children: ReactNode }) {
  await requirePageActor(['student']);
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

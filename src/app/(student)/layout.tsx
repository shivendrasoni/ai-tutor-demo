import type { ReactNode } from 'react';
import { requirePageActor } from '@/lib/guard';
import StudentNav from './_components/StudentNav';
import styles from './learn/learn.module.css';

export const metadata = { title: 'Learn · AI Tutor for Schools' };

export default async function StudentLayout({ children }: { children: ReactNode }) {
  await requirePageActor(['student']);
  return (
    <main className={styles.shell}>
      <StudentNav />
      {children}
    </main>
  );
}

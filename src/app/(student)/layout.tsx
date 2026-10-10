import type { ReactNode } from 'react';
import styles from './learn/learn.module.css';

export const metadata = { title: 'Learn · AI Tutor for Schools' };

export default function StudentLayout({ children }: { children: ReactNode }) {
  return <main className={styles.shell}>{children}</main>;
}

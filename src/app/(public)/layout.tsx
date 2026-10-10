import type { ReactNode } from 'react';
import styles from './public.module.css';

export const metadata = { title: 'AI Tutor for Schools' };

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <main className={styles.shell}>{children}</main>;
}

import type { ReactNode } from 'react';
import styles from './public.module.css';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <main className={styles.shell}>{children}</main>;
}

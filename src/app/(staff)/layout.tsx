import type { ReactNode } from 'react';
import styles from './staff.module.css';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <main className={styles.shell}>{children}</main>;
}

import Link from 'next/link';
import LogoutButton from '@/app/ui/LogoutButton';
import styles from '../learn/learn.module.css';

export default function StudentNav() {
  return (
    <nav className={styles.nav} aria-label="Student">
      <Link href="/learn">Learn</Link>
      <Link href="/learn/study">Study</Link>
      <LogoutButton />
    </nav>
  );
}

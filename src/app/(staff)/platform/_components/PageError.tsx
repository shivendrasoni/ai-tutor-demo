import { notFound } from 'next/navigation';
import NotAllowed from '../../_components/NotAllowed';
import PlatformNav from './PlatformNav';
import styles from '../../staff.module.css';
import { EmptyState } from '@/app/ui/components';
import { DomainError } from '@/lib/errors';

/** Maps a loader error to a page body; unknown errors are rethrown. */
export function pageError(title: string, e: unknown) {
  if (e instanceof DomainError && e.code === 'FORBIDDEN') return <NotAllowed />;
  if (e instanceof DomainError && e.code === 'NOT_FOUND') notFound();
  if (e instanceof DomainError && e.code === 'VALIDATION') {
    return (
      <>
        <h1 className={styles.title}>{title}</h1>
        <PlatformNav />
        <EmptyState>{e.message}</EmptyState>
      </>
    );
  }
  throw e;
}

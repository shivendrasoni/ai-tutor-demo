import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/http';
import { resolveActor } from '@/modules/tenancy';
import StaffHeader from './_components/StaffHeader';
import { staffLinks } from './_lib/links';
import styles from './staff.module.css';

// Pages guard themselves; the header only renders when there is a session.
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const actor = await resolveActor((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <main className={styles.shell}>
      {actor ? <StaffHeader links={staffLinks(actor)} /> : null}
      {children}
    </main>
  );
}

import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/http';
import { resolveActor } from '@/modules/tenancy';
import StaffHeader from './_components/StaffHeader';
import { staffLinks } from './_lib/links';

// Pages guard themselves; the header only renders when there is a session.
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const actor = await resolveActor((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <div className="min-h-svh bg-background">
      {actor ? <StaffHeader links={staffLinks(actor)} /> : null}
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

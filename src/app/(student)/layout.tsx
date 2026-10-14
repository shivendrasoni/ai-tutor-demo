import type { ReactNode } from 'react';
import { requirePageActor } from '@/lib/guard';
import { bandFor } from '@/lib/student-band';
import { studentIdentity } from '@/modules/enrollment';
import { StudentProvider } from './_components/StudentContext';
import StudentNav from './_components/StudentNav';

export const metadata = { title: 'Learn · AI Tutor for Schools' };

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const actor = await requirePageActor(['student']);
  const me = await studentIdentity(actor).catch(() => null);
  return (
    <div className="student-theme student-backdrop min-h-svh" data-band={bandFor(me?.grade)}>
      <StudentProvider name={me?.name ?? ''} grade={me?.grade ?? null}>
        <StudentNav />
        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:pb-10 sm:pt-8">{children}</main>
      </StudentProvider>
    </div>
  );
}

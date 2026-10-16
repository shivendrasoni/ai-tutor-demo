'use client';
import type { ReactNode } from 'react';
import { useCurrentUser } from '@/demo/core/useCurrentUser';
import { bandFor } from '@/lib/student-band';
import { StudentProvider } from './_components/StudentContext';
import StudentNav from './_components/StudentNav';

export default function StudentLayout({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();
  return (
    <div className="student-theme student-backdrop min-h-svh" data-band={bandFor(user?.grade)}>
      <StudentProvider name={user?.name ?? ''} grade={user?.grade ?? null}>
        <StudentNav />
        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:pb-10 sm:pt-8">{children}</main>
      </StudentProvider>
    </div>
  );
}

import type { ReactNode } from 'react';
import { requirePageActor } from '@/lib/guard';
import StudentNav from './_components/StudentNav';

export const metadata = { title: 'Learn · AI Tutor for Schools' };

export default async function StudentLayout({ children }: { children: ReactNode }) {
  await requirePageActor(['student']);
  return (
    <div className="min-h-svh bg-gradient-to-b from-accent/40 to-background">
      <StudentNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}

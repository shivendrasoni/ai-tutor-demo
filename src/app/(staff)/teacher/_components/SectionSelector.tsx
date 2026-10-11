import Link from 'next/link';
import { Card, EmptyState } from '@/app/ui/components';
import { cn } from '@/lib/utils';
import type { TeacherAssignment } from '@/modules/analytics';

export default function SectionSelector({
  assignments, selected,
}: {
  assignments: TeacherAssignment[];
  selected: { sectionId: string; subjectId: string } | null;
}) {
  if (assignments.length === 0) {
    return <Card title="Your classes"><EmptyState>No classes assigned yet</EmptyState></Card>;
  }
  return (
    <Card title="Your classes">
      <ul className="flex flex-wrap gap-2">
        {assignments.map((a) => {
          const on = selected?.sectionId === a.sectionId && selected.subjectId === a.subjectId;
          const href = `/teacher?sectionId=${encodeURIComponent(a.sectionId)}&subjectId=${encodeURIComponent(a.subjectId)}`;
          return (
            <li key={`${a.sectionId}:${a.subjectId}`}>
              <Link
                href={href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-accent',
                  on && 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                {on ? <strong>{a.sectionName} · {a.subjectName}</strong> : `${a.sectionName} · ${a.subjectName}`}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

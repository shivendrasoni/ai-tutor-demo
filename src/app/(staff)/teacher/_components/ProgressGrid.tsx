import { Badge, Card, EmptyState } from '@/app/ui/components';
import { pct } from '@/app/ui/format';
import { cn } from '@/lib/utils';
import type { SectionProgress } from '@/modules/analytics';

function cellTone(ratio: number | null) {
  if (ratio === null) return 'text-muted-foreground';
  if (ratio >= 0.75) return 'bg-success/15 font-medium text-success';
  if (ratio >= 0.5) return 'bg-warning/20 font-medium text-amber-700 dark:text-warning';
  return 'bg-destructive/15 font-medium text-destructive';
}

export default function ProgressGrid({ data }: { data: SectionProgress }) {
  if (data.students.length === 0) {
    return <Card title="Progress"><EmptyState>No students in this section yet</EmptyState></Card>;
  }
  if (data.chapters.length === 0) {
    return <Card title="Progress"><EmptyState>No chapters available for this subject yet</EmptyState></Card>;
  }
  return (
    <Card title="Progress">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full caption-bottom text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Student</th>
              {data.chapters.map((c) => (
                <th key={c.chapterId} scope="col" data-weak={c.weak ? 'true' : undefined}
                  className="px-3 py-2 text-left align-bottom font-medium">
                  {c.weak ? <Badge tone="warn">{c.title}</Badge> : c.title}
                  <div className="text-xs font-normal text-muted-foreground">{pct(c.avgRatio)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.studentId} className="border-t">
                <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">{s.name}</th>
                {s.chapters.map((c) => (
                  <td key={c.chapterId} className={cn('px-3 py-2 text-center tabular-nums', cellTone(c.ratio))}>
                    {pct(c.ratio)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

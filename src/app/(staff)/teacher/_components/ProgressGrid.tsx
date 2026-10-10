import { Badge, Card, EmptyState } from '@/app/ui/components';
import { pct } from '@/app/ui/format';
import styles from '@/app/ui/ui.module.css';
import type { SectionProgress } from '@/modules/analytics';

export default function ProgressGrid({ data }: { data: SectionProgress }) {
  if (data.students.length === 0) {
    return <Card title="Progress"><EmptyState>No students in this section yet</EmptyState></Card>;
  }
  if (data.chapters.length === 0) {
    return <Card title="Progress"><EmptyState>No chapters available for this subject yet</EmptyState></Card>;
  }
  return (
    <Card title="Progress">
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Student</th>
              {data.chapters.map((c) => (
                <th key={c.chapterId} scope="col" data-weak={c.weak ? 'true' : undefined}>
                  {c.weak ? <Badge tone="warn">{c.title}</Badge> : c.title}
                  <div>{pct(c.avgRatio)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.studentId}>
                <th scope="row">{s.name}</th>
                {s.chapters.map((c) => <td key={c.chapterId}>{pct(c.ratio)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

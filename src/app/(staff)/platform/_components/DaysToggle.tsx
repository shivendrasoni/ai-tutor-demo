import Link from 'next/link';

export default function DaysToggle({ base, days }: { base: string; days: 7 | 30 }) {
  return (
    <p>
      Window:{' '}
      {([7, 30] as const).map((d) => (
        <span key={d}>
          {d === days ? <strong>Last {d} days</strong> : <Link href={`${base}?days=${d}`}>Last {d} days</Link>}{' '}
        </span>
      ))}
    </p>
  );
}

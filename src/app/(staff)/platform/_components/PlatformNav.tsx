import Link from 'next/link';

const LINKS = [
  ['/platform', 'Overview'], ['/platform/payments', 'Payments'], ['/platform/schools', 'Schools'], ['/platform/plans', 'Plans'],
  ['/platform/flags', 'Flags'], ['/platform/costs', 'Costs'], ['/platform/routing', 'Routing'], ['/school/content', 'Content'],
] as const;

export default function PlatformNav() {
  return (
    <nav aria-label="Platform" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', margin: '0 0 20px' }}>
      {LINKS.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
    </nav>
  );
}

import Link from 'next/link';
import LogoutButton from '@/app/ui/LogoutButton';
import type { StaffLink } from '../_lib/links';

export default function StaffHeader({ links }: { links: StaffLink[] }) {
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', margin: '0 0 16px' }}>
      <nav aria-label="Account" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', flex: 1 }}>
        {links.map((l) => <Link key={l.label} href={l.href}>{l.label}</Link>)}
      </nav>
      <LogoutButton />
    </header>
  );
}

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/modules/tenancy';
import { staffLinks } from '@/app/(staff)/_lib/links';
import StaffHeader from '@/app/(staff)/_components/StaffHeader';
import StudentNav from '@/app/(student)/_components/StudentNav';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/learn' }));

const actor = (o: Partial<Actor>): Actor => ({ userId: 'u', isPlatformAdmin: false, schoolId: 's', branchId: null, roles: [], ...o });

describe('staff header', () => {
  it('Home points at the actor home; admin+teacher gets both links', () => {
    expect(staffLinks(actor({ roles: ['teacher'] }))).toEqual([{ href: '/teacher', label: 'Home' }]);
    expect(staffLinks(actor({ isPlatformAdmin: true, schoolId: null }))).toEqual([{ href: '/platform', label: 'Home' }]);
    expect(staffLinks(actor({ roles: ['school_admin', 'teacher'] }))).toEqual([
      { href: '/school', label: 'Home' }, { href: '/school', label: 'School' }, { href: '/teacher', label: 'Teacher' },
    ]);
  });
  it('renders links and a Log out button', () => {
    const html = renderToStaticMarkup(<StaffHeader links={staffLinks(actor({ roles: ['school_admin', 'teacher'] }))} />);
    expect(html).toContain('href="/teacher"');
    expect(html).toContain('Log out');
  });
  it('student nav has Log out', () => {
    expect(renderToStaticMarkup(<StudentNav />)).toContain('Log out');
  });
});

import { BookOpen, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';
import LogoutButton from '@/app/ui/LogoutButton';

const link = 'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground hover:no-underline';

export default function StudentNav() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Brand href="/learn" />
        <nav className="flex flex-1 items-center gap-1" aria-label="Student">
          <Link href="/learn" className={link}><MessageCircle className="size-4" />Learn</Link>
          <Link href="/learn/study" className={link}><BookOpen className="size-4" />Study</Link>
        </nav>
        <ThemeToggle />
        <LogoutButton />
      </div>
    </header>
  );
}

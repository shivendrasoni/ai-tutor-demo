import { GraduationCap } from 'lucide-react';
import Link from 'next/link';

export default function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight text-foreground no-underline hover:no-underline">
      <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <GraduationCap className="size-5" />
      </span>
      <span>AI Tutor</span>
    </Link>
  );
}

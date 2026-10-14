import Link from 'next/link';
import Tutu from '@/components/Tutu';

export default function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-extrabold tracking-tight text-foreground no-underline hover:no-underline">
      <span className="grid size-9 place-items-center rounded-2xl bg-accent">
        <Tutu className="size-8" />
      </span>
      <span>AI Tutor</span>
    </Link>
  );
}

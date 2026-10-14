import { cn } from '@/lib/utils';

/** Circular score ring. Decorative; the numeric score is rendered as text next to it. */
export function ScoreRing({ pct, className }: { pct: number; className?: string }) {
  const r = 52;
  const full = 2 * Math.PI * r;
  const to = full * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const tone = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--primary)' : 'var(--coral)';
  return (
    <svg viewBox="0 0 120 120" aria-hidden focusable="false" className={cn('size-36', className)}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--muted)" strokeWidth="12" />
      <circle
        cx="60" cy="60" r={r} fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={full} strokeDashoffset={to} transform="rotate(-90 60 60)" className="ring-arc"
        style={{ ['--ring-full' as string]: full, ['--ring-to' as string]: to }}
      />
      <text x="60" y="68" textAnchor="middle" fontSize="26" fontWeight="800" fill="var(--foreground)">{Math.round(pct)}%</text>
    </svg>
  );
}

const COLORS = ['var(--primary)', 'var(--sun)', 'var(--coral)', 'var(--mint)', 'var(--sky)', 'var(--grape)'];

/** CSS-only confetti burst; hidden entirely under prefers-reduced-motion. */
export function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: `${(i * 37) % 100}%`,
            background: COLORS[i % COLORS.length],
            animationDelay: `${(i % 7) * 120}ms`,
            animationDuration: `${2.2 + (i % 5) * 0.3}s`,
          }}
        />
      ))}
    </div>
  );
}

import { cn } from '@/lib/utils';

export type TutuMood = 'happy' | 'thinking' | 'cheer';

/** Tutu, the tutor's owl mascot. Decorative: always aria-hidden, so it never changes accessible names. */
export default function Tutu({ mood = 'happy', className }: { mood?: TutuMood; className?: string }) {
  const lookUp = mood === 'thinking';
  return (
    <svg viewBox="0 0 120 120" aria-hidden focusable="false" className={cn('size-24', className)}>
      {/* wings, raised when cheering */}
      <ellipse cx="22" cy={mood === 'cheer' ? 52 : 74} rx="11" ry="22" fill="var(--primary)" transform={`rotate(${mood === 'cheer' ? 28 : -10} 22 ${mood === 'cheer' ? 52 : 74})`} opacity=".85" />
      <ellipse cx="98" cy={mood === 'cheer' ? 52 : 74} rx="11" ry="22" fill="var(--primary)" transform={`rotate(${mood === 'cheer' ? -28 : 10} 98 ${mood === 'cheer' ? 52 : 74})`} opacity=".85" />
      {/* feet */}
      <ellipse cx="46" cy="108" rx="10" ry="5" fill="var(--sun)" />
      <ellipse cx="74" cy="108" rx="10" ry="5" fill="var(--sun)" />
      {/* body + ear tufts */}
      <path d="M26 30 L36 14 L48 28 Z" fill="var(--primary)" />
      <path d="M94 30 L84 14 L72 28 Z" fill="var(--primary)" />
      <ellipse cx="60" cy="66" rx="40" ry="42" fill="var(--primary)" />
      <ellipse cx="60" cy="80" rx="26" ry="26" fill="oklch(0.97 0.03 285)" />
      {/* eyes */}
      <circle cx="44" cy="50" r="15" fill="#fff" />
      <circle cx="76" cy="50" r="15" fill="#fff" />
      {mood === 'cheer' ? (
        <>
          <path d="M36 52 Q44 42 52 52" stroke="oklch(0.25 0.05 285)" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M68 52 Q76 42 84 52" stroke="oklch(0.25 0.05 285)" strokeWidth="4" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx={lookUp ? 47 : 45} cy={lookUp ? 46 : 51} r="7" fill="oklch(0.25 0.05 285)" />
          <circle cx={lookUp ? 79 : 77} cy={lookUp ? 46 : 51} r="7" fill="oklch(0.25 0.05 285)" />
          <circle cx={lookUp ? 49 : 47} cy={lookUp ? 43 : 48} r="2.4" fill="#fff" />
          <circle cx={lookUp ? 81 : 79} cy={lookUp ? 43 : 48} r="2.4" fill="#fff" />
        </>
      )}
      {lookUp && <path d="M30 32 Q42 26 54 33" stroke="oklch(0.25 0.05 285)" strokeWidth="3.5" fill="none" strokeLinecap="round" />}
      {/* beak + cheeks */}
      <path d="M54 62 L66 62 L60 74 Z" fill="var(--sun)" />
      <circle cx="32" cy="66" r="5" fill="var(--coral)" opacity=".55" />
      <circle cx="88" cy="66" r="5" fill="var(--coral)" opacity=".55" />
    </svg>
  );
}

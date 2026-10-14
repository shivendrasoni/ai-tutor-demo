/** Age-appropriate presentation for the student area. Grades 1-12 map to three bands. */
export type Band = 'junior' | 'middle' | 'senior';

export function bandFor(grade: number | null | undefined): Band {
  if (typeof grade !== 'number' || grade < 1 || grade > 12) return 'middle';
  return grade <= 5 ? 'junior' : grade <= 8 ? 'middle' : 'senior';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there';
}

export function greeting(band: Band, name: string, hour: number): string {
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  if (band === 'junior') return `Hi ${name}! 👋`;
  if (band === 'middle') return `Good ${part}, ${name}!`;
  return `Good ${part}, ${name}.`;
}

export function tagline(band: Band): string {
  if (band === 'junior') return 'What do you want to learn today?';
  if (band === 'middle') return 'Ask me anything. Let’s figure it out together.';
  return 'What are you working on today?';
}

export function resultMessage(band: Band, pct: number): string {
  const junior = band === 'junior';
  if (pct >= 100) return junior ? 'Perfect score! You are a superstar! 🌟' : 'Perfect score. Outstanding work!';
  if (pct >= 80) return junior ? 'Amazing job! You really know this! 🎉' : 'Excellent work. You clearly know this material.';
  if (pct >= 50) return junior ? 'Good going! A little more practice and you’ll be a pro! 💪' : 'Good effort. A bit more practice on the tricky parts will lift this.';
  return junior
    ? 'Nice try! Let’s practice some more together. 🌱'
    : 'This is a good start. Review the answers below, then try again to improve.';
}

const DAY = 86_400_000;
const dayKey = (t: number) => Math.floor(t / DAY);

/** Consecutive active days. A streak stays alive until the end of the day after the last activity. */
export function dayStreak(times: number[], now: number): number {
  const days = new Set(times.filter(Number.isFinite).map(dayKey));
  const today = dayKey(now);
  let d = days.has(today) ? today : today - 1;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

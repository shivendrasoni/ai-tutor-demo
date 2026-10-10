'use client';

import { useEffect, useState } from 'react';
import { secondsLeft } from './timing';

/** Seconds remaining until `deadline` (ISO), ticking each second; null when there is no deadline. */
export function useCountdown(deadline: string | null): number | null {
  const [left, setLeft] = useState<number | null>(() => (deadline ? secondsLeft(deadline, Date.now()) : null));
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setLeft(secondsLeft(deadline, Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return left;
}

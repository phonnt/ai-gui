import { useEffect, useState } from 'react';

/**
 * Honest aliveness signal for the model's silent thinking phase: the seconds
 * since the turn started, refreshed once a second. Shared by the live turn
 * (`TurnBlock`) and the pre-first-token placeholder (`Transcript`), which used
 * to carry byte-identical copies.
 */
export function ThinkingElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span> · {Math.max(0, Math.round((now - since) / 1000))}s</span>;
}

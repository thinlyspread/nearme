import { useEffect } from 'react';

export function useConfetti(trigger) {
  useEffect(() => {
    if (!trigger) return;

    let cancelled = false;

    import('canvas-confetti').then(mod => {
      if (cancelled) return;
      const confetti = mod.default;

      // Initial burst
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });

      // Side cannons after a beat
      setTimeout(() => {
        if (cancelled) return;
        confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } });
      }, 300);
    });

    return () => { cancelled = true; };
  }, [trigger]);
}

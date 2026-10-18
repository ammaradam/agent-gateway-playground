import { useCallback, useEffect, useRef, useState } from 'react';

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A clock for replaying a trace. `total` is the display length in ms. */
export function usePlayback(total: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      setT(prev => {
        const next = prev + dt * speed;
        if (next >= total) { setPlaying(false); return total; }
        return next;
      });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, total]);

  const play = useCallback(() => { setT(prev => (prev >= total ? 0 : prev)); setPlaying(true); }, [total]);
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback((v: number) => { setPlaying(false); setT(Math.max(0, Math.min(total, v))); }, [total]);
  const restart = useCallback((auto: boolean) => { setT(0); setPlaying(auto); }, []);

  return { t, playing, speed, setSpeed, play, pause, seek, restart };
}

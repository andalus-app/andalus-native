import { useEffect, useRef, useState } from 'react';

export function useCurrentMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());

    // Align first tick to the next minute boundary, then tick every 60 s.
    const timeout = setTimeout(() => {
      tick();
      intervalRef.current = setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000));

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return now;
}

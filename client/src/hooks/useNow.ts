import { useEffect, useState } from "react";

// Ticks a `Date` at the given interval so countdown/relative-time displays
// (session open/close, visitor pass expiry) update live instead of only on
// the next unrelated re-render.
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

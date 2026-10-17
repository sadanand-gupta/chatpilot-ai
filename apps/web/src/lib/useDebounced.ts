import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** 'YYYY-MM-DD' (local) -> ISO at start/end of that local day. */
export function dayBoundaryIso(day: string, edge: 'start' | 'end'): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T${edge === 'start' ? '00:00:00' : '23:59:59.999'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

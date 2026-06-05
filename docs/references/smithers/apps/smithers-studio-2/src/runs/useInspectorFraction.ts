import { useCallback, useState } from "react";

const STORAGE_KEY = "liverun.layout.inspectorFraction";
const DEFAULT_FRACTION = 0.46;

function readFraction(): number {
  if (typeof localStorage === "undefined") return DEFAULT_FRACTION;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_FRACTION;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_FRACTION;
}

/**
 * Persisted inspector-pane fraction for the wide split layout. The fraction is
 * the inspector's share of total width; the divider drag writes through to
 * localStorage so the split survives reloads. Default 0.46 per UX.md.
 */
export function useInspectorFraction() {
  const [fraction, setFractionState] = useState<number>(readFraction);

  const setFraction = useCallback((next: number) => {
    setFractionState(next);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(next));
    }
  }, []);

  return [fraction, setFraction] as const;
}

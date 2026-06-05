import { useCallback, useState } from "react";

function storageKey(sectionId: string): string {
  return `sidebar.section.${sectionId}.expanded`;
}

/**
 * Persisted collapse/expand state for a sidebar section, keyed by
 * `sidebar.section.<id>.expanded` in localStorage (@AppStorage parity; stable
 * keys for the phase-2 Electrobun migration). `defaultExpanded` applies only
 * when no value has been persisted yet.
 */
export function useSidebarSectionExpansion(
  sectionId: string,
  defaultExpanded: boolean,
): readonly [boolean, () => void] {
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return defaultExpanded;
    const stored = localStorage.getItem(storageKey(sectionId));
    return stored === null ? defaultExpanded : stored === "true";
  });

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey(sectionId), next ? "true" : "false");
      }
      return next;
    });
  }, [sectionId]);

  return [expanded, toggle] as const;
}

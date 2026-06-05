import { useEffect, useState, type RefObject } from "react";

/**
 * Track an element's pixel width via ResizeObserver. The live-run layout reads
 * this to decide WIDE vs NARROW (breakpoint 800px) rather than the window
 * width, so the split collapses correctly when the surface itself is narrow.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

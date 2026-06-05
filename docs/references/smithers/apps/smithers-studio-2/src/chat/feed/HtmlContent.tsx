import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Renders the agent's HTML tool output. The agent is encouraged to emit rich
 * HTML to show data; we render it in a sandboxed iframe that auto-sizes to its
 * content. `sandbox="allow-same-origin"` (no `allow-scripts`) keeps scripts
 * disabled — so agent/LLM markup can't execute — while still letting the parent
 * measure the document height to fit the bubble.
 */
export function HtmlContent({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);

  const srcDoc = useMemo(() => wrapDocument(html), [html]);

  const fit = useCallback(() => {
    const body = ref.current?.contentWindow?.document?.body;
    if (body) setHeight(body.scrollHeight);
  }, []);

  return (
    <iframe
      className="chat-html"
      data-testid="chat-html"
      onLoad={fit}
      ref={ref}
      sandbox="allow-same-origin allow-popups"
      srcDoc={srcDoc}
      style={{ height: height ? `${height}px` : undefined }}
      title="Agent HTML"
    />
  );
}

/** Wrap fragment HTML in a minimal dark document with safe link behavior. */
function wrapDocument(html: string): string {
  return `<!doctype html><html><head><base target="_blank">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; background: transparent;
    color: rgba(255,255,255,0.88);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px; }
  a { color: #4C8DFF; }
</style></head><body>${html}</body></html>`;
}

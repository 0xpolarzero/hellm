/**
 * Renders an arbitrary website in an isolated iframe. The agent has access to
 * this site via a tool call (the agent-browse seam); here we just present it.
 * Sandboxed to scripts + same-origin so normal sites work but top-level
 * navigation of the Studio itself is blocked.
 */
export function IframeOverlay({ url }: { url: string }) {
  return (
    <iframe
      className="overlay-iframe"
      data-testid="overlay-iframe"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      src={url}
      title={url}
    />
  );
}

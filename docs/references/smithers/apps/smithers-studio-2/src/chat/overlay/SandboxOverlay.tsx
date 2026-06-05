/**
 * Renders a sandbox (e.g. a JJHub blue sandbox) in an iframe. SEAM: the URL is
 * a stand-in until sandbox provisioning is wired; the renderer stays the same.
 */
export function SandboxOverlay({ url }: { url: string }) {
  return (
    <iframe
      className="overlay-iframe"
      data-testid="overlay-sandbox"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      src={url}
      title="Sandbox"
    />
  );
}

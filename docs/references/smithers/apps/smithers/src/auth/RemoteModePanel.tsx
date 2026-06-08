import { useState } from "react";
import { useGatewayStore } from "../gateway/gatewayStore";
import { useAuthStore } from "./authStore";

export function RemoteModePanel() {
  const gatewayBaseUrl = useAuthStore((state) => state.gatewayBaseUrl);
  const setGatewayBaseUrl = useAuthStore((state) => state.setGatewayBaseUrl);
  const authStatus = useAuthStore((state) => state.status);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const resetGateway = useGatewayStore((state) => state.reset);
  const ensureConnected = useGatewayStore((state) => state.ensureConnected);
  const [draft, setDraft] = useState(gatewayBaseUrl);

  const apply = () => {
    setGatewayBaseUrl(draft);
    resetGateway();
    ensureConnected();
  };

  return (
    <section className="remote-panel" data-testid="remote-panel">
      <div>
        <h2>Remote</h2>
        <p>
          {gatewayBaseUrl
            ? "Gateway requests use the configured remote origin."
            : "Same-origin gateway proxy is active when the deployment provides one."}
        </p>
      </div>
      <div className="remote-controls">
        <input
          aria-label="Gateway URL"
          placeholder="https://gateway.example.com"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <button type="button" onClick={apply}>
          Apply
        </button>
      </div>
      <div className="remote-meta">
        <span>auth: {authStatus}</span>
        <span>gateway: {gatewayStatus}</span>
      </div>
    </section>
  );
}

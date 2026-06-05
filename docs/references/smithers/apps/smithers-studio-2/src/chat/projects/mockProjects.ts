import type { Project } from "./Project";

/**
 * SEAM: stand-in project list until the control-plane projects RPC is wired.
 * Colors are hand-picked to read well on the dark theme and stay distinct.
 */
export const mockProjects: Project[] = [
  { id: "acme-web", name: "acme-web", color: "#4C8DFF" },
  { id: "payments", name: "payments-api", color: "#34D399" },
  { id: "infra", name: "platform-infra", color: "#FBBF24" },
  { id: "mobile", name: "mobile-app", color: "#C084FC" },
];

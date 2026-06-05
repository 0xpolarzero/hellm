/**
 * A project the agent works in. Each project gets its own color so the chrome
 * (project chip, tag accents) is instantly identifiable. SEAM: today these come
 * from `mockProjects`; later from the control-plane projects RPC.
 */
export type Project = {
  id: string;
  name: string;
  /** Hex/CSS color used as the project accent throughout the chat shell. */
  color: string;
};

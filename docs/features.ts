export type FeatureStatus = "shipped" | "in-progress";

export interface ProductFeature {
  id: string;
  name: string;
  status: FeatureStatus;
  summary: string;
  sourceSpecs: string[];
}

export const PRODUCT_FEATURES: ProductFeature[] = [
  {
    id: "desktop-shell",
    name: "Electrobun Desktop Shell",
    status: "shipped",
    summary:
      "Runs hellm as a native desktop coding app with a Bun-side pi host and renderer shell.",
    sourceSpecs: ["/Users/polarzero/code/projects/hellm/docs/prd.md"],
  },
  {
    id: "provider-auth",
    name: "Provider Auth And Settings",
    status: "shipped",
    summary: "Manages provider keys and OAuth-backed access through the desktop settings surface.",
    sourceSpecs: ["/Users/polarzero/code/projects/hellm/docs/prd.md"],
  },
  {
    id: "artifacts-panel",
    name: "Artifacts Projection",
    status: "shipped",
    summary:
      "Reconstructs generated artifacts from the transcript and presents them in a docked preview panel.",
    sourceSpecs: ["/Users/polarzero/code/projects/hellm/docs/prd.md"],
  },
  {
    id: "prompt-history",
    name: "Workspace Prompt History",
    status: "shipped",
    summary:
      "Stores successful user prompts per workspace and exposes shell-like recall in the composer.",
    sourceSpecs: ["/Users/polarzero/code/projects/hellm/docs/specs/prompt-history.spec.md"],
  },
  {
    id: "multi-session-support",
    name: "Multi-Session Workspace Navigation",
    status: "shipped",
    summary:
      "Supports creating, listing, switching, renaming, forking, and deleting multiple pi-backed sessions from one workspace window.",
    sourceSpecs: ["/Users/polarzero/code/projects/hellm/docs/specs/multi-session-support.spec.md"],
  },
  {
    id: "workflow-inspector",
    name: "Workflow Inspector Surface",
    status: "in-progress",
    summary:
      "Provides a read-only live graph inspector for delegated workflow runs, with node drill-down and pane-based inspection.",
    sourceSpecs: ["/Users/polarzero/code/projects/hellm/docs/prd.md"],
  },
];

import type { View } from "../app/routeStore";
import type { Surface } from "../app/Surface";
import { STORE_WORKFLOWS, type StoreWorkflow } from "../store/workflows";
import type { App, AppId } from "./App";

/**
 * The static app catalog. Each entry promotes an existing domain surface (or the
 * store view) to a first-class app with a dock icon and a set of attachable
 * workflows. `workflowIds` is the app side of the app↔workflow many-to-many; the
 * ids match `STORE_WORKFLOWS`. See `.smithers/specs/apps-and-workflows-dock.md`.
 */
export const APPS: App[] = [
  {
    id: "git",
    name: "Git",
    icon: "⎇",
    color: "#d6553b",
    target: { kind: "surface", surface: { kind: "vcs" } },
    workflowIds: ["implement", "research-plan-implement", "review", "debug", "improve-test-coverage", "ralph", "mission"],
  },
  {
    id: "runs",
    name: "Runs",
    icon: "▷",
    color: "#356fd2",
    target: { kind: "surface", surface: { kind: "runs" } },
    workflowIds: ["implement", "research-plan-implement", "mission"],
  },
  {
    id: "issues",
    name: "Issues",
    icon: "◎",
    color: "#d6336c",
    target: { kind: "surface", surface: { kind: "issues" } },
    workflowIds: ["ticket-create", "tickets-create", "feature-enum", "debug", "grill-me"],
  },
  {
    id: "tickets",
    name: "Tickets",
    icon: "❏",
    color: "#a34d9f",
    target: { kind: "surface", surface: { kind: "tickets" } },
    workflowIds: ["ticket-create", "tickets-create", "kanban"],
  },
  {
    id: "approvals",
    name: "Approvals",
    icon: "✓",
    color: "#1f9d6b",
    target: { kind: "surface", surface: { kind: "approvals" } },
    workflowIds: ["review", "audit"],
  },
  {
    id: "agents",
    name: "Agents",
    icon: "◆",
    color: "#4a63d0",
    target: { kind: "surface", surface: { kind: "agents" } },
    workflowIds: ["grill-me", "mission"],
  },
  {
    id: "memory",
    name: "Memory",
    icon: "❋",
    color: "#6d56d8",
    target: { kind: "surface", surface: { kind: "memory" } },
    workflowIds: ["research", "workflow-skill"],
  },
  {
    id: "prompts",
    name: "Prompts",
    icon: "❝",
    color: "#2f7d9a",
    target: { kind: "surface", surface: { kind: "prompts" } },
    workflowIds: ["workflow-skill", "grill-me"],
  },
  {
    id: "scores",
    name: "Scores",
    icon: "▥",
    color: "#0f8f78",
    target: { kind: "surface", surface: { kind: "scores" } },
    workflowIds: ["improve-test-coverage", "audit"],
  },
  {
    id: "crons",
    name: "Crons",
    icon: "◷",
    color: "#c2691c",
    target: { kind: "surface", surface: { kind: "crons" } },
    workflowIds: ["ralph", "mission"],
  },
  {
    id: "landings",
    name: "Landings",
    icon: "⤓",
    color: "#356fd2",
    target: { kind: "surface", surface: { kind: "landings" } },
    workflowIds: ["review", "implement"],
  },
  {
    id: "store",
    name: "Store",
    icon: "▦",
    color: "#6d56d8",
    target: { kind: "view", view: "store" },
    workflowIds: [],
  },
];

const BY_ID = new Map(APPS.map((app) => [app.id, app]));

export function getApp(id: AppId): App | undefined {
  return BY_ID.get(id);
}

/**
 * Which app the current route is showing, or null when the route is not an app
 * (home, askme, a run surface, a utility surface). Surface apps match by kind;
 * the store app matches the `store` view.
 */
export function activeAppId(route: { view: View; surface: Surface | null }): AppId | null {
  if (route.surface) {
    const match = APPS.find(
      (app) => app.target.kind === "surface" && app.target.surface.kind === route.surface!.kind,
    );
    return match?.id ?? null;
  }
  const match = APPS.find((app) => app.target.kind === "view" && app.target.view === route.view);
  return match?.id ?? null;
}

/** The workflows an app can launch (app side of the many-to-many). */
export function workflowsForApp(id: AppId): StoreWorkflow[] {
  const app = getApp(id);
  if (!app) return [];
  return app.workflowIds
    .map((workflowId) => STORE_WORKFLOWS.find((workflow) => workflow.id === workflowId))
    .filter((workflow): workflow is StoreWorkflow => workflow !== undefined);
}

/** The apps a workflow is attached to (workflow side of the many-to-many). */
export function appsForWorkflow(workflowId: string): App[] {
  return APPS.filter((app) => app.workflowIds.includes(workflowId));
}

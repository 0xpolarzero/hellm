import { PRODUCT_FEATURES } from "../docs/features";

export type E2ECoverageLevel = "live" | "projection" | "missing";

export interface FeatureE2ECoverage {
  featureId: string;
  level: E2ECoverageLevel;
  testFiles: string[];
  evidence: string;
  remaining: string[];
}

function coverage(
  featureId: string,
  level: E2ECoverageLevel,
  testFiles: string[],
  evidence: string,
  remaining: string[] = [],
): FeatureE2ECoverage {
  return { featureId, level, testFiles, evidence, remaining };
}

export const FEATURE_E2E_COVERAGE: FeatureE2ECoverage[] = [
  coverage(
    "desktop-shell",
    "live",
    ["e2e/svvy-smoke.test.ts", "e2e/workspace-bootstrap.test.ts"],
    "Real dev build boots to the production workspace shell.",
  ),
  coverage(
    "effect-package-architecture",
    "missing",
    [],
    "Covered below the desktop through unit and Effect lanes.",
    ["Add a headless facade parity journey over the app-owned runtime."],
  ),
  coverage("source-invalidation", "missing", [], "No real-app source mutation journey.", [
    "Change an external instruction and extension source while the app is open and prove refresh, diagnostics, and stale-surface behavior.",
  ]),
  coverage(
    "provider-auth",
    "live",
    [
      "e2e/settings-auth.test.ts",
      "e2e/settings-auth-persistence.test.ts",
      "e2e/bridge-contract.test.ts",
    ],
    "Real settings RPC, persistence, bridge state, and emitted auth events are exercised.",
  ),
  coverage(
    "true-system-prompt-channel",
    "live",
    ["e2e/live-lifecycle.test.ts"],
    "A real prompt reaches a deterministic local provider with generated system instructions and the exact active request-input variant guidance.",
    [
      "Add external-instruction composition and stale-context refresh to the provider-request assertions.",
    ],
  ),
  coverage(
    "ambient-agent-resources",
    "missing",
    [],
    "No real-app settings or prompt-composition journey.",
    ["Exercise default-off policy and explicit opt-in through prompt/tool evidence."],
  ),
  coverage(
    "snippets",
    "missing",
    [],
    "No real-app snippet creation, picker, expansion, provenance, or enablement journey.",
  ),
  coverage(
    "extension-env-secrets",
    "missing",
    [],
    "Linux e2e deliberately bypasses the macOS keychain bootstrap.",
    [
      "Add a platform-safe secret-store test layer and a separate macOS live verification contract.",
    ],
  ),
  coverage(
    "artifacts-projection",
    "live",
    ["e2e/live-artifact-logs.test.ts", "e2e/workspace-shell.test.ts", "e2e/prompt-runtime.test.ts"],
    "A real provider tool call runs the generated Artifacts API through create, inspect, and open; the resulting durable artifact opens from App Logs in the real inspector and restores after relaunch.",
  ),
  coverage(
    "durable-artifact-storage",
    "live",
    ["e2e/live-artifact-logs.test.ts"],
    "A live tool lifecycle materializes an artifact with a backing file and proves its state, log correlation, inspector projection, and relaunch restoration.",
  ),
  coverage(
    "execute-typescript-surface",
    "projection",
    ["e2e/prompt-runtime.test.ts", "e2e/command-inspector.test.ts"],
    "Seeded execute_typescript cards and command facts render.",
    [
      "Execute a real snippet through approval, sandbox, artifact, command, and inspector boundaries.",
    ],
  ),
  coverage(
    "live-tool-projection",
    "live",
    ["e2e/live-lifecycle.test.ts", "e2e/prompt-runtime.test.ts", "e2e/command-inspector.test.ts"],
    "A real provider tool call streams accepted arguments, progress, terminal command facts, and its correlated semantic transcript card.",
    [
      "Extend the lifecycle to Shell, Apply Patch, Execute TypeScript, nested children, cancellation, and failure output.",
    ],
  ),
  coverage(
    "request-user-input",
    "live",
    ["e2e/live-lifecycle.test.ts"],
    "A real provider invokes nonblocking request_user_input, defaults the recommended answer, renders its durable panel and command, continues the turn, and restores the same facts without another provider call after relaunch.",
    [
      "Add blocking manual answer, timeout default, pause/resume, cancellation, handler ownership, and crash recovery journeys.",
    ],
  ),
  coverage(
    "extension-cli-requirements",
    "missing",
    [],
    "No real-app requirement readiness or dependency approval journey.",
  ),
  coverage(
    "web-tool-surface",
    "missing",
    [],
    "No prompt-generation or networkAccess-gating desktop journey.",
  ),
  coverage(
    "handler-thread-surfaces",
    "missing",
    [],
    "No real orchestrator thread_start, handler turn, report, or follow-up desktop journey.",
  ),
  coverage(
    "agents-and-extensions",
    "projection",
    ["e2e/agents-pane.test.ts"],
    "The real Agents pane survives an extension usage refresh.",
    [
      "Exercise source editing, build readiness, generated context, ordering, conflicts, and surface refresh.",
    ],
  ),
  coverage(
    "smithers-cli-guidance",
    "missing",
    [],
    "No real handler prompt or Smithers CLI command journey.",
  ),
  coverage(
    "extension-loading",
    "projection",
    ["e2e/agents-pane.test.ts"],
    "An extension usage state change is visible in the real pane.",
    [
      "Drive list_extensions and load_extension through a live agent turn and next-dispatch refresh.",
    ],
  ),
  coverage(
    "workflow-task-agent-parameters",
    "missing",
    [],
    "No real generated AgentLike or runTaskAgent bridge journey.",
  ),
  coverage(
    "context-budget-observability",
    "live",
    [
      "e2e/live-prompt-observability.test.ts",
      "e2e/prompt-runtime.test.ts",
      "e2e/session-sidebar.test.ts",
    ],
    "Explicit usage from a real provider response is normalized into runtime state and rendered in settled transcript and composer context meters.",
    ["Extend usage assertions to handler and task-agent attempts."],
  ),
  coverage(
    "workflows-extension",
    "missing",
    [],
    "No real svvyx workflows list/save/build/models desktop journey.",
  ),
  coverage(
    "saved-workflows-generated-surface",
    "missing",
    [],
    "No Workflows pane generated-package refresh journey.",
  ),
  coverage(
    "prompt-history",
    "live",
    ["e2e/live-prompt-observability.test.ts"],
    "A runtime-accepted real prompt enters durable history and is recalled exactly with the actual Arrow-Up composer shortcut after app relaunch.",
  ),
  coverage(
    "queued-surface-messages",
    "missing",
    [],
    "No active-turn queue, reorder, restore, Steer, or restart journey.",
  ),
  coverage(
    "composer-mention-links",
    "live",
    ["e2e/composer-capabilities.test.ts"],
    "The real composer selects indexed file and folder paths as editable @path text, exercises the native Electrobun picker for file, folder, and image attachment chips, sends tagged attachment metadata plus image content through the live provider, and renders sent file, folder, and image transcript tiles alongside existing and missing transcript links.",
  ),
  coverage(
    "assistant-markdown-rendering",
    "live",
    [
      "e2e/live-prompt-observability.test.ts",
      "e2e/prompt-runtime.test.ts",
      "e2e/transcript-edge-cases.test.ts",
    ],
    "A gated real provider stream expands variable-height Markdown, math, code, and Mermaid content while the transcript proves its single streaming row remains bottom-anchored, then settles the same rich response.",
  ),
  coverage(
    "workspace-navigation-core-projection",
    "live",
    ["e2e/session-sidebar.test.ts", "e2e/workspace-header.test.ts", "e2e/workspace-shell.test.ts"],
    "Real navigation, selection, workspace chrome, and sidebar controls are driven.",
  ),
  coverage(
    "command-palette",
    "live",
    ["e2e/command-palette.test.ts"],
    "Real shortcuts, routing, quick open, and unmatched prompt creation are driven.",
  ),
  coverage(
    "agent-profiles",
    "projection",
    ["e2e/agents-pane.test.ts"],
    "The default profile row and extension controls render and update.",
    [
      "Create, edit, reorder, duplicate, delete, persist, and bind profiles through real state commands.",
    ],
  ),
  coverage(
    "multi-session-support",
    "live",
    [
      "e2e/session-sidebar.test.ts",
      "e2e/bootstrap-persistence.test.ts",
      "e2e/session-recovery.test.ts",
      "e2e/live-prompt-observability.test.ts",
    ],
    "Real session creation, navigation, concurrent first-turn title generation, persistence, relaunch, and recovery are driven.",
  ),
  coverage(
    "multi-surface-runtime",
    "live",
    ["e2e/pane-layout.test.ts", "e2e/workspace-header.test.ts"],
    "Real Dockview surfaces, duplication, layouts, and workspace chrome are driven.",
    ["Prove one live stream shared by duplicated panels and multi-workspace routing."],
  ),
  coverage(
    "workspace-runtime-recovery",
    "projection",
    ["e2e/session-recovery.test.ts", "e2e/bootstrap-persistence.test.ts"],
    "Corrupt/orphaned sessions and relaunch persistence are exercised.",
    [
      "Crash during active turn, queue, wait, command, title, and generated-package work and prove fenced recovery.",
    ],
  ),
  coverage(
    "structured-session-state",
    "live",
    [
      "e2e/live-lifecycle.test.ts",
      "e2e/bootstrap-persistence.test.ts",
      "e2e/command-inspector.test.ts",
      "e2e/session-sidebar.test.ts",
    ],
    "A real prompt and tool lifecycle creates durable session, transcript, request-input, and command facts that restore after app relaunch.",
    ["Add crash-time recovery for every in-flight durable work family."],
  ),
  coverage(
    "turn-command-state",
    "live",
    ["e2e/live-lifecycle.test.ts", "e2e/command-inspector.test.ts", "e2e/prompt-runtime.test.ts"],
    "A real streamed tool call commits one correlated command with argument snapshots, progress, terminal facts, semantic transcript projection, and relaunch restoration.",
    [
      "Add nested commands plus mid-command crash, cancellation, approval, failure, and oversized-output journeys.",
    ],
  ),
  coverage(
    "session-threads",
    "missing",
    [],
    "No durable handler-thread lifecycle desktop journey.",
  ),
  coverage("durable-episodes", "missing", [], "No update or conclusion episode desktop journey."),
  coverage(
    "session-wait-state",
    "missing",
    [],
    "No user-input, approval, or external-dependency wait desktop journey.",
  ),
  coverage(
    "session-summary-read-models",
    "projection",
    ["e2e/session-sidebar.test.ts", "e2e/workspace-header.test.ts"],
    "Seeded summary projections render in navigation and workspace counters.",
    ["Derive each state from live orchestrator and handler activity."],
  ),
  coverage(
    "app-logs-surface",
    "live",
    ["e2e/live-artifact-logs.test.ts", "e2e/app-logs.test.ts", "e2e/bridge-contract.test.ts"],
    "Real artifact success and failure operations invalidate the live App Logs read model, render correlated identifiers and unread state, navigate to the artifact inspector, and survive restart.",
  ),
];

export function validateFeatureE2ECoverage(
  availableTestFiles: ReadonlySet<string>,
  requireCompleteShipped = false,
): string[] {
  const errors: string[] = [];
  const productFeaturesById = new Map(PRODUCT_FEATURES.map((feature) => [feature.id, feature]));
  const coverageByFeatureId = new Map<string, FeatureE2ECoverage>();

  for (const item of FEATURE_E2E_COVERAGE) {
    if (coverageByFeatureId.has(item.featureId)) {
      errors.push(`Duplicate e2e coverage entry for feature "${item.featureId}".`);
      continue;
    }
    coverageByFeatureId.set(item.featureId, item);
    if (!productFeaturesById.has(item.featureId)) {
      errors.push(`Unknown e2e coverage feature "${item.featureId}".`);
    }
    if (item.level === "missing" && item.testFiles.length > 0) {
      errors.push(`Missing feature "${item.featureId}" must not claim test files.`);
    }
    for (const testFile of item.testFiles) {
      if (!availableTestFiles.has(testFile)) {
        errors.push(`Feature "${item.featureId}" references missing test file "${testFile}".`);
      }
    }
  }

  for (const feature of PRODUCT_FEATURES) {
    const item = coverageByFeatureId.get(feature.id);
    if (!item) {
      errors.push(`Feature "${feature.id}" has no e2e coverage entry.`);
      continue;
    }
    if (requireCompleteShipped && feature.status === "shipped" && item.level !== "live") {
      errors.push(
        `Shipped feature "${feature.id}" requires live e2e coverage; current level is "${item.level}".`,
      );
    }
    if (
      requireCompleteShipped &&
      feature.status === "shipped" &&
      item.level === "live" &&
      item.remaining.length > 0
    ) {
      errors.push(
        `Shipped feature "${feature.id}" still has uncovered e2e journeys: ${item.remaining.join(" ")}`,
      );
    }
  }

  return errors;
}

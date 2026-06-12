import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  buildSourceWatchInputs,
  createSourceInvalidationCoordinator,
  type SourceInvalidationEvent,
  type SourceWatchInput,
} from "./source-invalidation-coordinator";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("source invalidation coordinator", () => {
  it("emits domain invalidations from deterministic fingerprints, not raw watcher events", async () => {
    const root = tempRoot("source-invalidation");
    const workflows = join(root, "workflows", "agents");
    mkdirSync(workflows, { recursive: true });
    writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
    const events: SourceInvalidationEvent[] = [];
    const coordinator = testCoordinator({
      inputs: [
        {
          domain: "workflows",
          kind: "directory",
          path: workflows,
          recursive: true,
        },
      ],
      events,
    });

    writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
    coordinator.requestScan("test");
    await flushMicrotasks();

    expect(events).toHaveLength(1);
    expect(events[0]?.domains).toEqual(["workflows"]);

    coordinator.requestScan("unchanged");
    await flushMicrotasks();

    expect(events).toHaveLength(1);
    coordinator.close();
  });

  it("keeps generated Workflows output outside watched source inputs", () => {
    const root = tempRoot("source-inputs");
    const inputs = buildSourceWatchInputs({
      agentDir: join(root, "pi"),
      cwdByWorkspaceId: new Map([["workspace:1", join(root, "workspace")]]),
      extensionsRoot: join(root, "extensions"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    expect(inputs.some((input) => input.path.includes("/workflows/generated/"))).toBe(false);
    expect(inputs).toContainEqual(
      expect.objectContaining({
        domain: "workflows",
        kind: "directory",
        path: join(root, "workflows", "agents"),
      }),
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({
        domain: "snippets",
        kind: "file",
        path: join(
          root,
          "pi",
          "sessions",
          `--${join(root, "workspace")
            .replace(/^[/\\]/, "")
            .replace(/[/\\:]/g, "-")}--`,
          "snippets.json",
        ),
      }),
    );
  });

  it("adds external instruction candidates for workspace ancestors and configured global roots", () => {
    const root = tempRoot("external-inputs");
    const workspace = join(root, "a", "b");
    const global = join(root, "global");
    const inputs = buildSourceWatchInputs({
      agentDir: join(root, "pi"),
      cwdByWorkspaceId: new Map([["workspace:1", workspace]]),
      externalInstructionsByWorkspaceId: new Map([
        [
          "workspace:1",
          {
            globalControls: {},
            globalRoots: [
              {
                enabled: true,
                id: "global",
                kind: "custom",
                label: "Global",
                path: global,
              },
            ],
            workspaceControls: {},
          },
        ],
      ]),
      extensionsRoot: join(root, "extensions"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    expect(inputs).toContainEqual(
      expect.objectContaining({
        domain: "external-instructions",
        kind: "file",
        path: join(global, "AGENTS.md"),
      }),
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({
        domain: "external-instructions",
        kind: "file",
        path: join(workspace, "CLAUDE.md"),
      }),
    );
  });
});

function testCoordinator(input: {
  inputs: readonly SourceWatchInput[];
  events: SourceInvalidationEvent[];
}) {
  return createSourceInvalidationCoordinator({
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    debounceMs: 1,
    onDomainsChanged: (event) => {
      input.events.push(event);
    },
    readInputs: () => input.inputs,
    reconciliationIntervalMs: 0,
    setInterval: (() => 0) as unknown as typeof globalThis.setInterval,
    setTimeout: ((callback: () => void) => {
      queueMicrotask(callback);
      return 0;
    }) as typeof globalThis.setTimeout,
    watchEnabled: false,
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `svvy-${name}-`));
  tempDirs.push(root);
  return root;
}

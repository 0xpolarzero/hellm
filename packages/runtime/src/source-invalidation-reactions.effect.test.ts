import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type {
  GeneratedPackageName,
  GeneratedPackagesRefreshResult,
  RefreshGeneratedContextRequest,
  RefreshGeneratedPackagesRequest,
  WorkspaceId,
} from "@svvy/core";
import {
  reactToRuntimeSourceInvalidationEvent,
  type RuntimeSourceInvalidationReactionHost,
} from "./source-invalidation-reactions";
import type { SourceInvalidationEvent } from "./source-invalidation-coordinator";

const workspaceOne = "workspace_source_reaction_01" as WorkspaceId;
const workspaceTwo = "workspace_source_reaction_02" as WorkspaceId;

describe("runtime source invalidation reactions", () => {
  it.effect("refreshes generated workflows once for app-global workflows changes", () =>
    Effect.gen(function* () {
      const packageRefreshes: RefreshGeneratedPackagesRequest[] = [];
      const contextRefreshes: RefreshGeneratedContextRequest[] = [];
      const result = yield* runReaction(
        {
          scope: { kind: "app-global" },
          event: sourceEvent(["workflows"]),
        },
        {
          packageRefreshes,
          contextRefreshes,
          acquiredWorkspaceIds: [workspaceOne, workspaceTwo],
        },
      );

      assert.deepStrictEqual(packageRefreshes, [
        {
          scope: "app-global",
          packages: ["@svvyx/workflows"],
          reason: "source-changed",
        },
      ]);
      assert.deepStrictEqual(contextRefreshes, []);
      assert.deepStrictEqual(
        result.generatedPackageRefresh?.packages.map((status) => status.packageName),
        ["@svvyx/workflows"],
      );
      assert.deepStrictEqual(result.refreshedGeneratedContextWorkspaces, []);
    }),
  );

  it.effect(
    "refreshes generated extensions before workflows and refreshes acquired workspace contexts",
    () =>
      Effect.gen(function* () {
        const packageRefreshes: RefreshGeneratedPackagesRequest[] = [];
        const contextRefreshes: RefreshGeneratedContextRequest[] = [];
        const result = yield* runReaction(
          {
            scope: { kind: "app-global" },
            event: sourceEvent(["extensions"]),
          },
          {
            packageRefreshes,
            contextRefreshes,
            acquiredWorkspaceIds: [workspaceOne, workspaceTwo],
          },
        );

        assert.deepStrictEqual(packageRefreshes, [
          {
            scope: "app-global",
            packages: ["@svvyx/extensions", "@svvyx/workflows"],
            reason: "source-changed",
          },
        ]);
        assert.deepStrictEqual(contextRefreshes, [
          {
            scope: "workspace",
            workspaceId: workspaceOne,
            reason: "extension-source-changed",
          },
          {
            scope: "workspace",
            workspaceId: workspaceTwo,
            reason: "extension-source-changed",
          },
        ]);
        assert.deepStrictEqual(result.refreshedGeneratedContextWorkspaces, [
          workspaceOne,
          workspaceTwo,
        ]);
      }),
  );

  it.effect("refreshes only the owning workspace context for external instruction changes", () =>
    Effect.gen(function* () {
      const packageRefreshes: RefreshGeneratedPackagesRequest[] = [];
      const contextRefreshes: RefreshGeneratedContextRequest[] = [];
      const result = yield* runReaction(
        {
          scope: { kind: "workspace", workspaceId: workspaceOne },
          event: sourceEvent(["external_instructions"]),
        },
        {
          packageRefreshes,
          contextRefreshes,
          acquiredWorkspaceIds: [workspaceTwo],
        },
      );

      assert.deepStrictEqual(packageRefreshes, []);
      assert.deepStrictEqual(contextRefreshes, [
        {
          scope: "workspace",
          workspaceId: workspaceOne,
          reason: "external-instruction-changed",
        },
      ]);
      assert.strictEqual(result.generatedPackageRefresh, null);
      assert.deepStrictEqual(result.refreshedGeneratedContextWorkspaces, [workspaceOne]);
    }),
  );

  it.effect("does not refresh generated packages or generated context for host snippets", () =>
    Effect.gen(function* () {
      const packageRefreshes: RefreshGeneratedPackagesRequest[] = [];
      const contextRefreshes: RefreshGeneratedContextRequest[] = [];
      const result = yield* runReaction(
        {
          scope: { kind: "workspace", workspaceId: workspaceOne },
          event: sourceEvent(["host_snippets"]),
        },
        {
          packageRefreshes,
          contextRefreshes,
          acquiredWorkspaceIds: [workspaceTwo],
        },
      );

      assert.deepStrictEqual(packageRefreshes, []);
      assert.deepStrictEqual(contextRefreshes, []);
      assert.deepStrictEqual(result, {
        generatedPackageRefresh: null,
        refreshedGeneratedContextWorkspaces: [],
      });
    }),
  );
});

function runReaction(
  input: Parameters<typeof reactToRuntimeSourceInvalidationEvent>[0],
  captures: {
    acquiredWorkspaceIds: readonly WorkspaceId[];
    contextRefreshes: RefreshGeneratedContextRequest[];
    packageRefreshes: RefreshGeneratedPackagesRequest[];
  },
) {
  const host = {
    listAcquiredWorkspaceIds: () => Effect.succeed(captures.acquiredWorkspaceIds),
    refreshGeneratedContext: (request) =>
      Effect.sync(() => {
        captures.contextRefreshes.push(request);
      }),
    refreshGeneratedPackages: (request) =>
      Effect.sync(() => {
        captures.packageRefreshes.push(request);
        return generatedPackageRefresh(request.packages);
      }),
  } satisfies RuntimeSourceInvalidationReactionHost;
  return reactToRuntimeSourceInvalidationEvent(input, host);
}

function sourceEvent(domains: SourceInvalidationEvent["domains"]): SourceInvalidationEvent {
  return {
    domains: [...domains],
    reason: "test",
    sourceFingerprints: {
      extensions: "extensions_fingerprint",
      external_instructions: "external_instructions_fingerprint",
      host_snippets: "host_snippets_fingerprint",
      workflows: "workflows_fingerprint",
    },
    afterCommit: [],
  };
}

function generatedPackageRefresh(
  packages: readonly GeneratedPackageName[],
): GeneratedPackagesRefreshResult {
  return {
    scope: "app-global",
    packages: packages.map((packageName) => ({
      packageName,
      action: "written",
    })),
    workspaceLinks: [],
    recoveryWorkIds: [],
  };
}

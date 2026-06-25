import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type {
  AbsolutePath,
  BuildLaunchPolicyInput,
  CommandId,
  SandboxPolicySnapshot,
  SandboxPolicySourceService,
  WorkspaceId,
} from "@svvy/core";
import { SandboxPolicySource } from "@svvy/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HostProcessReferencePort, Sandbox, SandboxHelperCandidatesPort, layer } from "./index";

const workspaceId = "workspace_test" as WorkspaceId;
const commandId = "command_test" as CommandId;
const cwd = "/workspace" as AbsolutePath;

describe("Sandbox service", () => {
  it.effect("checks path access from a policy snapshot", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const decision = sandbox.checkPathAccess({
        operation: "write",
        followSymlinks: true,
        path: "/workspace/src/app.ts" as AbsolutePath,
        snapshot: testSnapshot(),
      });

      assert.deepStrictEqual(decision, {
        status: "allowed",
        access: "write",
        matchedRuleId: "filesystemPolicy",
      });
    }).pipe(Effect.provide(testSandboxLayer())),
  );

  it.effect("builds managed launch facts through injected policy and helper ports", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const input: BuildLaunchPolicyInput = {
          scope: { kind: "workspace", workspaceId },
          commandId,
          launchKind: "direct_shell",
          command: ["bun", "test"],
          cwd,
          envFacts: [{ key: "PATH", redactionLabel: "host PATH" }],
        };
        const helper = yield* executableHelperFixture();

        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const facts = yield* sandbox.buildLaunchPolicy(input);

          assert.strictEqual(facts.mode, "managed");
          if (facts.mode !== "managed") {
            assert.fail("Expected managed sandbox launch facts.");
          }
          assert.deepStrictEqual(facts.command, ["bun", "test"]);
          assert.strictEqual(facts.cwd, cwd);
          assert.strictEqual(facts.helperPath, helper.path);
          assert.include(facts.helperArgs, "--");
          assert.strictEqual(facts.policySnapshot.fingerprint, "sandbox_test_fingerprint");
        }).pipe(Effect.provide(testSandboxLayer(helper)));
      }),
    ),
  );

  it.effect("classifies managed sandbox denials", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const denial = yield* sandbox.classifyDenial({
        managedSandbox: true,
        exitCode: 1,
        stdout: "",
        stderr: "Sandbox: sandbox-exec: sandbox_apply: deny(1) file-write-create /workspace/out",
      });

      assert.deepStrictEqual(denial, {
        denied: true,
        reason: "macos-seatbelt-denial",
        sandboxEngine: "macos-seatbelt",
        evidence: [
          "Sandbox: sandbox-exec: sandbox_apply: deny(1) file-write-create /workspace/out",
        ],
      });
    }).pipe(Effect.provide(testSandboxLayer())),
  );
});

function testPolicySource(): SandboxPolicySourceService {
  return {
    snapshot: () => Effect.succeed(testSnapshot()),
  };
}

function testSandboxLayer(helper?: { directory: AbsolutePath; path: AbsolutePath }) {
  return layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(SandboxPolicySource, testPolicySource()),
        Layer.succeed(SandboxHelperCandidatesPort, {
          getSnapshot: () =>
            Effect.succeed({
              candidates: helper ? [helper.path] : [],
              allowedRoots: helper ? [helper.directory] : [],
            }),
        }),
        Layer.succeed(HostProcessReferencePort, {
          getSnapshot: () =>
            Effect.succeed({
              platform: "darwin",
              arch: "arm64",
              appBundleRoot: "/Applications/Svvy.app" as AbsolutePath,
              appSupportRoot: "/Users/test/Library/Application Support/svvy" as AbsolutePath,
              tempRoot: "/tmp" as AbsolutePath,
            }),
        }),
      ),
    ),
  );
}

function testSnapshot(): SandboxPolicySnapshot {
  return {
    snapshotId: "snapshot_test",
    fingerprint: "sandbox_test_fingerprint",
    resolvedAt: "2026-06-23T00:00:00.000Z" as SandboxPolicySnapshot["resolvedAt"],
    scope: { kind: "workspace", workspaceId },
    commandId,
    launchKind: "direct_shell",
    cwd,
    sandboxMode: "managed",
    networkPolicy: "deny",
    filesystemPolicy: {
      defaultAccess: "none",
      entries: [
        {
          path: cwd,
          access: "write",
          recursive: true,
          source: "workspace",
        },
      ],
    },
  };
}

function executableHelperFixture() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const directory = mkdtempSync(join(tmpdir(), "svvy-sandbox-helper-"));
      const helperPath = join(directory, "svvy-sandbox-helper");
      writeFileSync(helperPath, "#!/bin/sh\nexit 0\n");
      chmodSync(helperPath, 0o755);
      return {
        directory: directory as AbsolutePath,
        path: helperPath as AbsolutePath,
      };
    }),
    (helper) =>
      Effect.sync(() => {
        rmSync(helper.directory, { force: true, recursive: true });
      }),
  );
}

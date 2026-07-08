import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type {
  AbsolutePath,
  BuildLaunchPolicyInput,
  CommandId,
  SandboxPolicySnapshot,
  SandboxPolicySourceService,
  SurfacePiSessionId,
  WorkspaceId,
} from "@svvy/core";
import { SandboxPolicySource } from "@svvy/core";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  HostProcessReferencePort,
  Sandbox,
  SandboxHelperCandidatesPort,
  layer,
  type SandboxHelperCandidatesSnapshot,
} from "./index";

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
        cwd,
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

  it.effect("resolves relative paths against cwd before policy matching", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* workspaceFixture();
        const sourcePath = join(workspace.cwd, "src", "app.ts") as AbsolutePath;
        mkdirSync(join(workspace.cwd, "src"), { recursive: true });
        writeFileSync(sourcePath, "export const value = 1;\n");

        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const decision = yield* sandbox.resolvePathAccess({
            operation: "write",
            followSymlinks: true,
            cwd: workspace.cwd,
            path: "src/app.ts" as AbsolutePath,
            snapshot: testSnapshot({
              cwd: workspace.cwd,
              filesystemPolicy: writableWorkspacePolicy(workspace.cwd),
            }),
          });

          assert.deepStrictEqual(decision, {
            status: "allowed",
            access: "write",
            matchedRuleId: "filesystemPolicy",
            canonicalPath: realpathSync(sourcePath) as AbsolutePath,
          });
        }).pipe(Effect.provide(testSandboxLayer()));
      }),
    ),
  );

  it.effect("denies symlink escapes for existing targets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* workspaceFixture();
        const outsideDirectory = join(workspace.root, "outside") as AbsolutePath;
        mkdirSync(outsideDirectory, { recursive: true });
        const outsidePath = join(outsideDirectory, "out.txt") as AbsolutePath;
        writeFileSync(outsidePath, "outside\n");
        symlinkSync(outsideDirectory, join(workspace.cwd, "link"));

        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const decision = yield* sandbox.resolvePathAccess({
            operation: "write",
            followSymlinks: true,
            cwd: workspace.cwd,
            path: join(workspace.cwd, "link", "out.txt") as AbsolutePath,
            snapshot: testSnapshot({
              cwd: workspace.cwd,
              filesystemPolicy: writableWorkspacePolicy(workspace.cwd),
            }),
          });

          assert.deepStrictEqual(decision, {
            status: "denied",
            reason: "symlink-escape",
            matchedRuleId: "filesystemPolicy",
            canonicalPath: realpathSync(outsidePath) as AbsolutePath,
          });
        }).pipe(Effect.provide(testSandboxLayer()));
      }),
    ),
  );

  it.effect("uses the nearest existing parent for missing write targets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* workspaceFixture();
        const sourceDirectory = join(workspace.cwd, "src") as AbsolutePath;
        mkdirSync(sourceDirectory, { recursive: true });
        const targetPath = join(sourceDirectory, "new", "file.ts") as AbsolutePath;

        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const decision = yield* sandbox.resolvePathAccess({
            operation: "create",
            followSymlinks: true,
            cwd: workspace.cwd,
            path: targetPath,
            snapshot: testSnapshot({
              cwd: workspace.cwd,
              filesystemPolicy: writableWorkspacePolicy(workspace.cwd),
            }),
          });

          assert.deepStrictEqual(decision, {
            status: "allowed",
            access: "write",
            matchedRuleId: "filesystemPolicy",
            canonicalParentPath: realpathSync(sourceDirectory) as AbsolutePath,
            resolvedCandidatePath: targetPath,
          });
        }).pipe(Effect.provide(testSandboxLayer()));
      }),
    ),
  );

  it.effect("denies symlink escapes through nearest existing parents", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* workspaceFixture();
        const outsideDirectory = join(workspace.root, "outside") as AbsolutePath;
        mkdirSync(outsideDirectory, { recursive: true });
        symlinkSync(outsideDirectory, join(workspace.cwd, "link"));
        const targetPath = join(workspace.cwd, "link", "new.txt") as AbsolutePath;

        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const decision = yield* sandbox.resolvePathAccess({
            operation: "create",
            followSymlinks: true,
            cwd: workspace.cwd,
            path: targetPath,
            snapshot: testSnapshot({
              cwd: workspace.cwd,
              filesystemPolicy: writableWorkspacePolicy(workspace.cwd),
            }),
          });

          assert.deepStrictEqual(decision, {
            status: "denied",
            reason: "symlink-escape",
            matchedRuleId: "filesystemPolicy",
            canonicalParentPath: realpathSync(outsideDirectory) as AbsolutePath,
            resolvedCandidatePath: join(outsideDirectory, "new.txt") as AbsolutePath,
          });
        }).pipe(Effect.provide(testSandboxLayer()));
      }),
    ),
  );

  it.effect("requires executable host metadata for execute access", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* workspaceFixture();
        const scriptPath = join(workspace.cwd, "script.sh") as AbsolutePath;
        writeFileSync(scriptPath, "#!/bin/sh\nexit 0\n");
        chmodSync(scriptPath, 0o644);

        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const snapshot = testSnapshot({
            cwd: workspace.cwd,
            filesystemPolicy: writableWorkspacePolicy(workspace.cwd),
          });
          const denied = yield* sandbox.resolvePathAccess({
            operation: "execute",
            followSymlinks: true,
            cwd: workspace.cwd,
            path: scriptPath,
            snapshot,
          });
          chmodSync(scriptPath, 0o755);
          const allowed = yield* sandbox.resolvePathAccess({
            operation: "execute",
            followSymlinks: true,
            cwd: workspace.cwd,
            path: scriptPath,
            snapshot,
          });

          assert.deepStrictEqual(denied, {
            status: "denied",
            reason: "invalid-path",
            matchedRuleId: "filesystemPolicy",
            canonicalPath: realpathSync(scriptPath) as AbsolutePath,
          });
          assert.deepStrictEqual(allowed, {
            status: "allowed",
            access: "execute",
            matchedRuleId: "filesystemPolicy",
            canonicalPath: realpathSync(scriptPath) as AbsolutePath,
          });
        }).pipe(Effect.provide(testSandboxLayer()));
      }),
    ),
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
          assert.deepStrictEqual(facts.spawn, {
            executable: helper.path,
            args: facts.helperArgs,
            cwd,
            envFacts: [{ key: "PATH", redactionLabel: "host PATH" }],
          });
          assert.strictEqual(facts.helperPath, helper.path);
          assert.include(facts.helperArgs, "--");
          assert.strictEqual(facts.policySnapshot.fingerprint, "sandbox_test_fingerprint");
          const profileDigest = facts.policySnapshot.profileDigest;
          if (typeof profileDigest !== "string") {
            assert.fail("Expected managed sandbox launch facts to include a profile digest.");
          }
          assert.match(profileDigest, /^[a-f0-9]{64}$/);
        }).pipe(Effect.provide(testSandboxLayer(helper)));
      }),
    ),
  );

  it.effect(
    "builds managed launch facts for direct apply-patch and TypeScript runtime launches",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const helper = yield* executableHelperFixture();
          const seenLaunchKinds: string[] = [];
          const policySource: SandboxPolicySourceService = {
            snapshot: (request) =>
              Effect.sync(() => {
                seenLaunchKinds.push(request.launchKind);
                return testSnapshot({
                  scope: request.scope,
                  ...(request.surfacePiSessionId
                    ? { surfacePiSessionId: request.surfacePiSessionId }
                    : {}),
                  commandId: request.commandId,
                  launchKind: request.launchKind,
                  cwd: request.cwd,
                });
              }),
          };

          yield* Effect.gen(function* () {
            const sandbox = yield* Sandbox;

            for (const launchKind of [
              "direct_apply_patch",
              "execute_typescript_runtime",
            ] as const) {
              const facts = yield* sandbox.buildLaunchPolicy({
                ...testLaunchInput(),
                launchKind,
              });

              assert.strictEqual(facts.mode, "managed");
              assert.strictEqual(facts.policySnapshot.launchKind, launchKind);
              assert.strictEqual(facts.spawn.cwd, cwd);
            }

            assert.deepStrictEqual(seenLaunchKinds, [
              "direct_apply_patch",
              "execute_typescript_runtime",
            ]);
          }).pipe(Effect.provide(testSandboxLayer(helper, { policySource })));
        }),
      ),
  );

  it.effect("canonicalizes launch cwd before policy lookup and spawn facts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* workspaceFixture();
        const helper = yield* executableHelperFixture();
        const aliasedCwd = join(workspace.root, "workspace", "..", "workspace") as AbsolutePath;
        const seenCwds: AbsolutePath[] = [];
        const policySource: SandboxPolicySourceService = {
          snapshot: (request) =>
            Effect.sync(() => {
              seenCwds.push(request.cwd);
              return testSnapshot({
                cwd: workspace.cwd,
                filesystemPolicy: writableWorkspacePolicy(workspace.cwd),
              });
            }),
        };

        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const facts = yield* sandbox.buildLaunchPolicy({
            ...testLaunchInput(),
            cwd: aliasedCwd,
          });

          assert.deepStrictEqual(seenCwds, [workspace.cwd]);
          assert.strictEqual(facts.spawn.cwd, workspace.cwd);
        }).pipe(Effect.provide(testSandboxLayer(helper, { policySource })));
      }),
    ),
  );

  it.effect("rejects launch cwd values that cannot be canonicalized", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* workspaceFixture();
        const helper = yield* executableHelperFixture();

        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox
            .buildLaunchPolicy({
              ...testLaunchInput(),
              cwd: join(workspace.root, "missing") as AbsolutePath,
            })
            .pipe(Effect.flip);

          assert.strictEqual(error.reason, "invalid-policy");
          assert.strictEqual(error.operation, "Sandbox.buildLaunchPolicy.cwd");
        }).pipe(Effect.provide(testSandboxLayer(helper)));
      }),
    ),
  );

  it.effect("rejects helper candidates for a different host platform or arch", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox.buildLaunchPolicy(testLaunchInput()).pipe(Effect.flip);

          assert.strictEqual(error.reason, "helper-unavailable");
        }).pipe(
          Effect.provide(
            testSandboxLayer(helper, {
              helperArch: "x64",
            }),
          ),
        );
      }),
    ),
  );

  it.effect("rejects helper candidates outside allowed roots", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox.buildLaunchPolicy(testLaunchInput()).pipe(Effect.flip);

          assert.strictEqual(error.reason, "helper-unavailable");
        }).pipe(
          Effect.provide(
            testSandboxLayer(helper, {
              allowedRoots: [join(helper.directory, "other") as AbsolutePath],
            }),
          ),
        );
      }),
    ),
  );

  it.effect("rejects helper candidates with mismatched expected digest", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox.buildLaunchPolicy(testLaunchInput()).pipe(Effect.flip);

          assert.strictEqual(error.reason, "helper-unavailable");
        }).pipe(
          Effect.provide(
            testSandboxLayer(helper, {
              expectedDigest: "0".repeat(64),
            }),
          ),
        );
      }),
    ),
  );

  it.effect("rejects relative helper candidate paths", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox.buildLaunchPolicy(testLaunchInput()).pipe(Effect.flip);

          assert.strictEqual(error.reason, "helper-unavailable");
        }).pipe(
          Effect.provide(
            testSandboxLayer(undefined, {
              candidates: [
                helperCandidate({
                  helper,
                  path: "relative/svvy-sandbox-helper" as AbsolutePath,
                }),
              ],
              allowedRoots: [helper.directory],
            }),
          ),
        );
      }),
    ),
  );

  it.effect("rejects non-file helper candidates", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox.buildLaunchPolicy(testLaunchInput()).pipe(Effect.flip);

          assert.strictEqual(error.reason, "helper-unavailable");
        }).pipe(
          Effect.provide(
            testSandboxLayer(undefined, {
              candidates: [
                helperCandidate({
                  helper,
                  path: helper.directory,
                }),
              ],
              allowedRoots: [helper.directory],
            }),
          ),
        );
      }),
    ),
  );

  it.effect("rejects non-executable helper candidates", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture({ mode: 0o644 });
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox.buildLaunchPolicy(testLaunchInput()).pipe(Effect.flip);

          assert.strictEqual(error.reason, "helper-unavailable");
        }).pipe(Effect.provide(testSandboxLayer(helper)));
      }),
    ),
  );

  it.effect("uses the first later helper candidate that passes validation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const badHelper = yield* executableHelperFixture();
        const goodHelper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const facts = yield* sandbox.buildLaunchPolicy(testLaunchInput());

          assert.strictEqual(facts.mode, "managed");
          if (facts.mode !== "managed") {
            assert.fail("Expected managed launch facts.");
          }
          assert.strictEqual(facts.helperPath, goodHelper.path);
        }).pipe(
          Effect.provide(
            testSandboxLayer(undefined, {
              candidates: [
                helperCandidate({
                  helper: badHelper,
                  expectedDigest: "0".repeat(64),
                }),
                helperCandidate({ helper: goodHelper }),
              ],
              allowedRoots: [badHelper.directory, goodHelper.directory],
            }),
          ),
        );
      }),
    ),
  );

  it.effect("rejects helper candidates when filesystem validation fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox.buildLaunchPolicy(testLaunchInput()).pipe(Effect.flip);

          assert.strictEqual(error.reason, "helper-unavailable");
        }).pipe(
          Effect.provide(
            testSandboxLayer(undefined, {
              candidates: [
                helperCandidate({
                  helper,
                  path: join(helper.directory, "missing-helper") as AbsolutePath,
                }),
              ],
              allowedRoots: [helper.directory],
            }),
          ),
        );
      }),
    ),
  );

  it.effect("accepts matching caller-supplied managed profile digests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const input = testLaunchInput();
          const initialFacts = yield* sandbox.buildLaunchPolicy(input);
          if (initialFacts.mode !== "managed") {
            assert.fail("Expected managed launch facts.");
          }
          const profileDigest = initialFacts.policySnapshot.profileDigest;
          if (typeof profileDigest !== "string") {
            assert.fail("Expected managed sandbox launch facts to include a profile digest.");
          }

          const suppliedFacts = yield* sandbox.buildLaunchPolicy({
            ...input,
            snapshot: {
              ...testSnapshot(),
              profileDigest,
            },
          });

          assert.strictEqual(suppliedFacts.mode, "managed");
          if (suppliedFacts.mode !== "managed") {
            assert.fail("Expected managed launch facts.");
          }
          assert.strictEqual(
            suppliedFacts.policySnapshot.profileDigest,
            initialFacts.policySnapshot.profileDigest,
          );
        }).pipe(Effect.provide(testSandboxLayer(helper)));
      }),
    ),
  );

  it.effect("rejects mismatched caller-supplied managed profile digests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const error = yield* sandbox
            .buildLaunchPolicy({
              ...testLaunchInput(),
              snapshot: {
                ...testSnapshot(),
                profileDigest: "0".repeat(64),
              },
            })
            .pipe(Effect.flip);

          assert.strictEqual(error.reason, "snapshot-mismatch");
        }).pipe(Effect.provide(testSandboxLayer(helper)));
      }),
    ),
  );

  it.effect("rejects caller-supplied snapshots for a different launch identity", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const input = testLaunchInput();
          const mismatchedSnapshots: SandboxPolicySnapshot[] = [
            testSnapshot({
              scope: {
                kind: "workspace",
                workspaceId: "workspace_other" as WorkspaceId,
              },
            }),
            testSnapshot({ surfacePiSessionId: "surface_other" as SurfacePiSessionId }),
            testSnapshot({ commandId: "command_other" as CommandId }),
            testSnapshot({ launchKind: "direct_apply_patch" }),
            testSnapshot({ cwd: "/workspace/other" as AbsolutePath }),
          ];

          for (const snapshot of mismatchedSnapshots) {
            const error = yield* sandbox
              .buildLaunchPolicy({
                ...input,
                snapshot,
              })
              .pipe(Effect.flip);

            assert.strictEqual(error.reason, "snapshot-mismatch");
          }
        }).pipe(Effect.provide(testSandboxLayer(helper)));
      }),
    ),
  );

  it.effect("profiles digests cover profile policy and not command argv or env facts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helper = yield* executableHelperFixture();
        yield* Effect.gen(function* () {
          const sandbox = yield* Sandbox;
          const baseFacts = yield* sandbox.buildLaunchPolicy(testLaunchInput());
          const differentCommandFacts = yield* sandbox.buildLaunchPolicy({
            ...testLaunchInput(),
            command: ["bun", "run", "different"],
            envFacts: [{ key: "CUSTOM", valueFingerprint: "env_fp_changed" }],
          });
          const differentPolicyFacts = yield* sandbox.buildLaunchPolicy({
            ...testLaunchInput(),
            snapshot: testSnapshot({
              networkPolicy: "allow",
            }),
          });

          if (
            baseFacts.mode !== "managed" ||
            differentCommandFacts.mode !== "managed" ||
            differentPolicyFacts.mode !== "managed"
          ) {
            assert.fail("Expected managed launch facts.");
          }
          assert.strictEqual(
            differentCommandFacts.policySnapshot.profileDigest,
            baseFacts.policySnapshot.profileDigest,
          );
          assert.notStrictEqual(
            differentPolicyFacts.policySnapshot.profileDigest,
            baseFacts.policySnapshot.profileDigest,
          );
        }).pipe(Effect.provide(testSandboxLayer(helper)));
      }),
    ),
  );

  it.effect("classifies managed sandbox denials from redacted excerpts", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const denial = yield* sandbox.classifyDenial({
        command: ["touch", "/workspace/out"],
        cwd,
        exitCode: 1,
        signal: null,
        sandboxMode: "managed",
        stdoutExcerpt: {
          text: "",
          originalBytes: 0,
          omittedBytes: 0,
          redactionApplied: false,
        },
        stderrExcerpt: {
          text: "deny(1) file-write-create /workspace/out",
          originalBytes: 41,
          omittedBytes: 0,
          redactionApplied: false,
        },
      });

      assert.deepStrictEqual(denial, {
        denied: true,
        reason: "seatbelt-denied-file-write",
        evidence: ["deny(1) file-write-create /workspace/out"],
      });
    }).pipe(Effect.provide(testSandboxLayer())),
  );

  it.effect("classifies each supported managed sandbox denial reason", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const cases = [
        {
          stderr: "deny(1) file-read-data /workspace/private.txt",
          reason: "seatbelt-denied-file-read",
        },
        {
          stderr: "deny(1) network-outbound api.example.com",
          reason: "seatbelt-denied-network",
        },
        {
          stderr: "sandbox-exec: sandbox_apply: Operation not permitted",
          reason: "helper-setup-failed",
        },
        {
          stderr: "invalid profile: expected list expression",
          reason: "invalid-profile",
        },
      ] as const;

      for (const entry of cases) {
        const denial = yield* sandbox.classifyDenial({
          command: ["tool"],
          cwd,
          exitCode: 1,
          signal: null,
          sandboxMode: "managed",
          stdoutExcerpt: {
            text: "",
            originalBytes: 0,
            omittedBytes: 0,
            redactionApplied: false,
          },
          stderrExcerpt: {
            text: entry.stderr,
            originalBytes: entry.stderr.length,
            omittedBytes: 0,
            redactionApplied: false,
          },
        });

        assert.deepStrictEqual(denial, {
          denied: true,
          reason: entry.reason,
          evidence: [entry.stderr],
        });
      }
    }).pipe(Effect.provide(testSandboxLayer())),
  );

  it.effect("does not classify omitted full-access failures as sandbox denials", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const denial = yield* sandbox.classifyDenial({
        command: ["touch", "/workspace/out"],
        cwd,
        exitCode: 1,
        signal: null,
        sandboxMode: "omitted_full_access",
        stdoutExcerpt: {
          text: "",
          originalBytes: 0,
          omittedBytes: 0,
          redactionApplied: false,
        },
        stderrExcerpt: {
          text: "Sandbox: deny(1) file-write-create /workspace/out",
          originalBytes: 51,
          omittedBytes: 0,
          redactionApplied: false,
        },
      });

      assert.deepStrictEqual(denial, { denied: false });
    }).pipe(Effect.provide(testSandboxLayer())),
  );
});

function testPolicySource(): SandboxPolicySourceService {
  return {
    snapshot: () => Effect.succeed(testSnapshot()),
  };
}

function testLaunchInput(): BuildLaunchPolicyInput {
  return {
    scope: { kind: "workspace", workspaceId },
    commandId,
    launchKind: "direct_shell",
    command: ["bun", "test"],
    cwd,
    envFacts: [{ key: "PATH", redactionLabel: "host PATH" }],
  };
}

function testSandboxLayer(
  helper?: { directory: AbsolutePath; path: AbsolutePath },
  options: {
    allowedRoots?: readonly AbsolutePath[];
    candidates?: SandboxHelperCandidatesSnapshot["candidates"];
    expectedDigest?: string;
    helperArch?: "arm64" | "x64";
    helperPlatform?: "darwin";
    policySource?: SandboxPolicySourceService;
  } = {},
) {
  return layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(SandboxPolicySource, options.policySource ?? testPolicySource()),
        Layer.succeed(SandboxHelperCandidatesPort, {
          getSnapshot: () =>
            Effect.succeed({
              candidates:
                options.candidates ?? (helper ? [helperCandidate({ helper, options })] : []),
              allowedRoots: options.allowedRoots ?? (helper ? [helper.directory] : []),
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
        Layer.succeed(FileSystem.FileSystem, testFileSystem()),
        Layer.succeed(Crypto.Crypto, testCrypto()),
        Path.layer,
      ),
    ),
  );
}

function helperCandidate(input: {
  helper: { directory: AbsolutePath; path: AbsolutePath };
  options?: {
    expectedDigest?: string;
    helperArch?: "arm64" | "x64";
    helperPlatform?: "darwin";
  };
  path?: AbsolutePath;
  expectedDigest?: string;
}): SandboxHelperCandidatesSnapshot["candidates"][number] {
  return {
    path: input.path ?? input.helper.path,
    platform: input.options?.helperPlatform ?? "darwin",
    arch: input.options?.helperArch ?? "arm64",
    expectedDigest:
      input.expectedDigest ?? input.options?.expectedDigest ?? helperDigest(input.helper.path),
  };
}

function testFileSystem(): FileSystem.FileSystem {
  return {
    stat: (path: string) =>
      Effect.try({
        try: () => {
          const stat = statSync(path);
          return {
            type: stat.isFile() ? "File" : stat.isDirectory() ? "Directory" : "Other",
            mode: stat.mode,
          } as FileSystem.File.Info;
        },
        catch: (cause) => cause,
      }),
    access: (path: string) =>
      Effect.try({
        try: () => {
          accessSync(path, constants.F_OK);
        },
        catch: (cause) => cause,
      }),
    exists: (path: string) =>
      Effect.sync(() => {
        try {
          accessSync(path, constants.F_OK);
          return true;
        } catch {
          return false;
        }
      }),
    readFile: (path: string) =>
      Effect.try({
        try: () => new Uint8Array(readFileSync(path)),
        catch: (cause) => cause,
      }),
    realPath: (path: string) =>
      Effect.try({
        try: () => (path.startsWith("/workspace") ? path : realpathSync(path)),
        catch: (cause) => cause,
      }),
  } as unknown as FileSystem.FileSystem;
}

function testCrypto(): Crypto.Crypto {
  return Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (algorithm, data) =>
      Effect.sync(() => {
        const nodeAlgorithm = algorithm === "SHA-256" ? "sha256" : algorithm.toLowerCase();
        return new Uint8Array(createHash(nodeAlgorithm).update(data).digest());
      }),
  });
}

function testSnapshot(overrides: Partial<SandboxPolicySnapshot> = {}): SandboxPolicySnapshot {
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
    ...overrides,
  };
}

function executableHelperFixture(options: { mode?: number } = {}) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const directory = mkdtempSync(join(tmpdir(), "svvy-sandbox-helper-"));
      const helperPath = join(directory, "svvy-sandbox-helper");
      writeFileSync(helperPath, "#!/bin/sh\nexit 0\n");
      chmodSync(helperPath, options.mode ?? 0o755);
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

function workspaceFixture() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "svvy-sandbox-path-"))) as AbsolutePath;
      const workspace = join(root, "workspace") as AbsolutePath;
      mkdirSync(workspace, { recursive: true });
      return {
        root,
        cwd: realpathSync(workspace) as AbsolutePath,
      };
    }),
    (workspace) =>
      Effect.sync(() => {
        rmSync(workspace.root, { force: true, recursive: true });
      }),
  );
}

function writableWorkspacePolicy(path: AbsolutePath): SandboxPolicySnapshot["filesystemPolicy"] {
  return {
    defaultAccess: "none",
    entries: [
      {
        path,
        access: "write",
        recursive: true,
        source: "workspace",
      },
    ],
  };
}

function helperDigest(path: AbsolutePath): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

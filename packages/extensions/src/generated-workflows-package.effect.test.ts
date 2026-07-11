import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import type {
  AbsolutePath,
  ExtensionError,
  GeneratedPackageBuildId,
  IsoDateTimeString,
} from "@svvy/core";
import {
  type RefreshGeneratedWorkflowsPackageResult,
  refreshGeneratedWorkflowsPackage,
  renderGeneratedWorkflowsPackageFiles,
} from "./generated-workflows-package";

const generatedWorkflowsSpecifier = ["@svvyx", "workflows"].join("/");
const generatedExtensionsSpecifier = ["@svvyx", "extensions"].join("/");
const generatedExtensionsInternalSpecifier = ["@svvyx", "extensions", "internal"].join("/");
const runtimeSpecifier = ["@svvy", "runtime"].join("/");
const effectSpecifier = ["effect", "Effect"].join("/");
const platformBunSpecifier = ["@effect", "platform-bun"].join("/");
const moduleLoadWord = ["im", "port"].join("");
const exportKeyword = ["ex", "port"].join("");
const requireWord = ["re", "quire"].join("");

describe("generated workflows package", () => {
  it("emits generated extension value imports only for workflow agents with overrides", () => {
    const files = renderGeneratedWorkflowsPackageFiles(
      [
        {
          exportName: "plainAgent",
          kind: "agent",
          sourcePath: "/workflows/agents/plain.agent.json" as AbsolutePath,
          relativeGeneratedPath: "agents/plainAgent.ts",
          sourceText: JSON.stringify({
            id: "plain",
            label: "Plain",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Handle the task.",
          }),
        },
        {
          exportName: "overrideAgent",
          kind: "agent",
          sourcePath: "/workflows/agents/override.agent.json" as AbsolutePath,
          relativeGeneratedPath: "agents/overrideAgent.ts",
          sourceText: JSON.stringify({
            id: "override",
            label: "Override",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Handle the task with artifacts.",
            overrides: { artifacts: "loaded" },
            extensionOrder: ["artifacts"],
          }),
        },
      ],
      {
        createdAt: "2026-06-28T00:00:00.000Z" as IsoDateTimeString,
        coreTypeContractPackageDependencySpecifier: "file:../core-type-contract",
        extensionsBuildId:
          "@svvyx/extensions:svvy-fnv64-v1:0000000000000001" as GeneratedPackageBuildId,
      },
    );

    const plainAgent = files.find((file) => file.relativePath === "agents/plainAgent.ts");
    const overrideAgent = files.find((file) => file.relativePath === "agents/overrideAgent.ts");
    const packageJson = JSON.parse(
      files.find((file) => file.relativePath === "package.json")?.contents ?? "",
    );
    const smithersAmbientTypes = files.find(
      (file) => file.relativePath === "smithers-orchestrator.ambient.d.ts",
    );
    const manifest = JSON.parse(
      files.find((file) => file.relativePath === ".svvy-generated-package.json")?.contents ?? "",
    );

    assert.strictEqual(
      plainAgent?.contents.includes(`from ${JSON.stringify(generatedExtensionsSpecifier)}`),
      false,
    );
    assert.strictEqual(
      overrideAgent?.contents.includes(`from ${JSON.stringify(generatedExtensionsSpecifier)}`),
      true,
    );
    assert.match(
      overrideAgent?.contents ?? "",
      /"overrides": \{\n    \[Extensions\.artifacts\.id\]: "loaded",/,
    );
    assert.strictEqual((overrideAgent?.contents ?? "").includes("extensionOrder"), false);
    assert.deepStrictEqual(packageJson.devDependencies, {
      "@svvy/core": "file:../core-type-contract",
    });
    assert.deepStrictEqual(
      manifest.dependencies.filter(
        (dependency: Record<string, unknown>) => dependency.specifier === "@svvy/core",
      ),
      [
        {
          specifier: "@svvy/core",
          importKind: "type-only",
          dependencyClass: "app-owned-type-contract",
          resolutionAuthority: "app-owned-type-contract",
          manifestDependency: "dev-type-dependency",
        },
      ],
    );
    assert.deepStrictEqual(
      manifest.dependencies.filter(
        (dependency: Record<string, unknown>) =>
          dependency.specifier === "@svvy/core" && dependency.importKind === "runtime",
      ),
      [],
    );
    assert.match(smithersAmbientTypes?.contents ?? "", /declare module "smithers-orchestrator"/);
    assert.match(
      smithersAmbientTypes?.contents ?? "",
      /generate: \(args: unknown\) => Promise<unknown>/,
    );
    assert.strictEqual(JSON.stringify(packageJson).includes("smithers-orchestrator"), false);
    assert.deepStrictEqual(
      manifest.dependencies.filter(
        (dependency: Record<string, unknown>) =>
          dependency.specifier === generatedExtensionsSpecifier &&
          dependency.importKind === "runtime",
      ),
      [
        {
          specifier: generatedExtensionsSpecifier,
          importKind: "runtime",
          dependencyClass: "generated-package",
          resolutionAuthority: "generated-package-link",
          manifestDependency: "none-generated-package-link",
          buildId: "@svvyx/extensions:svvy-fnv64-v1:0000000000000001",
        },
      ],
    );
  });

  it("includes source paths in generated package source fingerprints", () => {
    const first = renderGeneratedWorkflowsPackageFiles(
      [
        {
          exportName: "sameAgent",
          kind: "agent",
          sourcePath: "/workflows/agents/one.agent.json" as AbsolutePath,
          relativeGeneratedPath: "agents/sameAgent.ts",
          sourceText: JSON.stringify({
            id: "same",
            label: "Same",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Handle the task.",
          }),
        },
      ],
      {
        createdAt: "2026-06-28T00:00:00.000Z" as IsoDateTimeString,
        coreTypeContractPackageDependencySpecifier: "file:../core-type-contract",
        extensionsBuildId:
          "@svvyx/extensions:svvy-fnv64-v1:0000000000000001" as GeneratedPackageBuildId,
      },
    );
    const second = renderGeneratedWorkflowsPackageFiles(
      [
        {
          exportName: "sameAgent",
          kind: "agent",
          sourcePath: "/workflows/agents/two.agent.json" as AbsolutePath,
          relativeGeneratedPath: "agents/sameAgent.ts",
          sourceText: JSON.stringify({
            id: "same",
            label: "Same",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Handle the task.",
          }),
        },
      ],
      {
        createdAt: "2026-06-28T00:00:00.000Z" as IsoDateTimeString,
        coreTypeContractPackageDependencySpecifier: "file:../core-type-contract",
        extensionsBuildId:
          "@svvyx/extensions:svvy-fnv64-v1:0000000000000001" as GeneratedPackageBuildId,
      },
    );

    const firstManifest = JSON.parse(
      first.find((file) => file.relativePath === ".svvy-generated-package.json")?.contents ?? "",
    );
    const secondManifest = JSON.parse(
      second.find((file) => file.relativePath === ".svvy-generated-package.json")?.contents ?? "",
    );
    assert.notStrictEqual(firstManifest.sourceFingerprint, secondManifest.sourceFingerprint);
  });

  it("records Smithers value imports as runtime workspace-authoring evidence", () => {
    const files = renderGeneratedWorkflowsPackageFiles(
      [
        {
          exportName: "reviewWorkflow",
          kind: "workflow",
          sourcePath: "/workflows/workflows/review.tsx" as AbsolutePath,
          relativeGeneratedPath: "workflows/reviewWorkflow.tsx",
          sourceText: [
            `${moduleLoadWord} { Task } from "smithers-orchestrator";`,
            "export const reviewWorkflow = Task;",
            "",
          ].join("\n"),
        },
      ],
      {
        createdAt: "2026-06-28T00:00:00.000Z" as IsoDateTimeString,
        coreTypeContractPackageDependencySpecifier: "file:../core-type-contract",
        extensionsBuildId:
          "@svvyx/extensions:svvy-fnv64-v1:0000000000000001" as GeneratedPackageBuildId,
      },
    );
    const manifest = JSON.parse(
      files.find((file) => file.relativePath === ".svvy-generated-package.json")?.contents ?? "",
    );

    assert.deepStrictEqual(
      manifest.dependencies.filter(
        (dependency: Record<string, unknown>) => dependency.specifier === "smithers-orchestrator",
      ),
      [
        {
          specifier: "smithers-orchestrator",
          importKind: "runtime",
          dependencyClass: "workspace-authoring-external",
          resolutionAuthority: "workspace-smithers-package",
          manifestDependency: "ambient-declaration",
          version: "0.22.0",
        },
      ],
    );
  });

  it("keeps workflow source fingerprints independent from extensions dependency build ids", () => {
    const sourceItems = [
      {
        exportName: "reviewerAgent",
        kind: "agent" as const,
        sourcePath: "/workflows/agents/reviewer.agent.json" as AbsolutePath,
        relativeGeneratedPath: "agents/reviewerAgent.ts",
        sourceText: JSON.stringify({
          id: "reviewer",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5",
          reasoning: { effort: "medium" },
          instructions: "Review the task.",
        }),
      },
    ];
    const first = renderGeneratedWorkflowsPackageFiles(sourceItems, {
      createdAt: "2026-06-28T00:00:00.000Z" as IsoDateTimeString,
      coreTypeContractPackageDependencySpecifier: "file:../core-type-contract",
      extensionsBuildId:
        "@svvyx/extensions:svvy-fnv64-v1:0000000000000001" as GeneratedPackageBuildId,
    });
    const second = renderGeneratedWorkflowsPackageFiles(sourceItems, {
      createdAt: "2026-06-28T00:00:00.000Z" as IsoDateTimeString,
      coreTypeContractPackageDependencySpecifier: "file:../core-type-contract",
      extensionsBuildId:
        "@svvyx/extensions:svvy-fnv64-v1:0000000000000002" as GeneratedPackageBuildId,
    });

    const firstManifest = JSON.parse(
      first.find((file) => file.relativePath === ".svvy-generated-package.json")?.contents ?? "",
    );
    const secondManifest = JSON.parse(
      second.find((file) => file.relativePath === ".svvy-generated-package.json")?.contents ?? "",
    );
    assert.strictEqual(firstManifest.sourceFingerprint, secondManifest.sourceFingerprint);
    assert.notStrictEqual(
      JSON.stringify(firstManifest.dependencies),
      JSON.stringify(secondManifest.dependencies),
    );
    assert.notStrictEqual(firstManifest.outputFingerprint, secondManifest.outputFingerprint);
  });

  it.effect(
    "rejects persistent workflow source that self-imports the generated workflows package",
    () =>
      Effect.gen(function* () {
        const services = fakeWorkflowPackageServices({
          sources: {
            "/workflows/workflows/review.tsx": [
              moduleLoadWord,
              " { Agents } ",
              "from ",
              JSON.stringify(generatedWorkflowsSpecifier),
              ";\n",
            ].join(""),
          },
        });

        const error = yield* refreshWithServices(services).pipe(Effect.flip);
        assert.strictEqual(error._tag, "ExtensionError");
        if (error._tag === "ExtensionError") {
          assert.strictEqual(error.reason, "invalid-input");
        }
        assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
      }),
  );

  it.effect("rejects workflow agent JSON that does not match the task-agent source contract", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/agents/bad.agent.json": JSON.stringify({
            id: "bad",
            label: "Bad",
            provider: "openai",
            reasoning: { effort: "medium" },
            instructions: "Missing model.",
          }),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.strictEqual(error.operation, "extensions.generated-workflows.validate-agent-source");
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("rejects workflow agent extension overrides outside the usage-state contract", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/agents/badOverride.agent.json": JSON.stringify({
            id: "bad-override",
            label: "Bad Override",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Invalid override.",
            overrides: { artifacts: "enabled" },
          }),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.strictEqual(error.operation, "extensions.generated-workflows.validate-agent-source");
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect(
    "rejects workflow agent extension overrides outside generated extension references",
    () =>
      Effect.gen(function* () {
        const services = fakeWorkflowPackageServices({
          sources: {
            "/workflows/agents/unknownOverride.agent.json": JSON.stringify({
              id: "unknown-override",
              label: "Unknown Override",
              provider: "openai",
              model: "gpt-5",
              reasoning: { effort: "medium" },
              instructions: "Invalid override identity.",
              overrides: { "not-real": "loaded" },
            }),
          },
        });

        const error = yield* refreshWithServices(services).pipe(Effect.flip);
        assert.strictEqual(error._tag, "ExtensionError");
        if (error._tag === "ExtensionError") {
          assert.strictEqual(error.reason, "invalid-input");
          assert.strictEqual(
            error.operation,
            "extensions.generated-workflows.validate-agent-source",
          );
          assert.match(error.message, /not-real/);
        }
        assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
      }),
  );

  it.effect("accepts workflow agent extensionOrder only as source metadata", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/agents/ordered.agent.json": JSON.stringify({
            id: "ordered",
            label: "Ordered",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Use ordered extensions.",
            extensionOrder: ["git", "artifacts"],
          }),
        },
      });

      const result = yield* refreshWithServices(services);

      const generatedAgent = services.readFile("/generated/@svvyx/workflows/agents/ordered.ts");
      assert.notStrictEqual(generatedAgent, null);
      assert.strictEqual((generatedAgent ?? "").includes("extensionOrder"), false);
      assert.deepStrictEqual(result.workflowsExports as unknown, [
        {
          kind: "agent",
          namespace: "Agents",
          exportName: "ordered",
          qualifiedName: "Agents.ordered",
          sourcePath: "/workflows/agents/ordered.agent.json",
          generatedPath: "/generated/@svvyx/workflows/agents/ordered.ts",
          generatedCode: generatedAgent,
          agentParameters: {
            id: "ordered",
            label: "Ordered",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Use ordered extensions.",
          },
          workflowAgentId: "ordered",
        },
      ]);
    }),
  );

  it.effect("rejects workflow agent extensionOrder values outside source metadata shape", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/agents/badOrder.agent.json": JSON.stringify({
            id: "bad-order",
            label: "Bad Order",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Invalid source metadata.",
            extensionOrder: ["git", 42],
          }),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.strictEqual(error.operation, "extensions.generated-workflows.validate-agent-source");
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect(
    "rejects workflow agent extensionOrder entries outside generated extension references",
    () =>
      Effect.gen(function* () {
        const services = fakeWorkflowPackageServices({
          sources: {
            "/workflows/agents/unknownOrder.agent.json": JSON.stringify({
              id: "unknown-order",
              label: "Unknown Order",
              provider: "openai",
              model: "gpt-5",
              reasoning: { effort: "medium" },
              instructions: "Invalid order identity.",
              extensionOrder: ["git", "not-real"],
            }),
          },
        });

        const error = yield* refreshWithServices(services).pipe(Effect.flip);
        assert.strictEqual(error._tag, "ExtensionError");
        if (error._tag === "ExtensionError") {
          assert.strictEqual(error.reason, "invalid-input");
          assert.strictEqual(
            error.operation,
            "extensions.generated-workflows.validate-agent-source",
          );
          assert.match(error.message, /not-real/);
        }
        assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
      }),
  );

  it.effect("rejects workflow agent source fields outside the bridge contract", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/agents/extra.agent.json": JSON.stringify({
            id: "extra",
            label: "Extra",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Invalid extra field.",
            extensionOrder: ["git"],
            preview: "not part of the source contract",
          }),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.strictEqual(error.operation, "extensions.generated-workflows.validate-agent-source");
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("rejects persistent workflow source that imports product or Effect packages", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/components/bad.ts": [
            [moduleLoadWord, " * as Effect ", "from ", JSON.stringify(effectSpecifier), ";"].join(
              "",
            ),
            [
              exportKeyword,
              " type { Runtime } ",
              "from ",
              JSON.stringify(runtimeSpecifier),
              ";",
            ].join(""),
            [
              "const lazy = () => ",
              moduleLoadWord,
              "(",
              JSON.stringify(platformBunSpecifier),
              ");",
            ].join(""),
            "",
          ].join("\n"),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("rejects persistent workflow source that uses forbidden template specifiers", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/components/badTemplate.ts": [
            `const runtimeModule = ${requireWord}(\`${runtimeSpecifier}\`);`,
            `const platform = ${moduleLoadWord}(\`${platformBunSpecifier}\`);`,
            "export const component = runtimeModule ?? platform;",
          ].join("\n"),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /@svvy\/runtime/);
        assert.match(error.message, /@effect\/platform-bun/);
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("rejects persistent workflow source that uses computed dynamic module loads", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/components/badComputed.ts": [
            [
              "const runtimeModule = ",
              moduleLoadWord,
              "(",
              JSON.stringify("@svvy/"),
              " + ",
              JSON.stringify("runtime"),
              ");",
            ].join(""),
            [
              "const platform = ",
              requireWord,
              "(",
              JSON.stringify("@effect/"),
              " + ",
              JSON.stringify("platform-bun"),
              ");",
            ].join(""),
            "export const component = runtimeModule ?? platform;",
          ].join("\n"),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /<computed module specifier>/);
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("rejects forbidden imports inside template literal expressions", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/components/badTemplateExpression.ts": [
            "const docs = `runtime: ${",
            moduleLoadWord,
            "(",
            JSON.stringify(runtimeSpecifier),
            ")}`;",
            "export const component = docs;",
          ].join(""),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /@svvy\/runtime/);
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect(
    "rejects persistent workflow prompt MDX that imports generated or product packages",
    () =>
      Effect.gen(function* () {
        const services = fakeWorkflowPackageServices({
          sources: {
            "/workflows/prompts/review.mdx": [
              "---",
              "title: Review",
              "---",
              [
                moduleLoadWord,
                " { Prompts } ",
                "from ",
                JSON.stringify(generatedWorkflowsSpecifier),
                ";",
              ].join(""),
              [
                moduleLoadWord,
                " { Extensions } ",
                "from ",
                JSON.stringify(generatedExtensionsSpecifier),
                ";",
              ].join(""),
              [
                moduleLoadWord,
                " { Task } ",
                "from ",
                JSON.stringify("smithers-orchestrator"),
                ";",
              ].join(""),
              [
                moduleLoadWord,
                " type { Runtime } ",
                "from ",
                JSON.stringify(runtimeSpecifier),
                ";",
              ].join(""),
              "",
              "Review this repository.",
            ].join("\n"),
          },
        });

        const error = yield* refreshWithServices(services).pipe(Effect.flip);
        assert.strictEqual(error._tag, "ExtensionError");
        if (error._tag === "ExtensionError") {
          assert.strictEqual(error.reason, "invalid-input");
          assert.match(error.message, /Workflows prompt review imports forbidden/);
        }
        assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
      }),
  );

  it.effect("rejects persistent workflow source that references forbidden packages", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/workflows/review.tsx": [
            '/// <reference types="effect" />',
            `const runtimeModule = ${requireWord}("${runtimeSpecifier}");`,
            `type RuntimeModule = typeof ${moduleLoadWord}("${runtimeSpecifier}");`,
            "export const reviewWorkflow = runtimeModule;",
          ].join("\n"),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /Workflows workflow review imports forbidden/);
        assert.match(error.message, /@svvy\/runtime/);
        assert.match(error.message, /effect/);
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("rejects persistent workflow source that imports unsupported bare packages", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/workflows/review.tsx": [
            `${moduleLoadWord} debounce from "lodash";`,
            "export const reviewWorkflow = debounce;",
            "",
          ].join("\n"),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /unsupported non-relative modules/);
        assert.match(error.message, /lodash/);
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("rejects comment-separated forbidden workflow imports", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/workflows/review.tsx": [
            `${moduleLoadWord}/*x*/{ Runtime } from/*x*/"${runtimeSpecifier}";`,
            `const platform = ${moduleLoadWord}/*x*/("${platformBunSpecifier}");`,
            "export const reviewWorkflow = Runtime ?? platform;",
          ].join("\n"),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /@svvy\/runtime/);
        assert.match(error.message, /@effect\/platform-bun/);
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("ignores import-like text in comments, strings, and prompt code examples", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/prompts/review.mdx": [
            "---",
            "title: Review",
            "---",
            `// ${moduleLoadWord} { Runtime } from "${runtimeSpecifier}";`,
            `const docs = "${moduleLoadWord} { Agents } from \\"${generatedWorkflowsSpecifier}\\";";`,
            "```ts",
            `${moduleLoadWord} { Runtime } from "${runtimeSpecifier}";`,
            "```",
            "Review this repository.",
          ].join("\n"),
        },
      });

      yield* refreshWithServices(services);
      assert.notStrictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("ignores import-like text in prompt tilde code examples and property calls", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/prompts/review.mdx": [
            "---",
            "title: Review",
            "---",
            "~~~ts",
            `${moduleLoadWord} { Runtime } from "${runtimeSpecifier}";`,
            "~~~",
            `helpers.${moduleLoadWord}("${runtimeSpecifier}");`,
            `registry.${requireWord}("${platformBunSpecifier}");`,
            "Review this repository.",
          ].join("\n"),
        },
      });

      yield* refreshWithServices(services);
      assert.notStrictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("rejects generated extension subpath imports", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/workflows/review.tsx": [
            `${moduleLoadWord} { Extensions } from "${generatedExtensionsInternalSpecifier}";`,
            "export const reviewWorkflow = Extensions.git.id;",
          ].join("\n"),
        },
      });

      const error = yield* refreshWithServices(services).pipe(Effect.flip);
      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /@svvyx\/extensions\/internal/);
      }
      assert.strictEqual(services.readFile("/generated/@svvyx/workflows/index.ts"), null);
    }),
  );

  it.effect("allows workflow source to reference generated extension imports", () =>
    Effect.gen(function* () {
      const services = fakeWorkflowPackageServices({
        sources: {
          "/workflows/workflows/review.tsx": [
            [
              moduleLoadWord,
              " { Extensions } ",
              "from ",
              JSON.stringify(generatedExtensionsSpecifier),
              ";",
            ].join(""),
            "export const reviewWorkflow = Extensions.git.id;",
            "",
          ].join("\n"),
        },
      });

      yield* refreshWithServices(services);

      assert.match(
        services.readFile("/generated/@svvyx/workflows/workflows/review.tsx") ?? "",
        new RegExp(escapeRegExp(generatedExtensionsSpecifier)),
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /export type ReasoningEffort = "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh";/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /throw new Error\("svvy workflow task-agent requires exactly one prompt source: provide either prompt or messages\."\);/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /    promptSource,/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /function readSmithersTaskIdentity\(args: GenerateArgs\): RunTaskAgentSourceInput\["taskIdentity"\]/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /svvy workflow task-agent requires Smithers task identity field: \$\{name\}/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /svvy workflow task-agent requires non-negative integer Smithers task identity field: \$\{name\}/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /const WORKFLOW_TASK_AGENT_BRIDGE_MAX_RESPONSE_BYTES = 1048576;/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /maxOutputBytes\?: unknown;/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /function readOptionalPositiveIntegerValue\(name: string, value: unknown\): number \| undefined/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /async function readBridgeResponseText\(response: Response, maxResponseBytes: number\): Promise<string>/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /const maxResponseBytes = readOptionalPositiveIntegerValue\("maxOutputBytes", args\.maxOutputBytes\) \?\? configuredMaxResponseBytes \?\? WORKFLOW_TASK_AGENT_BRIDGE_MAX_RESPONSE_BYTES;/,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "",
        /svvy workflow task-agent bridge response exceeded the configured byte limit\./,
      );
      assert.strictEqual(
        (services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "").includes(
          "...(promptSource ? { promptSource } : {})",
        ),
        false,
      );
      assert.strictEqual(
        (services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "").includes(
          "SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES",
        ),
        true,
      );
      assert.strictEqual(
        (services.readFile("/generated/@svvyx/workflows/agents/index.ts") ?? "").includes(
          "maxOutputBytes,",
        ),
        false,
      );
      assert.match(
        services.readFile("/generated/@svvyx/workflows/index.ts") ?? "",
        new RegExp(
          ["export \\* as Workflows ", "from ", JSON.stringify("./workflows"), ";"].join(""),
        ),
      );
    }),
  );
});

function refreshWithServices(
  services: ReturnType<typeof fakeWorkflowPackageServices>,
): Effect.Effect<RefreshGeneratedWorkflowsPackageResult, ExtensionError | PlatformError> {
  return refreshGeneratedWorkflowsPackage({
    coreTypeContractPackageRoot: "/generated/@svvy/core-type-contract" as AbsolutePath,
    generatedPackagePath: "/generated/@svvyx/workflows" as AbsolutePath,
    workflowsSourceRoot: "/workflows" as AbsolutePath,
    extensionsBuildId:
      "@svvyx/extensions:svvy-fnv64-v1:0000000000000001" as GeneratedPackageBuildId,
    extensionIds: ["artifacts", "git"],
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, services.fileSystem),
    Effect.provideService(Path.Path, services.path),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fakeWorkflowPackageServices(input: { sources: Record<string, string> }) {
  const files = new Map(Object.entries(input.sources));
  const directories = new Set<string>(["/", "/workflows", "/generated", "/generated/@svvyx"]);
  for (const filePath of files.keys()) {
    addDirectoryChain(directories, dirnamePath(filePath));
  }
  let tempCounter = 0;

  return {
    fileSystem: {
      exists: (path: string) => Effect.succeed(pathExists(files, directories, path)),
      makeDirectory: (path: string) =>
        Effect.sync(() => {
          addDirectoryChain(directories, path);
        }),
      makeTempDirectory: ({ directory = "/", prefix = "tmp-" } = {}) =>
        Effect.sync(() => {
          tempCounter += 1;
          const tempPath = joinPathSegments(directory, `${prefix}${tempCounter}`);
          addDirectoryChain(directories, tempPath);
          return tempPath;
        }),
      readDirectory: (path: string) =>
        Effect.succeed([
          ...new Set(
            [...files.keys()].flatMap((filePath) => directChildName(path, filePath) ?? []),
          ),
        ]),
      readFileString: (path: string) =>
        files.has(path)
          ? Effect.succeed(files.get(path) ?? "")
          : Effect.fail(new Error(`Missing fake file: ${path}`)),
      remove: (path: string) =>
        Effect.sync(() => {
          removePath(files, directories, path);
        }),
      rename: (fromPath: string, toPath: string) =>
        Effect.sync(() => {
          movePath(files, directories, fromPath, toPath);
        }),
      stat: (path: string) =>
        pathExists(files, directories, path)
          ? Effect.succeed({ type: files.has(path) ? "File" : "Directory" })
          : Effect.fail(new Error(`Missing fake path: ${path}`)),
      writeFileString: (path: string, contents: string) =>
        Effect.sync(() => {
          addDirectoryChain(directories, dirnamePath(path));
          files.set(path, contents);
        }),
    } as unknown as FileSystem.FileSystem,
    path: {
      basename: basenamePath,
      dirname: dirnamePath,
      join: joinPathSegments,
      relative: relativePath,
    } as unknown as Path.Path,
    readFile: (path: string) => files.get(path) ?? null,
  };
}

function directChildName(parentPath: string, filePath: string): string[] {
  const prefix = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
  if (!filePath.startsWith(prefix)) {
    return [];
  }
  const rest = filePath.slice(prefix.length);
  return rest.includes("/") ? [] : [rest];
}

function pathExists(files: Map<string, string>, directories: Set<string>, path: string): boolean {
  return files.has(path) || directories.has(path);
}

function addDirectoryChain(directories: Set<string>, path: string): void {
  const normalized = path || "/";
  if (normalized === "/") {
    directories.add("/");
    return;
  }
  let current = "";
  for (const segment of normalized.split("/").filter(Boolean)) {
    current = `${current}/${segment}`;
    directories.add(current);
  }
}

function removePath(files: Map<string, string>, directories: Set<string>, path: string): void {
  const filePaths = Array.from(files.keys()).filter(
    (filePath) => filePath === path || filePath.startsWith(`${path}/`),
  );
  const directoryPaths = Array.from(directories).filter(
    (directoryPath) => directoryPath === path || directoryPath.startsWith(`${path}/`),
  );

  for (const filePath of filePaths) {
    files.delete(filePath);
  }
  for (const directoryPath of directoryPaths) {
    directories.delete(directoryPath);
  }
}

function movePath(
  files: Map<string, string>,
  directories: Set<string>,
  fromPath: string,
  toPath: string,
): void {
  if (!pathExists(files, directories, fromPath)) {
    throw new Error(`Cannot rename missing path: ${fromPath}`);
  }
  const movedFiles = [...files.entries()].filter(
    ([filePath]) => filePath === fromPath || filePath.startsWith(`${fromPath}/`),
  );
  const movedDirectories = [...directories].filter(
    (directoryPath) => directoryPath === fromPath || directoryPath.startsWith(`${fromPath}/`),
  );
  removePath(files, directories, toPath);
  removePath(files, directories, fromPath);
  for (const directoryPath of movedDirectories) {
    directories.add(`${toPath}${directoryPath.slice(fromPath.length)}`);
  }
  for (const [filePath, contents] of movedFiles) {
    files.set(`${toPath}${filePath.slice(fromPath.length)}`, contents);
  }
  addDirectoryChain(directories, dirnamePath(toPath));
}

function joinPathSegments(...segments: readonly string[]): string {
  return segments.join("/").replaceAll(/\/+/g, "/");
}

function dirnamePath(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return path.slice(0, index);
}

function basenamePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function relativePath(fromPath: string, toPath: string): string {
  const fromSegments = pathSegments(fromPath);
  const toSegments = pathSegments(toPath);
  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length &&
    fromSegments[common] === toSegments[common]
  ) {
    common += 1;
  }
  return [
    ...Array.from({ length: fromSegments.length - common }, () => ".."),
    ...toSegments.slice(common),
  ].join("/");
}

function pathSegments(path: string): string[] {
  return path.replaceAll(/\/+/g, "/").split("/").filter(Boolean);
}

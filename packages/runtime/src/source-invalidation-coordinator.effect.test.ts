import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";
import {
  RuntimeSourceInvalidationCoordinator,
  layerRuntimeSourceInvalidationCoordinator,
  type SourceInvalidationEvent,
  type SourceInvalidationHost,
  type SourceWatchInput,
} from "./bootstrap";

describe("runtime source invalidation coordinator", () => {
  it.effect("exposes source invalidation through a scoped Effect layer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-invalidation");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          yield* coordinator.requestScan("test");
          yield* TestClock.adjust(1);

          assert.strictEqual(events.length, 1);
          assert.deepStrictEqual(events[0]?.domains, ["workflows"]);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
            }),
          ),
        );
      }),
    ),
  );
});

function tempRoot(name: string) {
  return Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), `svvy-${name}-`))),
    (root) =>
      Effect.sync(() => {
        rmSync(root, { recursive: true, force: true });
      }),
  );
}

function testCoordinatorOptions(homeDir: string, inputs: readonly SourceWatchInput[]) {
  return {
    debounceMs: 1,
    host: testHost(homeDir),
    readInputs: () => inputs,
    reconciliationIntervalMs: 0,
    watchEnabled: false,
  };
}

function testHost(homeDir: string): SourceInvalidationHost {
  return {
    homeDir,
    path: {
      dirname,
      join,
      resolve,
    },
    fileSystem: {
      exists: existsSync,
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
      isFile: (path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      },
      readDirectory: (path) =>
        readdirSync(path, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory()
            ? ("directory" as const)
            : entry.isFile()
              ? ("file" as const)
              : ("other" as const),
        })),
      readFileString: (path) => readFileSync(path, "utf8"),
    },
    hashStrings: (parts) => {
      const hash = createHash("sha256");
      for (const part of parts) {
        hash.update(part);
        hash.update("\0");
      }
      return hash.digest("hex");
    },
    watch: () => ({ close: () => undefined }),
  };
}

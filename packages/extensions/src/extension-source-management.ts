import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  type ConfigureExtensionTypescriptApiInput,
  type ConfigureExtensionTypescriptApiResult,
  ExtensionError,
  type ExtensionError as ExtensionErrorType,
} from "@svvy/core";
import { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import { PackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";
import { getExtensionRecord } from "./extension-records";

const ManifestObjectSchema = Schema.Record(Schema.String, Schema.Unknown);
export const TypescriptApiExtensionManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String.check(Schema.isNonEmpty()),
  interface: Schema.Literal("svvyx"),
  typescriptApiEnabled: Schema.Boolean,
});
const decodeManifestObject = Schema.decodeUnknownEffect(ManifestObjectSchema);
const decodeTypescriptApiExtensionManifest = Schema.decodeUnknownEffect(
  TypescriptApiExtensionManifestSchema,
);

export function materializeBuiltinExtensionSource(
  extensionId: string,
): Effect.Effect<
  { readonly liveRoot: string; readonly created: boolean },
  ExtensionErrorType,
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort
> {
  const operation = "extensions.sources.materialize-builtin";
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const templates = yield* (yield* PackagedExtensionTemplatesPort).roots();
    const record = getExtensionRecord(extensionId);
    const fail = (
      message: string,
      reason: "invalid-input" | "not-found" | "execution-failed",
      cause?: unknown,
    ) =>
      new ExtensionError({
        operation,
        reason,
        extensionId,
        message,
        ...(cause === undefined ? {} : { cause }),
      });
    if (!record || record.category !== "builtin") {
      return yield* Effect.fail(
        fail(`Builtin extension does not exist: ${extensionId}`, "not-found"),
      );
    }
    const liveRoot = path.resolve(roots.extensionsRoot, "sources", "builtin", extensionId);
    const liveExists = yield* fs
      .exists(liveRoot)
      .pipe(
        Effect.mapError((cause) =>
          fail("Failed to inspect builtin extension source.", "execution-failed", cause),
        ),
      );
    if (liveExists) {
      const liveManifest = path.resolve(liveRoot, "manifest.json");
      const manifestExists = yield* fs
        .exists(liveManifest)
        .pipe(
          Effect.mapError((cause) =>
            fail("Failed to inspect builtin extension manifest.", "execution-failed", cause),
          ),
        );
      if (!manifestExists) {
        return yield* Effect.fail(
          fail(
            `Builtin extension source is partial and cannot be scaffolded implicitly: ${extensionId}`,
            "invalid-input",
          ),
        );
      }
      return { liveRoot, created: false };
    }
    const packagedRoot = path.resolve(templates.builtinExtensionsRoot, extensionId);
    if (
      !(yield* fs
        .exists(packagedRoot)
        .pipe(
          Effect.mapError((cause) =>
            fail("Failed to inspect packaged builtin template.", "execution-failed", cause),
          ),
        ))
    ) {
      return yield* Effect.fail(
        fail(`Packaged builtin template does not exist: ${extensionId}`, "not-found"),
      );
    }
    const nonce = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError((cause) =>
        fail("Failed to allocate builtin scaffold transaction id.", "execution-failed", cause),
      ),
    );
    const staging = `${liveRoot}.staging-${nonce}`;
    yield* copyTree({
      fs,
      path,
      from: packagedRoot,
      to: staging,
      onFailure: (message, cause) => fail(message, "execution-failed", cause),
    });
    yield* fs
      .makeDirectory(path.dirname(liveRoot), { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          fail("Failed to create builtin extension source root.", "execution-failed", cause),
        ),
      );
    const published = yield* fs.rename(staging, liveRoot).pipe(
      Effect.as(true),
      Effect.catch(() =>
        fs.exists(liveRoot).pipe(
          Effect.mapError((cause) =>
            fail("Failed to inspect raced builtin source publication.", "execution-failed", cause),
          ),
          Effect.flatMap((exists) =>
            exists
              ? Effect.succeed(false)
              : Effect.fail(
                  fail(
                    `Failed to publish builtin extension source: ${liveRoot}`,
                    "execution-failed",
                  ),
                ),
          ),
        ),
      ),
      Effect.ensuring(fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)),
    );
    return { liveRoot, created: published };
  });
}

export function promoteStagedExtensionSource(input: {
  fs: FileSystem.FileSystem;
  live: string;
  staging: string;
  backup: string;
  onFailure: (message: string, cause: unknown) => ExtensionErrorType;
}): Effect.Effect<void, ExtensionErrorType> {
  const rename = (from: string, to: string, message: string) =>
    input.fs.rename(from, to).pipe(Effect.mapError((cause) => input.onFailure(message, cause)));
  return rename(
    input.live,
    input.backup,
    `Failed to begin extension source promotion: ${input.live}`,
  ).pipe(
    Effect.andThen(
      rename(input.staging, input.live, `Failed to promote extension source: ${input.live}`).pipe(
        Effect.tapError(() => input.fs.rename(input.backup, input.live).pipe(Effect.ignore)),
      ),
    ),
    Effect.andThen(
      input.fs.remove(input.backup, { recursive: true, force: true }).pipe(Effect.ignore),
    ),
  );
}

export function configureExtensionTypescriptApi(
  input: ConfigureExtensionTypescriptApiInput,
): Effect.Effect<
  ConfigureExtensionTypescriptApiResult,
  ExtensionErrorType,
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort
> {
  const operation = "extensions.sources.configure-typescript-api";
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const templates = yield* (yield* PackagedExtensionTemplatesPort).roots();
    const fail = (
      message: string,
      reason: "invalid-input" | "not-found" | "execution-failed",
      cause?: unknown,
    ) =>
      new ExtensionError({
        operation,
        reason,
        extensionId: input.extensionId,
        message,
        ...(cause === undefined ? {} : { cause }),
      });
    const io = <A>(effect: Effect.Effect<A, unknown>, message: string) =>
      effect.pipe(Effect.mapError((cause) => fail(message, "execution-failed", cause)));
    const user = path.resolve(roots.extensionsRoot, "sources", "user", input.extensionId);
    const builtin = path.resolve(roots.extensionsRoot, "sources", "builtin", input.extensionId);
    let live = user;
    if (!(yield* io(fs.exists(user), `Failed to inspect extension ${input.extensionId}.`))) {
      live = builtin;
      if (!(yield* io(fs.exists(builtin), `Failed to inspect extension ${input.extensionId}.`))) {
        const record = getExtensionRecord(input.extensionId);
        if (!record || record.interface !== "svvyx") {
          return yield* Effect.fail(
            fail(`Editable svvyx extension source not found: ${input.extensionId}`, "not-found"),
          );
        }
        const packaged = path.join(templates.builtinExtensionsRoot, input.extensionId);
        if (
          !(yield* io(
            fs.exists(packaged),
            `Failed to inspect builtin extension template ${input.extensionId}.`,
          ))
        ) {
          return yield* Effect.fail(
            fail(
              `Builtin svvyx namespace is app-owned and has no editable source: ${input.extensionId}`,
              "invalid-input",
            ),
          );
        }
        const scaffoldNonce = yield* crypto.randomUUIDv4.pipe(
          Effect.mapError((cause) =>
            fail("Failed to allocate builtin scaffold transaction id.", "execution-failed", cause),
          ),
        );
        const scaffold = `${builtin}.staging-${scaffoldNonce}`;
        yield* copyTree({
          fs,
          path,
          from: packaged,
          to: scaffold,
          onFailure: (message, cause) => fail(message, "execution-failed", cause),
        });
        yield* io(
          fs.makeDirectory(path.dirname(builtin), { recursive: true }),
          "Failed to create builtin extension source root.",
        );
        yield* io(
          fs.rename(scaffold, builtin),
          `Failed to publish builtin extension source: ${builtin}`,
        ).pipe(
          Effect.tapError(() =>
            fs.remove(scaffold, { recursive: true, force: true }).pipe(Effect.ignore),
          ),
        );
      }
    }
    const manifestPath = path.join(live, "manifest.json");
    const text = yield* io(
      fs.readFileString(manifestPath),
      `Failed to read extension manifest: ${manifestPath}`,
    );
    const parsed = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) =>
        fail(`Extension manifest is invalid JSON: ${manifestPath}`, "invalid-input", cause),
    });
    const raw = yield* decodeManifestObject(parsed).pipe(
      Effect.mapError((cause) =>
        fail(`Extension manifest is not an object: ${manifestPath}`, "invalid-input", cause),
      ),
    );
    const validated = yield* decodeTypescriptApiExtensionManifest(raw).pipe(
      Effect.mapError((cause) =>
        fail(
          `TypeScript API is valid only for editable svvyx extension manifests: ${input.extensionId}`,
          "invalid-input",
          cause,
        ),
      ),
    );
    if (validated.typescriptApiEnabled === input.enabled) {
      return {
        extensionId: input.extensionId,
        enabled: input.enabled,
        changed: false,
        reconcileRequired: false,
      };
    }
    const nonce = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError((cause) =>
        fail("Failed to allocate extension transaction id.", "execution-failed", cause),
      ),
    );
    const staging = `${live}.staging-${nonce}`;
    const backup = `${live}.backup-${nonce}`;
    yield* copyTree({
      fs,
      path,
      from: live,
      to: staging,
      onFailure: (message, cause) => fail(message, "execution-failed", cause),
    });
    const stagedManifest = path.join(staging, "manifest.json");
    yield* io(
      fs.writeFileString(
        stagedManifest,
        `${JSON.stringify({ ...raw, typescriptApiEnabled: input.enabled, workflowTaskAgentReferenceExportEnabled: input.enabled }, null, 2)}\n`,
      ),
      `Failed to write staged extension manifest: ${stagedManifest}`,
    ).pipe(
      Effect.tapError(() =>
        fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
    );
    yield* promoteStagedExtensionSource({
      fs,
      live,
      staging,
      backup,
      onFailure: (message, cause) => fail(message, "execution-failed", cause),
    });
    return {
      extensionId: input.extensionId,
      enabled: input.enabled,
      changed: true,
      reconcileRequired: true,
    };
  });
}

export function copyTree(input: {
  fs: FileSystem.FileSystem;
  path: Path.Path;
  from: string;
  to: string;
  onFailure: (message: string, cause: unknown) => ExtensionErrorType;
}): Effect.Effect<void, ExtensionErrorType> {
  const io = <A>(effect: Effect.Effect<A, unknown>, message: string) =>
    effect.pipe(Effect.mapError((cause) => input.onFailure(message, cause)));
  return Effect.gen(function* () {
    yield* io(
      input.fs.makeDirectory(input.to, { recursive: true }),
      `Failed to create extension staging directory: ${input.to}`,
    );
    const entries = yield* io(
      input.fs.readDirectory(input.from),
      `Failed to list extension source: ${input.from}`,
    );
    yield* Effect.forEach(
      entries,
      (name) => {
        const source = input.path.join(input.from, name);
        const target = input.path.join(input.to, name);
        return input.fs.readLink(source).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
          Effect.flatMap((isLink) =>
            isLink
              ? Effect.fail(
                  input.onFailure(
                    `Extension source contains a symbolic link: ${source}`,
                    new Error("Symbolic links are not allowed in extension source transactions."),
                  ),
                )
              : io(input.fs.stat(source), `Failed to inspect extension source: ${source}`).pipe(
                  Effect.flatMap((stat) =>
                    stat.type === "Directory"
                      ? copyTree({ ...input, from: source, to: target })
                      : stat.type === "File"
                        ? io(
                            input.fs.readFile(source),
                            `Failed to read extension source: ${source}`,
                          ).pipe(
                            Effect.flatMap((bytes) =>
                              io(
                                input.fs.writeFile(target, bytes),
                                `Failed to copy extension source: ${target}`,
                              ),
                            ),
                          )
                        : Effect.fail(
                            input.onFailure(
                              `Extension source contains an unsupported filesystem entry: ${source}`,
                              new Error(`Unsupported extension source entry type: ${stat.type}`),
                            ),
                          ),
                  ),
                ),
          ),
        );
      },
      { discard: true },
    );
  });
}

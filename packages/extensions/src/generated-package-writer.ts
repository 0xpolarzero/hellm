import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ExtensionError, type AbsolutePath } from "@svvy/core";

export interface GeneratedPackageWriteFile {
  readonly relativePath: string;
  readonly contents: string;
}

export const replaceGeneratedPackageDirectory = Effect.fn(
  "@svvy/extensions/replaceGeneratedPackageDirectory",
)(function* (input: {
  readonly generatedPackagePath: AbsolutePath;
  readonly files: readonly GeneratedPackageWriteFile[];
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const parentPath = path.dirname(input.generatedPackagePath);
  const packageName = path.basename(input.generatedPackagePath);
  yield* fs.makeDirectory(parentPath, { recursive: true });

  const tempPath = yield* fs.makeTempDirectory({
    directory: parentPath,
    prefix: `.svvy-${packageName}-`,
  });
  const backupPath = `${tempPath}.previous`;
  let tempMoved = false;
  let backupCreated = false;
  const removeTempIfPresent = fs
    .remove(tempPath, { recursive: true, force: true })
    .pipe(Effect.catchCause(() => Effect.void));
  const restoreBackupIfNeeded = Effect.suspend(() =>
    backupCreated && !tempMoved
      ? fs.rename(backupPath, input.generatedPackagePath).pipe(Effect.catchCause(() => Effect.void))
      : Effect.void,
  );

  return yield* Effect.gen(function* () {
    for (const file of input.files) {
      const segments = file.relativePath.split(/[\\/]+/u);
      if (
        file.relativePath.length === 0 ||
        file.relativePath.startsWith("/") ||
        /^[A-Za-z]:[\\/]/u.test(file.relativePath) ||
        segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
      ) {
        return yield* Effect.fail(
          new ExtensionError({
            operation: "@svvy/extensions/replaceGeneratedPackageDirectory",
            reason: "invalid-input",
            message: `Generated package file path must be relative: ${file.relativePath}`,
          }),
        );
      }
      const target = path.join(tempPath, file.relativePath);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFileString(target, file.contents);
    }

    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const liveExists = yield* fs.exists(input.generatedPackagePath);
        if (!liveExists) {
          yield* fs.rename(tempPath, input.generatedPackagePath);
          tempMoved = true;
          return;
        }

        yield* fs.remove(backupPath, { recursive: true, force: true });
        yield* fs.rename(input.generatedPackagePath, backupPath);
        backupCreated = true;
        yield* fs.rename(tempPath, input.generatedPackagePath).pipe(
          Effect.catchCause((cause) =>
            fs.rename(backupPath, input.generatedPackagePath).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  backupCreated = false;
                }),
              ),
              Effect.catchCause(() => Effect.void),
              Effect.andThen(Effect.failCause(cause)),
            ),
          ),
        );
        tempMoved = true;
        yield* fs.remove(backupPath, { recursive: true, force: true });
        backupCreated = false;
      }),
    );
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() =>
        tempMoved ? Effect.void : restoreBackupIfNeeded.pipe(Effect.andThen(removeTempIfPresent)),
      ),
    ),
  );
});

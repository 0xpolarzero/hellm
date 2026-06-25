import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { AbsolutePath } from "@svvy/core";

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
  const removeTempIfPresent = fs
    .remove(tempPath, { recursive: true, force: true })
    .pipe(Effect.catchCause(() => Effect.void));

  return yield* Effect.gen(function* () {
    for (const file of input.files) {
      const target = path.join(tempPath, file.relativePath);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFileString(target, file.contents);
    }

    const liveExists = yield* fs.exists(input.generatedPackagePath);
    if (!liveExists) {
      tempMoved = true;
      yield* fs.rename(tempPath, input.generatedPackagePath);
      return;
    }

    yield* fs.remove(backupPath, { recursive: true, force: true });
    yield* fs.rename(input.generatedPackagePath, backupPath);
    tempMoved = true;
    yield* fs.rename(tempPath, input.generatedPackagePath).pipe(
      Effect.catchCause((cause) =>
        fs.rename(backupPath, input.generatedPackagePath).pipe(
          Effect.catchCause(() => Effect.void),
          Effect.andThen(Effect.failCause(cause)),
        ),
      ),
    );
    yield* fs.remove(backupPath, { recursive: true, force: true });
  }).pipe(Effect.ensuring(Effect.suspend(() => (tempMoved ? Effect.void : removeTempIfPresent))));
});

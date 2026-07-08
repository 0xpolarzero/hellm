import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

export function testPlatformLayer(): Layer.Layer<FileSystem.FileSystem | Path.Path> {
  return Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, testFileSystem()),
    Layer.succeed(Path.Path, testPath()),
  );
}

function testFileSystem(): FileSystem.FileSystem {
  return {
    makeDirectory: () => Effect.void,
  } as unknown as FileSystem.FileSystem;
}

function testPath(): Path.Path {
  return {
    sep: "/",
    dirname: dirnamePath,
    join: (...segments: readonly string[]) => normalizePath(segments.join("/")),
  } as unknown as Path.Path;
}

function dirnamePath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return normalized.startsWith("/")
    ? parts.length > 0
      ? `/${parts.join("/")}`
      : "/"
    : parts.join("/") || ".";
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts = path.split("/").filter((part) => part.length > 0 && part !== ".");
  return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
}

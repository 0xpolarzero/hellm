import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AbsolutePath, ExtensionError } from "@svvy/core";

export interface ExtensionSourceRoots {
  readonly extensionsRoot: AbsolutePath;
  readonly workflowsSourceRoot: AbsolutePath;
}

export interface ExtensionSourceRootsPortService {
  roots(): Effect.Effect<ExtensionSourceRoots, ExtensionError>;
}

export interface ExtensionSourceRootsPort {
  readonly _tag: "ExtensionSourceRootsPort";
}

export const ExtensionSourceRootsPort = Context.Service<
  ExtensionSourceRootsPort,
  ExtensionSourceRootsPortService
>("@svvy/extensions/ExtensionSourceRootsPort");

export function layerExtensionSourceRootsPort(
  roots: ExtensionSourceRoots,
): Layer.Layer<ExtensionSourceRootsPort> {
  return Layer.succeed(ExtensionSourceRootsPort, {
    roots: () => Effect.succeed(roots),
  });
}

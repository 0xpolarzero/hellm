import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AbsolutePath, ExtensionError } from "@svvy/core";

export interface GeneratedPackageRoots {
  readonly workflowsPackageRoot: AbsolutePath;
  readonly extensionsPackageRoot: AbsolutePath;
  readonly coreTypeContractPackageRoot: AbsolutePath;
}

export interface GeneratedPackageRootPortService {
  roots(): Effect.Effect<GeneratedPackageRoots, ExtensionError>;
}

export interface GeneratedPackageRootPort {
  readonly _tag: "GeneratedPackageRootPort";
}

export const GeneratedPackageRootPort = Context.Service<
  GeneratedPackageRootPort,
  GeneratedPackageRootPortService
>("@svvy/extensions/GeneratedPackageRootPort");

export function layerGeneratedPackageRootPort(
  roots: GeneratedPackageRoots,
): Layer.Layer<GeneratedPackageRootPort> {
  return Layer.succeed(GeneratedPackageRootPort, {
    roots: () => Effect.succeed(roots),
  });
}

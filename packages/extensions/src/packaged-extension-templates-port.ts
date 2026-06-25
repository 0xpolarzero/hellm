import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AbsolutePath, ExtensionError } from "@svvy/core";

export interface PackagedExtensionTemplateRoots {
  readonly builtinExtensionsRoot: AbsolutePath;
}

export interface PackagedExtensionTemplatesPortService {
  roots(): Effect.Effect<PackagedExtensionTemplateRoots, ExtensionError>;
}

export interface PackagedExtensionTemplatesPort {
  readonly _tag: "PackagedExtensionTemplatesPort";
}

export const PackagedExtensionTemplatesPort = Context.Service<
  PackagedExtensionTemplatesPort,
  PackagedExtensionTemplatesPortService
>("@svvy/extensions/PackagedExtensionTemplatesPort");

export function layerPackagedExtensionTemplatesPort(
  roots: PackagedExtensionTemplateRoots,
): Layer.Layer<PackagedExtensionTemplatesPort> {
  return Layer.succeed(PackagedExtensionTemplatesPort, {
    roots: () => Effect.succeed(roots),
  });
}

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type ExtensionBuildProcessEvidence,
  type ExtensionBuildProcessPlan,
  type ExtensionError,
} from "@svvy/core";

export interface ExtensionBuildProcessPortService {
  run(
    plan: ExtensionBuildProcessPlan,
  ): Effect.Effect<ExtensionBuildProcessEvidence, ExtensionError>;
}

export interface ExtensionBuildProcessPort {
  readonly _tag: "ExtensionBuildProcessPort";
}

export const ExtensionBuildProcessPort = Context.Service<
  ExtensionBuildProcessPort,
  ExtensionBuildProcessPortService
>("@svvy/extensions/ExtensionBuildProcessPort");

export const layerExtensionBuildProcessPort = (service: ExtensionBuildProcessPortService) =>
  Layer.succeed(ExtensionBuildProcessPort, service);

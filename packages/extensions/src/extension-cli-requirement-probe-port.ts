import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ExtensionError,
  type ExtensionCliRequirementProbeEvidence,
  type ExtensionCliRequirementProbePlan,
} from "@svvy/core";

export interface ExtensionCliRequirementProbePortService {
  probe(
    plan: ExtensionCliRequirementProbePlan,
  ): Effect.Effect<ExtensionCliRequirementProbeEvidence, ExtensionError>;
}

export interface ExtensionCliRequirementProbePort {
  readonly _tag: "ExtensionCliRequirementProbePort";
}

export const ExtensionCliRequirementProbePort = Context.Service<
  ExtensionCliRequirementProbePort,
  ExtensionCliRequirementProbePortService
>("@svvy/extensions/ExtensionCliRequirementProbePort");

export const layerExtensionCliRequirementProbePort = (
  service: ExtensionCliRequirementProbePortService,
) => Layer.succeed(ExtensionCliRequirementProbePort, service);

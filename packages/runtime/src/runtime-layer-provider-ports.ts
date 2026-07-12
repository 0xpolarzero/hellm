import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import { type ReasoningEffort, RuntimeContractError } from "@svvy/core";

export interface RuntimeLayerProviderAuthPortService {
  ensureUsableProviderAuth(
    provider: string,
  ): Effect.Effect<string | undefined, RuntimeContractError>;
  getProviderAuthUnavailableMessage(provider: string): string;
}

export interface RuntimeLayerProviderAuthPort {
  readonly _tag: "RuntimeLayerProviderAuthPort";
}

export const RuntimeLayerProviderAuthPort = Context.Service<
  RuntimeLayerProviderAuthPort,
  RuntimeLayerProviderAuthPortService
>("@svvy/runtime/RuntimeLayerProviderAuthPort");

export interface RuntimeLayerResolvedModel {
  readonly provider: string;
  readonly model: string;
  readonly supportedReasoning: readonly ReasoningEffort[];
}

export interface RuntimeLayerModelResolverPortService {
  resolveModel(input: {
    readonly provider: string;
    readonly model: string;
  }): Effect.Effect<RuntimeLayerResolvedModel, RuntimeContractError>;
}

export interface RuntimeLayerModelResolverPort {
  readonly _tag: "RuntimeLayerModelResolverPort";
}

export const RuntimeLayerModelResolverPort = Context.Service<
  RuntimeLayerModelResolverPort,
  RuntimeLayerModelResolverPortService
>("@svvy/runtime/RuntimeLayerModelResolverPort");

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ExtensionError,
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort,
  type GeneratedPackagesRefreshResult,
  type InternalRefreshGeneratedPackagesRequest,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  refreshRuntimeGeneratedPackages,
  type RuntimeGeneratedPackageRefreshHost,
} from "./generated-package-refresh";

export interface RuntimeGeneratedPackageRefreshHostPortService extends Omit<
  RuntimeGeneratedPackageRefreshHost,
  "buildGeneratedPackages" | "planWorkspaceLinkRepair" | "publishStateInvalidations"
> {}

export interface RuntimeGeneratedPackageRefreshHostPort {
  readonly _tag: "RuntimeGeneratedPackageRefreshHostPort";
}

export const RuntimeGeneratedPackageRefreshHostPort = Context.Service<
  RuntimeGeneratedPackageRefreshHostPort,
  RuntimeGeneratedPackageRefreshHostPortService
>("@svvy/runtime/RuntimeGeneratedPackageRefreshHostPort");

export interface RuntimeGeneratedPackageRefreshServiceService {
  refresh(
    input: InternalRefreshGeneratedPackagesRequest,
  ): Effect.Effect<GeneratedPackagesRefreshResult, RuntimeContractError>;
}

export class RuntimeGeneratedPackageRefreshService extends Context.Service<
  RuntimeGeneratedPackageRefreshService,
  RuntimeGeneratedPackageRefreshServiceService
>()("@svvy/runtime/RuntimeGeneratedPackageRefreshService") {}

export const layerRuntimeGeneratedPackageRefreshService = Layer.effect(
  RuntimeGeneratedPackageRefreshService,
  Effect.gen(function* () {
    const generatedPackageRefreshHost = yield* RuntimeGeneratedPackageRefreshHostPort;
    const generatedPackageState = yield* RuntimeGeneratedPackageStatePort;
    const eventBus = yield* RuntimeEventBus;
    const extensions = yield* Extensions;

    return RuntimeGeneratedPackageRefreshService.of({
      refresh: (input) =>
        refreshRuntimeGeneratedPackages(input, {
          ...generatedPackageRefreshHost,
          buildGeneratedPackages: (buildInput) =>
            Effect.gen(function* () {
              if (buildInput.packages.includes("@svvyx/workflows")) {
                yield* generatedPackageRefreshHost.materializeCoreTypeContractPackage();
              }
              return yield* extensions.generatedPackages.refresh(buildInput);
            }).pipe(
              Effect.mapError((cause) =>
                cause instanceof RuntimeContractError
                  ? cause
                  : generatedPackageExtensionError(
                      "runtime.sourceInvalidation.refreshGeneratedPackages.build",
                      cause,
                    ),
              ),
            ),
          planWorkspaceLinkRepair: (linkInput) =>
            extensions.generatedPackages
              .planWorkspaceLink(linkInput)
              .pipe(
                Effect.mapError((cause) =>
                  generatedPackageExtensionError(
                    "runtime.sourceInvalidation.refreshGeneratedPackages.planWorkspaceLink",
                    cause,
                  ),
                ),
              ),
          publishStateInvalidations: (afterCommit) =>
            eventBus.publishStateInvalidations({ afterCommit }).pipe(
              Effect.mapError(
                (cause) =>
                  new RuntimeContractError({
                    operation: "runtime.sourceInvalidation.refreshGeneratedPackages.publish",
                    reason: "state-conflict",
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Runtime generated-package refresh publication failed.",
                    cause,
                  }),
              ),
              Effect.asVoid,
            ),
        }).pipe(Effect.provideService(RuntimeGeneratedPackageStatePort, generatedPackageState)),
    });
  }),
);

function generatedPackageExtensionError(
  operation: string,
  cause: ExtensionError,
): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: cause.reason === "invalid-input" ? "invalid-input" : "state-conflict",
    message: cause.message,
    cause,
  });
}

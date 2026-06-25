import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  AbsolutePath,
  ExtensionError,
  GeneratedPackageWorkspaceLinkRepairInput,
} from "@svvy/core";

export interface WorkspaceSourceLinkPortService {
  generatedPackageLinkPath(
    input: GeneratedPackageWorkspaceLinkRepairInput,
  ): Effect.Effect<AbsolutePath, ExtensionError>;
}

export interface WorkspaceSourceLinkPort {
  readonly _tag: "WorkspaceSourceLinkPort";
}

export const WorkspaceSourceLinkPort = Context.Service<
  WorkspaceSourceLinkPort,
  WorkspaceSourceLinkPortService
>("@svvy/extensions/WorkspaceSourceLinkPort");

export function layerWorkspaceSourceLinkPort(
  service: WorkspaceSourceLinkPortService,
): Layer.Layer<WorkspaceSourceLinkPort> {
  return Layer.succeed(WorkspaceSourceLinkPort, service);
}

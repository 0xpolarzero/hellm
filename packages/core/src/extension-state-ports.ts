import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { AbsolutePath } from "./ids";
import type { StateContractError } from "./errors";
import type { ExtensionDependencyReadiness } from "./runtime-state-ports";

export interface ExtensionDependencyApprovalIdentity {
  readonly kind: "dependency" | "trusted_dependency";
  readonly packageManager: "bun";
  readonly source: "npm";
  readonly name: string;
  readonly version: string;
  readonly integrity: string | null;
  readonly resolution: string | null;
}

export interface ReadExtensionSourceFingerprintInput {
  readonly sourceRoot: AbsolutePath;
}

export interface ReadExtensionDependencyApprovalInput {
  readonly dependency: ExtensionDependencyApprovalIdentity;
}

export interface ReadExtensionDependencyReadinessInput {
  readonly extensionId: ExtensionDependencyReadiness["extensionId"];
  readonly requirementId: ExtensionDependencyReadiness["requirementId"];
}

export interface ExtensionStatePortService {
  readonly records: {
    readSourceFingerprint(
      input: ReadExtensionSourceFingerprintInput,
    ): Effect.Effect<string | null, StateContractError>;
  };
  readonly dependencies: {
    isApproved(
      input: ReadExtensionDependencyApprovalInput,
    ): Effect.Effect<boolean, StateContractError>;
    readReadiness(
      input: ReadExtensionDependencyReadinessInput,
    ): Effect.Effect<ExtensionDependencyReadiness | null, StateContractError>;
  };
}

export interface ExtensionStatePort {
  readonly _tag: "ExtensionStatePort";
}

export const ExtensionStatePort = Context.Service<ExtensionStatePort, ExtensionStatePortService>(
  "@svvy/core/ExtensionStatePort",
);

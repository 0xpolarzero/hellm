import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type { SecretStorePortError } from "./errors";
import { IsoDateTimeStringSchema } from "./ids";

export const SecretStatusSnapshotSchema = Schema.Struct({
  key: Schema.String,
  configured: Schema.Boolean,
  redactedLabel: Schema.optionalKey(Schema.String),
  revisionFingerprint: Schema.optionalKey(Schema.String),
  updatedAt: Schema.optionalKey(IsoDateTimeStringSchema),
});
export type SecretStatusSnapshot = typeof SecretStatusSnapshotSchema.Type;

export interface SecretInvocationValue {
  key: string;
  value: Redacted.Redacted<string>;
  revisionFingerprint: string;
}

export interface GetSecretStatusInput {
  key: string;
}

export interface ListSecretStatusInput {
  namespace?: string;
}

export interface ResolveSecretInvocationValueInput {
  key: string;
}

export interface SecretStorePortService {
  getStatus(input: GetSecretStatusInput): Effect.Effect<SecretStatusSnapshot, SecretStorePortError>;
  listStatus(
    input?: ListSecretStatusInput,
  ): Effect.Effect<readonly SecretStatusSnapshot[], SecretStorePortError>;
  resolveInvocationValue(
    input: ResolveSecretInvocationValueInput,
  ): Effect.Effect<SecretInvocationValue, SecretStorePortError>;
}

export interface SecretStorePort {
  readonly _tag: "SecretStorePort";
}

export const SecretStorePort = Context.Service<SecretStorePort, SecretStorePortService>(
  "@svvy/core/SecretStorePort",
);

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import type { PiAdapterError, PiSessionReferencePortError } from "./errors";
import { SurfacePiSessionId, WorkspaceId } from "./ids";
import type {
  PiRuntimePathsSnapshot,
  PiSessionReference,
  PiSessionReferenceValidation,
} from "./pi-adapter-contracts";
import { PiSessionReferenceSchema } from "./pi-adapter-contracts";
import { ActorKindSchema } from "./runtime-contracts";
import type { StateMutationResult } from "./runtime-state-ports";

export const GetPiSessionReferenceInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
});
export type GetPiSessionReferenceInput = typeof GetPiSessionReferenceInputSchema.Type;

export const SavePiSessionReferenceInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  reference: PiSessionReferenceSchema,
});
export type SavePiSessionReferenceInput = typeof SavePiSessionReferenceInputSchema.Type;

export const DeletePiSessionReferenceInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
});
export type DeletePiSessionReferenceInput = typeof DeletePiSessionReferenceInputSchema.Type;

export const ValidatePiSessionReferenceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  surfacePiSessionId: SurfacePiSessionId,
  actorKind: ActorKindSchema,
  reference: PiSessionReferenceSchema,
});
export type ValidatePiSessionReferenceInput = typeof ValidatePiSessionReferenceInputSchema.Type;

export const ResolvePiRuntimePathsInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
});
export type ResolvePiRuntimePathsInput = typeof ResolvePiRuntimePathsInputSchema.Type;

export const decodeUnknownGetPiSessionReferenceInputExit = Schema.decodeUnknownExit(
  GetPiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGetPiSessionReferenceInputEffect = Schema.decodeUnknownEffect(
  GetPiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeGetPiSessionReferenceInputExit = Schema.encodeExit(
  GetPiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeGetPiSessionReferenceInputEffect = Schema.encodeEffect(
  GetPiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSavePiSessionReferenceInputExit = Schema.decodeUnknownExit(
  SavePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSavePiSessionReferenceInputEffect = Schema.decodeUnknownEffect(
  SavePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSavePiSessionReferenceInputExit = Schema.encodeExit(
  SavePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSavePiSessionReferenceInputEffect = Schema.encodeEffect(
  SavePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownDeletePiSessionReferenceInputExit = Schema.decodeUnknownExit(
  DeletePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownDeletePiSessionReferenceInputEffect = Schema.decodeUnknownEffect(
  DeletePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeDeletePiSessionReferenceInputExit = Schema.encodeExit(
  DeletePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeDeletePiSessionReferenceInputEffect = Schema.encodeEffect(
  DeletePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownValidatePiSessionReferenceInputExit = Schema.decodeUnknownExit(
  ValidatePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownValidatePiSessionReferenceInputEffect = Schema.decodeUnknownEffect(
  ValidatePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeValidatePiSessionReferenceInputExit = Schema.encodeExit(
  ValidatePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeValidatePiSessionReferenceInputEffect = Schema.encodeEffect(
  ValidatePiSessionReferenceInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownResolvePiRuntimePathsInputExit = Schema.decodeUnknownExit(
  ResolvePiRuntimePathsInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownResolvePiRuntimePathsInputEffect = Schema.decodeUnknownEffect(
  ResolvePiRuntimePathsInputSchema,
  strictBoundaryParseOptions,
);
export const encodeResolvePiRuntimePathsInputExit = Schema.encodeExit(
  ResolvePiRuntimePathsInputSchema,
  strictBoundaryParseOptions,
);
export const encodeResolvePiRuntimePathsInputEffect = Schema.encodeEffect(
  ResolvePiRuntimePathsInputSchema,
  strictBoundaryParseOptions,
);

export interface PiSessionReferencePortService {
  getPiSessionReference(
    input: GetPiSessionReferenceInput,
  ): Effect.Effect<PiSessionReference | undefined, PiSessionReferencePortError>;
  savePiSessionReference(
    input: SavePiSessionReferenceInput,
  ): Effect.Effect<StateMutationResult<PiSessionReference>, PiSessionReferencePortError>;
  deletePiSessionReference(
    input: DeletePiSessionReferenceInput,
  ): Effect.Effect<
    StateMutationResult<{ surfacePiSessionId: SurfacePiSessionId }>,
    PiSessionReferencePortError
  >;
  validatePiSessionReference(
    input: ValidatePiSessionReferenceInput,
  ): Effect.Effect<PiSessionReferenceValidation, PiSessionReferencePortError>;
}

export interface PiSessionReferencePort {
  readonly _tag: "PiSessionReferencePort";
}

export const PiSessionReferencePort = Context.Service<
  PiSessionReferencePort,
  PiSessionReferencePortService
>("@svvy/core/PiSessionReferencePort");

export interface PiRuntimePathsPortService {
  resolve(input: ResolvePiRuntimePathsInput): Effect.Effect<PiRuntimePathsSnapshot, PiAdapterError>;
}

export interface PiRuntimePathsPort {
  readonly _tag: "PiRuntimePathsPort";
}

export const PiRuntimePathsPort = Context.Service<PiRuntimePathsPort, PiRuntimePathsPortService>(
  "@svvy/core/PiRuntimePathsPort",
);

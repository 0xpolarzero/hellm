import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type {
  CancelCommandInput,
  CancelCommandResult,
  RuntimeContractError,
  WriteCommandStdinInput,
  WriteCommandStdinResult,
} from "@svvy/core";

export interface RuntimeLayerCommandStdinPortService {
  writeStdin(
    input: WriteCommandStdinInput,
  ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError>;
}

export interface RuntimeLayerCommandStdinPort {
  readonly _tag: "RuntimeLayerCommandStdinPort";
}

export const RuntimeLayerCommandStdinPort = Context.Service<
  RuntimeLayerCommandStdinPort,
  RuntimeLayerCommandStdinPortService
>("@svvy/runtime/RuntimeLayerCommandStdinPort");

export interface RuntimeLayerCommandControlPortService {
  cancel(input: CancelCommandInput): Effect.Effect<CancelCommandResult, RuntimeContractError>;
}

export interface RuntimeLayerCommandControlPort {
  readonly _tag: "RuntimeLayerCommandControlPort";
}

export const RuntimeLayerCommandControlPort = Context.Service<
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandControlPortService
>("@svvy/runtime/RuntimeLayerCommandControlPort");

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  AppendAppLogInputSchema,
  AppLogWritePort,
  StateContractError,
  strictBoundaryParseOptions,
  type AppLogEntryId,
  type AppendAppLogInput,
  type AppLogRelatedLink,
  type AppLogWriteResult,
  type AppLogWritePortService,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { AppLogState, type AppendAppLogEntry } from "./app-log-store";
import { mutationResult } from "./state-mutation-result";

const decodeAppendAppLogInput = Schema.decodeUnknownEffect(
  AppendAppLogInputSchema,
  strictBoundaryParseOptions,
);

export function appLogWritePortFromAppLogState(
  appLogs: AppLogState["Service"],
): AppLogWritePortService {
  return {
    append: (input) =>
      Effect.gen(function* () {
        const decoded = yield* decodeAppendAppLogInput(input).pipe(
          Effect.mapError(
            (cause) =>
              new StateContractError({
                operation: "app-log.write.append",
                reason: "invalid-input",
                message: cause.message,
                cause,
              }),
          ),
        );
        const entry = yield* appLogs.append(appendInputToStoreEntry(decoded));
        return mutationResult(
          { appLogEntryId: entry.id as AppLogEntryId },
          appLogWriteInvalidations(decoded),
        ) satisfies AppLogWriteResult;
      }),
  };
}

export const makeAppLogWritePort = Effect.fn("@svvy/state/makeAppLogWritePort")(function* () {
  const appLogs = yield* AppLogState;
  return appLogWritePortFromAppLogState(appLogs);
});

export const layerAppLogWritePort = Layer.effect(AppLogWritePort, makeAppLogWritePort());

function appendInputToStoreEntry(input: AppendAppLogInput): AppendAppLogEntry {
  const related = relatedFields(input.related);
  return {
    createdAt: input.occurredAt,
    level: input.level,
    source: input.source,
    message: input.message,
    ...(input.details ? { details: input.details } : {}),
    ...(input.normalizedError ? { error: input.normalizedError } : {}),
    ...related,
  };
}

function relatedFields(
  related: readonly AppLogRelatedLink[] | undefined,
): Pick<
  AppendAppLogEntry,
  | "workspaceSessionId"
  | "surfacePiSessionId"
  | "threadId"
  | "workflowRunId"
  | "workflowTaskAttemptId"
  | "commandId"
  | "artifactId"
> {
  const fields: ReturnType<typeof relatedFields> = {};
  for (const link of related ?? []) {
    switch (link.kind) {
      case "workspace-session":
        fields.workspaceSessionId ??= link.id;
        break;
      case "surface":
        fields.surfacePiSessionId ??= link.id;
        break;
      case "thread":
        fields.threadId ??= link.id;
        break;
      case "command":
        fields.commandId ??= link.id;
        break;
      case "artifact":
        fields.artifactId ??= link.id;
        break;
      case "workflow-run":
        fields.workflowRunId ??= link.id;
        break;
      case "workflow-task-attempt":
        fields.workflowTaskAttemptId ??= link.id;
        break;
    }
  }
  return fields;
}

function appLogWriteInvalidations(
  input: AppendAppLogInput,
): readonly StateInvalidationDescriptor[] {
  return input.workspaceId
    ? [
        {
          scope: "workspace",
          workspaceId: input.workspaceId,
          invalidation: { model: "appLogs" },
        },
      ]
    : [];
}

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { join } from "node:path";
import {
  completeSimple,
  getModel,
  type AssistantMessage,
  type ImageContent,
  type Model,
} from "@mariozechner/pi-ai";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import {
  decodeUnknownGenerateTitleResultEffect,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  PiAdapterError,
  ProviderAuthPort,
  ProviderAuthStatusStatePort,
  RuntimeToolExecutionError,
  type ActorKind,
  type ClosePiSessionInput,
  type CreatePiSessionInput,
  type GenerateTitleInput,
  type GenerateTitleResult,
  type InterruptPiTurnInput,
  type ListModelsInput,
  type ModelInfo,
  type NativeToolResult,
  type OpenPiSessionInput,
  type PiRuntimeEvent,
  type PiRuntimePathsSnapshot,
  type PiSessionRef,
  type PiSessionReference,
  type PiToolExecutionUpdate,
  type ProviderAuthPortError,
  type ProviderCredentialSnapshot,
  type ProviderUsableCredentialSnapshot,
  type RunPiTurnInput,
  type RuntimeSubmittedMessage,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
  type WorkspaceId,
} from "@svvy/core";
import { normalizePiAgentEventToRuntimeEventsSync } from "./events";
import { createPiManagedAgentSession, type CreatePiManagedAgentSessionResult } from "./session";
import { runtimeSubmittedMessagePromptText } from "./messages";
import { readPiModelCatalog } from "./model-catalog";

export interface PiAdapterSessionsService {
  create(
    input: CreatePiSessionInput,
  ): Effect.Effect<
    PiSessionRef,
    PiAdapterError,
    Scope.Scope | ProviderAuthPort | PiRuntimePathsPort | PiSessionReferencePort
  >;
  open(
    input: OpenPiSessionInput,
  ): Effect.Effect<
    PiSessionRef,
    PiAdapterError,
    Scope.Scope | ProviderAuthPort | PiRuntimePathsPort | PiSessionReferencePort
  >;
  close(input: ClosePiSessionInput): Effect.Effect<void, PiAdapterError>;
}

export interface PiAdapterModelsService {
  list(
    input: ListModelsInput,
  ): Effect.Effect<readonly ModelInfo[], PiAdapterError, ProviderAuthStatusStatePort>;
}

export interface PiAdapterHelperJobsService {
  generateTitle(
    input: GenerateTitleInput,
  ): Effect.Effect<GenerateTitleResult, PiAdapterError, ProviderAuthPort | PiRuntimePathsPort>;
}

export interface PiAdapterTurnStream {
  readonly stream: Stream.Stream<PiRuntimeEvent, PiAdapterError>;
  close(): Effect.Effect<void, PiAdapterError>;
  readonly closed: Effect.Effect<void, PiAdapterError>;
}

export interface PiAdapterTurnsService {
  run(
    input: RunPiTurnInput,
  ): Effect.Effect<
    PiAdapterTurnStream,
    PiAdapterError,
    Scope.Scope | ProviderAuthPort | PiSessionReferencePort
  >;
  interrupt(
    input: InterruptPiTurnInput,
  ): Effect.Effect<void, PiAdapterError, PiSessionReferencePort>;
}

export interface PiAdapterService {
  sessions: PiAdapterSessionsService;
  turns: PiAdapterTurnsService;
  models: PiAdapterModelsService;
  helperJobs: PiAdapterHelperJobsService;
}

export class PiAdapter extends Context.Service<PiAdapter, PiAdapterService>()(
  "@svvy/pi-adapter/PiAdapter",
) {}

export const makePiAdapter = Effect.fn("@svvy/pi-adapter/makePiAdapter")(() =>
  Effect.gen(function* () {
    const liveSessions = yield* Ref.make(new Map<string, PiLiveSessionEntry>());

    return PiAdapter.of({
      sessions: {
        create: (input) => createSession(liveSessions, input),
        open: (input) => openSession(liveSessions, input),
        close: (input) => closeSession(liveSessions, input),
      },
      turns: {
        run: (input) => runTurn(liveSessions, input),
        interrupt: (input) => interruptTurn(liveSessions, input),
      },
      models: {
        list: (input) => listModels(input),
      },
      helperJobs: {
        generateTitle: (input) => generateTitle(input),
      },
    });
  }),
);

export const layer = Layer.effect(PiAdapter, makePiAdapter());

type PiManagedAgentSessionFactory = typeof createPiManagedAgentSession;

let createManagedAgentSession: PiManagedAgentSessionFactory = createPiManagedAgentSession;

export function setPiManagedAgentSessionFactoryForTests(
  factory: PiManagedAgentSessionFactory,
): () => void {
  const previous = createManagedAgentSession;
  createManagedAgentSession = factory;
  return () => {
    createManagedAgentSession = previous;
  };
}

const PI_ADAPTER_KIND = "svvy-pi-adapter";
const PI_ADAPTER_VERSION = "0.0.0";
const TITLE_HELPER_TIMEOUT_MS = 30_000;

type PiLiveSessionEntry = {
  readonly token: symbol;
  readonly surfacePiSessionId: SurfacePiSessionId;
  readonly workspaceId: WorkspaceId;
  readonly actorKind: ActorKind;
  readonly reference: PiSessionReference;
  readonly paths: PiRuntimePathsSnapshot;
  readonly sessionManager: SessionManager;
  readonly activeTurn?: PiLiveActiveTurn;
  readonly lastTerminalTurnId?: TurnId;
};

type PiLiveActiveTurn = {
  readonly turnId: TurnId;
  readonly agentSession?: AgentSession;
};

type LiveRegistrationDecision =
  | { readonly kind: "registered" }
  | { readonly kind: "existing" }
  | { readonly kind: "conflict" };

type ActiveTurnReservationDecision =
  | { readonly kind: "reserved" }
  | { readonly kind: "missing" }
  | { readonly kind: "active"; readonly activeTurn: PiLiveActiveTurn }
  | { readonly kind: "terminal" };

function createSession(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  input: CreatePiSessionInput,
): Effect.Effect<
  PiSessionRef,
  PiAdapterError,
  Scope.Scope | ProviderAuthPort | PiRuntimePathsPort | PiSessionReferencePort
> {
  return Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const runtimePaths = yield* PiRuntimePathsPort;
    const references = yield* PiSessionReferencePort;
    yield* requireUsableProviderCredential("pi-adapter.sessions.create", {
      workspaceId: input.workspaceId,
      providerId: input.model.providerId,
    });
    const paths = yield* runtimePaths.resolve({ workspaceId: input.workspaceId });
    const sessionFile = join(paths.sessionDir, `${input.surfacePiSessionId}.jsonl`);
    const reference = piSessionReferenceFromCreateInput(input, sessionFile);
    const existing = yield* reuseExistingLiveSessionIfAllowed(liveSessions, {
      operation: "pi-adapter.sessions.create",
      surfacePiSessionId: input.surfacePiSessionId,
      workspaceId: input.workspaceId,
      actorKind: input.actorKind,
      reference,
    });
    if (existing) {
      return existing;
    }

    const sessionManager = yield* Effect.try({
      try: () => SessionManager.open(sessionFile, paths.sessionDir, paths.cwd),
      catch: (cause) =>
        new PiAdapterError({
          operation: "pi-adapter.sessions.create",
          reason: "session-open-failed",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    yield* references
      .savePiSessionReference({
        surfacePiSessionId: input.surfacePiSessionId,
        reference,
      })
      .pipe(
        Effect.mapError((cause) => piSessionReferenceError("pi-adapter.sessions.create", cause)),
      );

    return yield* registerLiveSession(liveSessions, scope, {
      surfacePiSessionId: input.surfacePiSessionId,
      workspaceId: input.workspaceId,
      actorKind: input.actorKind,
      reference,
      paths,
      sessionManager,
    });
  });
}

function openSession(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  input: OpenPiSessionInput,
): Effect.Effect<
  PiSessionRef,
  PiAdapterError,
  Scope.Scope | ProviderAuthPort | PiRuntimePathsPort | PiSessionReferencePort
> {
  return Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const runtimePaths = yield* PiRuntimePathsPort;
    const paths = yield* runtimePaths.resolve({ workspaceId: input.workspaceId });
    const references = yield* PiSessionReferencePort;
    const reference =
      input.expectedReference ??
      (yield* references
        .getPiSessionReference({ surfacePiSessionId: input.surfacePiSessionId })
        .pipe(
          Effect.mapError((cause) => piSessionReferenceError("pi-adapter.sessions.open", cause)),
        ));

    if (!reference) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.sessions.open",
          reason: "session-not-found",
          message: `Pi session reference ${input.surfacePiSessionId} was not found.`,
        }),
      );
    }

    const validation = yield* references
      .validatePiSessionReference({
        workspaceId: input.workspaceId,
        surfacePiSessionId: input.surfacePiSessionId,
        actorKind: input.actorKind,
        reference,
      })
      .pipe(Effect.mapError((cause) => piSessionReferenceError("pi-adapter.sessions.open", cause)));

    if (!validation.valid) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.sessions.open",
          reason: validation.reason === "not-found" ? "session-not-found" : "session-open-failed",
          message: `Pi session reference ${input.surfacePiSessionId} is not valid: ${validation.reason}.`,
        }),
      );
    }
    const providerId = yield* readReferenceProviderId(
      validation.reference,
      "pi-adapter.sessions.open",
    );
    yield* requireUsableProviderCredential("pi-adapter.sessions.open", {
      workspaceId: input.workspaceId,
      providerId,
    });
    const existing = yield* reuseExistingLiveSessionIfAllowed(liveSessions, {
      operation: "pi-adapter.sessions.open",
      surfacePiSessionId: validation.reference.surfacePiSessionId,
      workspaceId: input.workspaceId,
      actorKind: input.actorKind,
      reference: validation.reference,
    });
    if (existing) {
      return existing;
    }

    const sessionManager = yield* Effect.try({
      try: () =>
        SessionManager.open(validation.reference.storageLocator, paths.sessionDir, paths.cwd),
      catch: (cause) =>
        new PiAdapterError({
          operation: "pi-adapter.sessions.open",
          reason: "session-open-failed",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    return yield* registerLiveSession(liveSessions, scope, {
      surfacePiSessionId: validation.reference.surfacePiSessionId,
      workspaceId: input.workspaceId,
      actorKind: input.actorKind,
      reference: validation.reference,
      paths,
      sessionManager,
    });
  });
}

function closeSession(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  input: ClosePiSessionInput,
): Effect.Effect<void, PiAdapterError> {
  return removeLiveSession(liveSessions, input.session.surfacePiSessionId).pipe(Effect.asVoid);
}

function getLiveSession(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  surfacePiSessionId: string,
): Effect.Effect<PiLiveSessionEntry | undefined> {
  return Ref.get(liveSessions).pipe(Effect.map((current) => current.get(surfacePiSessionId)));
}

function runTurn(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  input: RunPiTurnInput,
): Effect.Effect<
  PiAdapterTurnStream,
  PiAdapterError,
  Scope.Scope | ProviderAuthPort | PiSessionReferencePort
> {
  return Effect.gen(function* () {
    const turnScope = yield* Scope.Scope;
    const runtimeContext = yield* Effect.context<never>();
    const liveEntry = yield* getLiveSession(liveSessions, input.session.surfacePiSessionId);
    if (!liveEntry) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.turns.run",
          reason: "session-not-found",
          message: `Pi session ${input.session.surfacePiSessionId} is not open.`,
        }),
      );
    }
    yield* validateLiveSessionReference("pi-adapter.turns.run", liveEntry);
    const credential = yield* requireUsableProviderCredential("pi-adapter.turns.run", {
      workspaceId: liveEntry.workspaceId,
      providerId: input.model.providerId,
    });
    yield* reserveActiveTurn(liveSessions, input);
    const queue = yield* Queue.bounded<PiRuntimeEvent, PiAdapterError>(256);
    yield* Scope.addFinalizer(
      turnScope,
      clearActiveTurn(liveSessions, input.session.surfacePiSessionId, input.turnId, false).pipe(
        Effect.ignore,
      ),
    );

    const managedSession = yield* Effect.tryPromise({
      try: () =>
        createManagedAgentSession({
          cwd: liveEntry.paths.cwd,
          agentDir: liveEntry.paths.agentDir,
          sessionManager: liveEntry.sessionManager,
          provider: input.model.providerId,
          model: input.model.modelId,
          thinkingLevel: input.reasoning.effort as never,
          systemPrompt: input.systemPromptBinding.text,
          tools: input.tools,
          toolExecutor: input.toolExecutor,
          runToolEffect: runTurnToolEffect(
            runtimeContext,
            liveSessions,
            input.session.surfacePiSessionId,
            input.turnId,
          ),
          emitToolExecutionUpdate: runTurnToolExecutionUpdate(runtimeContext, queue, input.session),
          syncAuthStorage: (authStorage) => {
            authStorage.setRuntimeApiKey(
              input.model.providerId,
              Redacted.value(credential.accessToken),
            );
          },
          getToolExecutionContext: ({ piToolCallId, toolName }) => ({
            turnId: input.turnId,
            surfacePiSessionId: input.surfacePiSessionId,
            piToolCallId,
            toolName,
          }),
        }),
      catch: (cause) =>
        new PiAdapterError({
          operation: "pi-adapter.turns.run",
          reason: "turn-failed",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }).pipe(
      Effect.onError(() =>
        clearActiveTurn(liveSessions, input.session.surfacePiSessionId, input.turnId, false),
      ),
    );
    const activeEntry = yield* installActiveTurnAgentSession(
      liveSessions,
      input,
      managedSession.session,
    );
    if (!activeEntry) {
      managedSession.session.dispose();
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.turns.run",
          reason: "turn-not-active",
          message: `Pi turn ${input.turnId} is no longer active for session ${input.session.surfacePiSessionId}.`,
        }),
      );
    }

    return yield* openTurnStream(input, managedSession, runtimeContext, liveSessions, queue);
  });
}

function interruptTurn(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  input: InterruptPiTurnInput,
): Effect.Effect<void, PiAdapterError, PiSessionReferencePort> {
  return Effect.gen(function* () {
    const liveEntry = yield* getLiveSession(liveSessions, input.surfacePiSessionId);
    if (!liveEntry) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.turns.interrupt",
          reason: "session-not-found",
          message: `Pi session ${input.surfacePiSessionId} is not open.`,
        }),
      );
    }
    yield* validateLiveSessionReference("pi-adapter.turns.interrupt", liveEntry);
    const activeTurn = liveEntry.activeTurn;
    if (!activeTurn) {
      const alreadyTerminal = liveEntry.lastTerminalTurnId === input.turnId;
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.turns.interrupt",
          reason: alreadyTerminal ? "turn-already-terminal" : "turn-not-active",
          message: alreadyTerminal
            ? `Pi turn ${input.turnId} is already terminal for session ${input.surfacePiSessionId}.`
            : `Pi session ${input.surfacePiSessionId} has no active turn.`,
        }),
      );
    }
    if (activeTurn.turnId !== input.turnId) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.turns.interrupt",
          reason: "turn-mismatch",
          message: `Pi session ${input.surfacePiSessionId} is running turn ${activeTurn.turnId}, not ${input.turnId}.`,
        }),
      );
    }
    if (!activeTurn.agentSession) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.turns.interrupt",
          reason: "active-turn-running",
          message: `Pi turn ${input.turnId} has not installed an interrupt handle yet.`,
        }),
      );
    }
    yield* Effect.tryPromise({
      try: () => activeTurn.agentSession!.abort(),
      catch: (cause) =>
        new PiAdapterError({
          operation: "pi-adapter.turns.interrupt",
          reason: "turn-failed",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });
}

function validateLiveSessionReference(
  operation: string,
  liveEntry: PiLiveSessionEntry,
): Effect.Effect<void, PiAdapterError, PiSessionReferencePort> {
  return Effect.gen(function* () {
    const references = yield* PiSessionReferencePort;
    const validation = yield* references
      .validatePiSessionReference({
        workspaceId: liveEntry.workspaceId,
        surfacePiSessionId: liveEntry.surfacePiSessionId,
        actorKind: liveEntry.actorKind,
        reference: liveEntry.reference,
      })
      .pipe(Effect.mapError((cause) => piSessionReferenceError(operation, cause)));
    if (!validation.valid) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation,
          reason: validation.reason === "not-found" ? "session-not-found" : "session-open-failed",
          message: `Pi session reference ${liveEntry.surfacePiSessionId} is not valid: ${validation.reason}.`,
        }),
      );
    }
  });
}

function openTurnStream(
  input: RunPiTurnInput,
  managedSession: CreatePiManagedAgentSessionResult,
  runtimeContext: Context.Context<never>,
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  queue: Queue.Queue<PiRuntimeEvent, PiAdapterError>,
): Effect.Effect<PiAdapterTurnStream, PiAdapterError> {
  return Effect.gen(function* () {
    const closed = yield* Deferred.make<void, PiAdapterError>();
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const closeTurn = (abort: boolean): Effect.Effect<void, PiAdapterError> =>
      Effect.gen(function* () {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe?.();
        if (abort) {
          yield* Effect.tryPromise({
            try: () => managedSession.session.abort(),
            catch: (cause) =>
              new PiAdapterError({
                operation: "pi-adapter.turns.close",
                reason: "turn-failed",
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          });
        }
        yield* clearActiveTurn(liveSessions, input.session.surfacePiSessionId, input.turnId, true);
        yield* Queue.shutdown(queue).pipe(Effect.ignore);
        yield* Deferred.succeed(closed, undefined).pipe(Effect.ignore);
      });

    unsubscribe = managedSession.session.subscribe((event) => {
      try {
        const runtimeEvents = normalizePiAgentEventToRuntimeEventsSync({
          session: input.session,
          turnId: input.turnId,
          surfacePiSessionId: input.surfacePiSessionId,
          event,
        });
        void offerPiRuntimeEvents(runtimeContext, queue, runtimeEvents);
      } catch (cause) {
        void Effect.runPromiseWith(runtimeContext)(
          Queue.fail(
            queue,
            cause instanceof PiAdapterError
              ? cause
              : new PiAdapterError({
                  operation: "pi-adapter.turns.events",
                  reason: "event-decode-failed",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
          ).pipe(Effect.andThen(closeTurn(false))),
        );
      }
    });

    const promptText = runtimeSubmittedMessagePromptText(input.userMessage);
    const images = piPromptImagesFromRuntimeSubmittedMessage(input.userMessage);
    void managedSession.session
      .prompt(promptText, {
        expandPromptTemplates: false,
        ...(images ? { images } : {}),
      })
      .then(
        () => Effect.runPromiseWith(runtimeContext)(closeTurn(false)),
        (cause) =>
          Effect.runPromiseWith(runtimeContext)(
            Queue.fail(
              queue,
              new PiAdapterError({
                operation: "pi-adapter.turns.run",
                reason: "turn-failed",
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
            ).pipe(Effect.andThen(closeTurn(false))),
          ),
      );

    const stream = Stream.fromQueue(queue).pipe(
      Stream.ensuring(closeTurn(true).pipe(Effect.ignore)),
    );
    return {
      stream,
      close: () => closeTurn(true),
      closed: Deferred.await(closed),
    };
  });
}

async function offerPiRuntimeEvents(
  runtimeContext: Context.Context<never>,
  queue: Queue.Queue<PiRuntimeEvent, PiAdapterError>,
  events: readonly PiRuntimeEvent[],
): Promise<void> {
  for (const event of events) {
    const exit = await Effect.runPromiseExitWith(runtimeContext)(Queue.offer(queue, event));
    if (Exit.isFailure(exit)) {
      throw piAdapterErrorFromCause("pi-adapter.turns.events", "event-decode-failed", exit.cause);
    }
  }
}

function runTurnToolEffect(
  runtimeContext: Context.Context<never>,
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  surfacePiSessionId: SurfacePiSessionId,
  turnId: TurnId,
) {
  return async (
    effect: Effect.Effect<NativeToolResult, RuntimeToolExecutionError>,
  ): Promise<NativeToolResult> => {
    const guardedEffect: Effect.Effect<
      NativeToolResult,
      RuntimeToolExecutionError | PiAdapterError
    > = Effect.gen(function* () {
      const active = yield* isActiveTurn(liveSessions, surfacePiSessionId, turnId);
      if (!active) {
        return yield* Effect.fail(
          new PiAdapterError({
            operation: "pi-adapter.turns.tool",
            reason: "turn-not-active",
            message: `Pi turn ${turnId} is not active for session ${surfacePiSessionId}.`,
          }),
        );
      }
      return yield* effect;
    });
    const exit = await Effect.runPromiseExitWith(runtimeContext)(guardedEffect);
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    throw piAdapterErrorFromCause("pi-adapter.turns.tool", "tool-execution-failed", exit.cause);
  };
}

function runTurnToolExecutionUpdate(
  runtimeContext: Context.Context<never>,
  queue: Queue.Queue<PiRuntimeEvent, PiAdapterError>,
  session: RunPiTurnInput["session"],
) {
  return (input: {
    readonly turnId: TurnId;
    readonly surfacePiSessionId: SurfacePiSessionId;
    readonly piToolCallId: ToolCallId;
    readonly toolName: string;
    readonly update: PiToolExecutionUpdate;
  }): Effect.Effect<void, RuntimeToolExecutionError> =>
    Effect.tryPromise({
      try: () =>
        offerPiRuntimeEvents(runtimeContext, queue, [
          {
            session,
            turnId: input.turnId,
            surfacePiSessionId: input.surfacePiSessionId,
            type: "pi.tool_execution.updated",
            toolCallId: input.piToolCallId,
            toolName: input.toolName,
            update: input.update,
          },
        ]),
      catch: (cause) =>
        new RuntimeToolExecutionError({
          turnId: input.turnId,
          surfacePiSessionId: input.surfacePiSessionId,
          piToolCallId: input.piToolCallId,
          toolName: input.toolName,
          commandId: input.update.commandId,
          reason: "cancelled",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
}

export type PiTitleCompletion = (input: {
  readonly model: Model<string>;
  readonly prompt: string;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly reasoning: GenerateTitleInput["reasoning"];
  readonly signal: AbortSignal;
}) => Promise<AssistantMessage>;

let completePiTitle: PiTitleCompletion = defaultCompletePiTitle;

export function setPiTitleCompletionForTests(completion: PiTitleCompletion): () => void {
  const previous = completePiTitle;
  completePiTitle = completion;
  return () => {
    completePiTitle = previous;
  };
}

function generateTitle(
  input: GenerateTitleInput,
): Effect.Effect<GenerateTitleResult, PiAdapterError, ProviderAuthPort | PiRuntimePathsPort> {
  return Effect.gen(function* () {
    const operation = "pi-adapter.helperJobs.generateTitle";
    const credential = yield* requireUsableProviderCredential(operation, {
      workspaceId: input.workspaceId,
      providerId: input.model.providerId,
    });
    const runtimePaths = yield* PiRuntimePathsPort;
    const paths = yield* runtimePaths
      .resolve({ workspaceId: input.workspaceId })
      .pipe(Effect.mapError((cause) => runtimePathsError(operation, cause)));

    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(input.model.providerId, Redacted.value(credential.accessToken));
    const modelRegistry = ModelRegistry.create(authStorage, paths.modelRegistryPath);
    const model =
      modelRegistry.find(input.model.providerId, input.model.modelId) ??
      getModel(input.model.providerId as never, input.model.modelId as never);
    if (!model) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation,
          reason: "model-read-failed",
          message: `Model not found: ${input.model.providerId}/${input.model.modelId}`,
        }),
      );
    }

    const auth = yield* Effect.tryPromise({
      try: () => modelRegistry.getApiKeyAndHeaders(model),
      catch: (cause) =>
        new PiAdapterError({
          operation,
          reason: "provider-auth-failed",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    if (!auth.ok) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation,
          reason: "provider-auth-failed",
          message: auth.error,
        }),
      );
    }

    const assistantMessage = yield* runTitleCompletionWithTimeout(input, model, auth);
    if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
      return yield* Effect.fail(
        new PiAdapterError({
          operation,
          reason: "helper-job-failed",
          message:
            assistantMessage.errorMessage ?? `Title helper stopped: ${assistantMessage.stopReason}`,
        }),
      );
    }

    const title = normalizeGeneratedTitle(extractAssistantText(assistantMessage));
    if (!title || isGenericGeneratedTitle(title)) {
      return yield* Effect.fail(
        new PiAdapterError({
          operation,
          reason: "helper-job-failed",
          message: title
            ? `Title helper returned a generic title: ${title}`
            : "Title helper returned an empty title.",
        }),
      );
    }

    return yield* decodeUnknownGenerateTitleResultEffect({
      title,
      model: input.model,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new PiAdapterError({
            operation,
            reason: "helper-job-failed",
            message: cause.message,
            cause,
          }),
      ),
    );
  });
}

function runTitleCompletionWithTimeout(
  input: GenerateTitleInput,
  model: Model<string>,
  auth: { readonly apiKey?: string; readonly headers?: Record<string, string> },
): Effect.Effect<AssistantMessage, PiAdapterError> {
  const operation = "pi-adapter.helperJobs.generateTitle";
  return Effect.tryPromise({
    try: (signal) =>
      completePiTitle({
        model,
        prompt: input.prompt,
        reasoning: input.reasoning,
        signal,
        ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
        ...(auth.headers ? { headers: auth.headers } : {}),
      }),
    catch: (cause) =>
      new PiAdapterError({
        operation,
        reason: "helper-job-failed",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: TITLE_HELPER_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new PiAdapterError({
            operation,
            reason: "helper-job-failed",
            message: `Title helper timed out after ${TITLE_HELPER_TIMEOUT_MS}ms.`,
          }),
        ),
    }),
  );
}

async function defaultCompletePiTitle(input: Parameters<PiTitleCompletion>[0]) {
  return completeSimple(
    input.model as never,
    {
      messages: [
        {
          role: "user",
          content: input.prompt,
          timestamp: 0,
        },
      ],
    },
    {
      reasoning: input.reasoning.effort as never,
      temperature: 0,
      maxTokens: 64,
      signal: input.signal,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
    },
  );
}

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeGeneratedTitle(input: string): string {
  const firstLine = input
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  const title = (firstLine ?? "")
    .replace(/^["'`]+|["'`.!?]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalizeTitleCasing(title);
}

function isGenericGeneratedTitle(title: string): boolean {
  return /^(New|New Session|Session|Chat|Conversation|Request|Task)$/iu.test(title.trim());
}

function normalizeTitleCasing(title: string): string {
  const words = title.split(/\s+/u);
  if (words.length <= 1) {
    return title;
  }
  if (words.every((word) => /^[A-Z0-9][A-Za-z0-9'/-]*$/u.test(word))) {
    const [first, ...rest] = words;
    return [
      first!,
      ...rest.map((word) =>
        /^[A-Z]{2,}$|^[A-Z0-9]+[-/][A-Z0-9]+$/u.test(word)
          ? word
          : `${word.slice(0, 1).toLocaleLowerCase()}${word.slice(1)}`,
      ),
    ].join(" ");
  }
  return title;
}

function piAdapterErrorFromCause(
  operation: string,
  reason: ConstructorParameters<typeof PiAdapterError>[0]["reason"],
  cause: Cause.Cause<unknown>,
): PiAdapterError {
  const failure = cause.reasons.find(Cause.isFailReason)?.error;
  if (failure instanceof PiAdapterError) {
    return failure;
  }
  return new PiAdapterError({
    operation,
    reason,
    message:
      failure instanceof Error ? failure.message : failure ? String(failure) : Cause.pretty(cause),
    cause,
  });
}

function piPromptImagesFromRuntimeSubmittedMessage(
  message: RuntimeSubmittedMessage,
): ImageContent[] | undefined {
  const images = (message.attachments ?? []).flatMap((attachment) =>
    attachment.kind === "image" && attachment.dataBase64 && attachment.mimeType
      ? [
          {
            type: "image" as const,
            data: attachment.dataBase64,
            mimeType: attachment.mimeType,
          },
        ]
      : [],
  );
  return images.length > 0 ? images : undefined;
}

function piSessionReferenceFromCreateInput(
  input: CreatePiSessionInput,
  storageLocator: string,
): PiSessionReference {
  const metadata: Record<string, string> = {
    actorKind: input.actorKind,
    generatedContextFingerprint: input.generatedContextFingerprint,
    modelId: input.model.modelId,
    providerId: input.model.providerId,
    reasoningEffort: input.reasoning.effort,
    workspaceId: input.workspaceId,
    workspaceSessionId: input.workspaceSessionId,
  };
  if (input.agentProfileId) {
    metadata.agentProfileId = input.agentProfileId;
  }

  return {
    surfacePiSessionId: input.surfacePiSessionId,
    referenceFingerprint: [
      PI_ADAPTER_KIND,
      PI_ADAPTER_VERSION,
      input.workspaceId,
      input.workspaceSessionId,
      input.surfacePiSessionId,
      input.generatedContextFingerprint,
    ].join(":"),
    adapterKind: PI_ADAPTER_KIND,
    adapterVersion: PI_ADAPTER_VERSION,
    storageLocator,
    metadata,
  };
}

function reuseExistingLiveSessionIfAllowed(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  input: {
    readonly operation: string;
    readonly surfacePiSessionId: SurfacePiSessionId;
    readonly workspaceId: WorkspaceId;
    readonly actorKind: ActorKind;
    readonly reference: PiSessionReference;
  },
): Effect.Effect<PiSessionRef | undefined, PiAdapterError> {
  return Effect.gen(function* () {
    const liveEntry = yield* getLiveSession(liveSessions, input.surfacePiSessionId);
    if (!liveEntry) {
      return undefined;
    }
    if (canReuseLiveSession(liveEntry, input)) {
      return { surfacePiSessionId: input.surfacePiSessionId };
    }
    return yield* Effect.fail(liveSessionConflictError(input.operation, input.surfacePiSessionId));
  });
}

function registerLiveSession(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  scope: Scope.Scope,
  input: {
    readonly surfacePiSessionId: SurfacePiSessionId;
    readonly workspaceId: WorkspaceId;
    readonly actorKind: ActorKind;
    readonly reference: PiSessionReference;
    readonly paths: PiRuntimePathsSnapshot;
    readonly sessionManager: SessionManager;
  },
): Effect.Effect<PiSessionRef, PiAdapterError> {
  return Effect.gen(function* () {
    const token = Symbol(input.surfacePiSessionId);
    const entry: PiLiveSessionEntry = {
      token,
      surfacePiSessionId: input.surfacePiSessionId,
      workspaceId: input.workspaceId,
      actorKind: input.actorKind,
      reference: input.reference,
      paths: input.paths,
      sessionManager: input.sessionManager,
    };
    const decision = yield* Ref.modify(
      liveSessions,
      (current): readonly [LiveRegistrationDecision, Map<string, PiLiveSessionEntry>] => {
        const oldEntry = current.get(input.surfacePiSessionId);
        if (oldEntry) {
          if (canReuseLiveSession(oldEntry, input)) {
            return [{ kind: "existing" as const }, current] as const;
          }
          return [{ kind: "conflict" as const }, current] as const;
        }
        const next = new Map(current);
        next.set(input.surfacePiSessionId, entry);
        return [{ kind: "registered" as const }, next] as const;
      },
    );
    if (decision.kind === "conflict") {
      return yield* Effect.fail(
        liveSessionConflictError("pi-adapter.sessions.register", input.surfacePiSessionId),
      );
    }
    if (decision.kind === "existing") {
      return { surfacePiSessionId: input.surfacePiSessionId };
    }
    yield* Scope.addFinalizer(
      scope,
      releaseLiveSession(liveSessions, input.surfacePiSessionId, token),
    );
    return { surfacePiSessionId: input.surfacePiSessionId };
  });
}

function canReuseLiveSession(
  liveEntry: PiLiveSessionEntry,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly actorKind: ActorKind;
    readonly reference: PiSessionReference;
  },
): boolean {
  return (
    !liveEntry.activeTurn &&
    liveEntry.workspaceId === input.workspaceId &&
    liveEntry.actorKind === input.actorKind &&
    liveEntry.reference.referenceFingerprint === input.reference.referenceFingerprint &&
    liveEntry.reference.metadata?.providerId === input.reference.metadata?.providerId &&
    liveEntry.reference.metadata?.modelId === input.reference.metadata?.modelId
  );
}

function liveSessionConflictError(operation: string, surfacePiSessionId: SurfacePiSessionId) {
  return new PiAdapterError({
    operation,
    reason: "session-conflict",
    message: `Pi session ${surfacePiSessionId} already has a conflicting live handle or active turn.`,
  });
}

function reserveActiveTurn(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  input: RunPiTurnInput,
): Effect.Effect<void, PiAdapterError> {
  return Effect.gen(function* () {
    const decision = yield* Ref.modify(
      liveSessions,
      (current): readonly [ActiveTurnReservationDecision, Map<string, PiLiveSessionEntry>] => {
        const liveEntry = current.get(input.session.surfacePiSessionId);
        if (!liveEntry) {
          return [{ kind: "missing" as const }, current] as const;
        }
        if (liveEntry.activeTurn) {
          return [{ kind: "active" as const, activeTurn: liveEntry.activeTurn }, current] as const;
        }
        if (liveEntry.lastTerminalTurnId === input.turnId) {
          return [{ kind: "terminal" as const }, current] as const;
        }
        const next = new Map(current);
        next.set(input.session.surfacePiSessionId, {
          ...liveEntry,
          activeTurn: { turnId: input.turnId },
        });
        return [{ kind: "reserved" as const }, next] as const;
      },
    );
    if (decision.kind === "reserved") {
      return;
    }
    if (decision.kind === "missing") {
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.turns.run",
          reason: "session-not-found",
          message: `Pi session ${input.session.surfacePiSessionId} is not open.`,
        }),
      );
    }
    if (decision.kind === "terminal") {
      return yield* Effect.fail(
        new PiAdapterError({
          operation: "pi-adapter.turns.run",
          reason: "turn-already-terminal",
          message: `Pi turn ${input.turnId} is already terminal for session ${input.session.surfacePiSessionId}.`,
        }),
      );
    }
    return yield* Effect.fail(
      new PiAdapterError({
        operation: "pi-adapter.turns.run",
        reason: "active-turn-running",
        message: `Pi session ${input.session.surfacePiSessionId} is already running turn ${decision.activeTurn.turnId}.`,
      }),
    );
  });
}

function installActiveTurnAgentSession(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  input: RunPiTurnInput,
  agentSession: AgentSession,
): Effect.Effect<boolean> {
  return Ref.modify(liveSessions, (current) => {
    const liveEntry = current.get(input.session.surfacePiSessionId);
    if (!liveEntry || liveEntry.activeTurn?.turnId !== input.turnId) {
      return [false, current] as const;
    }
    const next = new Map(current);
    next.set(input.session.surfacePiSessionId, {
      ...liveEntry,
      activeTurn: { turnId: input.turnId, agentSession },
    });
    return [true, next] as const;
  });
}

function clearActiveTurn(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  surfacePiSessionId: SurfacePiSessionId,
  turnId: TurnId,
  terminal: boolean,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const activeTurn = yield* Ref.modify(liveSessions, (current) => {
      const liveEntry = current.get(surfacePiSessionId);
      if (!liveEntry || liveEntry.activeTurn?.turnId !== turnId) {
        return [undefined, current] as const;
      }
      const next = new Map(current);
      next.set(surfacePiSessionId, {
        token: liveEntry.token,
        surfacePiSessionId: liveEntry.surfacePiSessionId,
        workspaceId: liveEntry.workspaceId,
        actorKind: liveEntry.actorKind,
        reference: liveEntry.reference,
        paths: liveEntry.paths,
        sessionManager: liveEntry.sessionManager,
        ...(liveEntry.lastTerminalTurnId
          ? { lastTerminalTurnId: liveEntry.lastTerminalTurnId }
          : {}),
        ...(terminal ? { lastTerminalTurnId: turnId } : {}),
      });
      return [liveEntry.activeTurn, next] as const;
    });
    disposeActiveTurn(activeTurn);
  });
}

function isActiveTurn(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  surfacePiSessionId: SurfacePiSessionId,
  turnId: TurnId,
): Effect.Effect<boolean> {
  return Ref.get(liveSessions).pipe(
    Effect.map((current) => current.get(surfacePiSessionId)?.activeTurn?.turnId === turnId),
  );
}

function disposeActiveTurn(activeTurn: PiLiveActiveTurn | undefined): void {
  activeTurn?.agentSession?.dispose();
}

function releaseLiveSession(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  surfacePiSessionId: string,
  token: symbol,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const entry = yield* Ref.modify(liveSessions, (current) => {
      const liveEntry = current.get(surfacePiSessionId);
      if (!liveEntry || liveEntry.token !== token) {
        return [undefined, current] as const;
      }
      const next = new Map(current);
      next.delete(surfacePiSessionId);
      return [liveEntry, next] as const;
    });
    disposeActiveTurn(entry?.activeTurn);
  });
}

function removeLiveSession(
  liveSessions: Ref.Ref<Map<string, PiLiveSessionEntry>>,
  surfacePiSessionId: string,
): Effect.Effect<PiLiveSessionEntry | undefined> {
  return Effect.gen(function* () {
    const entry = yield* Ref.modify(liveSessions, (current) => {
      const liveEntry = current.get(surfacePiSessionId);
      if (!liveEntry) {
        return [undefined, current] as const;
      }
      const next = new Map(current);
      next.delete(surfacePiSessionId);
      return [liveEntry, next] as const;
    });
    disposeActiveTurn(entry?.activeTurn);
    return entry;
  });
}

function piSessionReferenceError(
  operation: string,
  cause: {
    readonly message: string;
  },
): PiAdapterError {
  return new PiAdapterError({
    operation,
    reason: "session-reference-failed",
    message: cause.message,
    cause,
  });
}

function requireUsableProviderCredential(
  operation: string,
  input: { readonly workspaceId: WorkspaceId; readonly providerId: string },
): Effect.Effect<ProviderUsableCredentialSnapshot, PiAdapterError, ProviderAuthPort> {
  return Effect.gen(function* () {
    const providerAuth = yield* ProviderAuthPort;
    const snapshot = yield* providerAuth
      .getProviderAuthSnapshot({
        workspaceId: input.workspaceId,
        providerId: input.providerId as never,
      })
      .pipe(Effect.mapError((cause) => providerAuthPortError(operation, cause)));
    if (snapshot.health === "usable") {
      return snapshot;
    }
    if (snapshot.health !== "expired") {
      return yield* Effect.fail(
        providerCredentialSnapshotError(operation, input.providerId, snapshot),
      );
    }

    const refreshed = yield* providerAuth
      .refreshProviderCredentialSnapshot({
        workspaceId: input.workspaceId,
        providerId: input.providerId as never,
        reason: "expired",
      })
      .pipe(Effect.mapError((cause) => providerAuthPortError(operation, cause)));
    if (refreshed.health === "usable") {
      return refreshed;
    }
    return yield* Effect.fail(
      providerCredentialSnapshotError(operation, input.providerId, refreshed),
    );
  });
}

function providerCredentialSnapshotError(
  operation: string,
  providerId: string,
  snapshot: Exclude<ProviderCredentialSnapshot, ProviderUsableCredentialSnapshot>,
): PiAdapterError {
  return new PiAdapterError({
    operation,
    reason:
      snapshot.health === "missing"
        ? "provider-auth-missing"
        : snapshot.health === "expired"
          ? "provider-auth-expired"
          : "provider-auth-refresh-failed",
    message: snapshot.issue ?? `Provider ${providerId} credential is ${snapshot.health}.`,
  });
}

function readReferenceProviderId(
  reference: PiSessionReference,
  operation: string,
): Effect.Effect<string, PiAdapterError> {
  const providerId = reference.metadata?.providerId;
  if (typeof providerId === "string" && providerId.length > 0) {
    return Effect.succeed(providerId);
  }
  return Effect.fail(
    new PiAdapterError({
      operation,
      reason: "provider-auth-failed",
      message: `Pi session reference ${reference.surfacePiSessionId} does not include provider metadata.`,
    }),
  );
}

function providerAuthPortError(operation: string, cause: ProviderAuthPortError): PiAdapterError {
  return new PiAdapterError({
    operation,
    reason: "provider-auth-failed",
    message: cause.message,
    cause,
  });
}

function runtimePathsError(
  operation: string,
  cause: {
    readonly message: string;
  },
): PiAdapterError {
  return new PiAdapterError({
    operation,
    reason: "runtime-paths-failed",
    message: cause.message,
    cause,
  });
}

function listModels(
  input: ListModelsInput,
): Effect.Effect<readonly ModelInfo[], PiAdapterError, ProviderAuthStatusStatePort> {
  return Effect.gen(function* () {
    const providerAuthStatus = yield* ProviderAuthStatusStatePort;
    const authStatuses = yield* providerAuthStatus
      .listProviderStatuses({ workspaceId: input.workspaceId })
      .pipe(
        Effect.mapError(
          (cause) =>
            new PiAdapterError({
              operation: "pi-adapter.models.list",
              reason: "provider-auth-failed",
              message: cause.message,
              cause,
            }),
        ),
      );
    return readPiModelCatalog({
      workspaceId: input.workspaceId,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      authStatuses,
    });
  });
}

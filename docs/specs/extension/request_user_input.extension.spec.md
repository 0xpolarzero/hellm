# Request User Input Extension Spec

## Status

- Date: 2026-06-03
- Status: adopted product spec
- Scope:
  - define the builtin Request User Input native extension
  - define the model-facing `request_user_input` API
  - define the nonblocking and blocking runtime variants
  - define the runtime answer API, blocking answer resolution, nonblocking queued delivery, and side-panel behavior
  - define which state is file-backed extension source and which state is product-state-backed

`request_user_input` is the model-facing way for orchestrator and handler-thread agents to ask the
user for missing intent. Generic waiting state remains product state, and model-facing clarification
uses this tool.

## Source References

This design borrows only the useful narrow shape from Codex:

- Codex names the tool `request_user_input`.
- Codex asks one to three questions.
- Codex choices use short user-facing labels plus one-sentence tradeoff descriptions.
- Codex recommends two to three mutually exclusive choices.
- Codex clients add a custom-answer affordance. In `svvy`, custom answers are submitted through the
  runtime answer API as `{ kind: "custom" }`, not as a model-authored "Other" option.

Local Codex reference files:

- `docs/references/codex/codex-rs/core/src/tools/handlers/request_user_input_spec.rs`
- `docs/references/codex/codex-rs/protocol/src/request_user_input.rs`
- `docs/references/codex/codex-rs/core/src/session/mod.rs`
- `docs/references/codex/codex-rs/tui/src/bottom_pane/request_user_input/`

Related `svvy` specs:

- `docs/specs/extensions-and-tools.spec.md`
- `docs/specs/extension/extension_managing.extension.spec.md`
- `docs/specs/queued-messages.spec.md`
- `docs/specs/live-tool-projection.spec.md`
- `docs/specs/structured-session-state.spec.md`

## Product Role

Request User Input is a builtin native tool extension for asking the user a bounded question while
preserving the normal coding-agent turn and queue model.

The extension has one visible product identity:

```json
{
  "id": "request-user-input",
  "title": "Request User Input",
  "category": "builtin",
  "interface": "native_tool"
}
```

It exposes one model-facing tool name:

```text
request_user_input
```

Default usage state:

| Actor kind          | State       |
| ------------------- | ----------- |
| Orchestrator        | loaded      |
| Handler             | loaded      |
| Workflow task agent | unavailable |

Workflow task agents do not receive this extension by default. A workflow task-agent attempt is a
runtime-managed pi-backed task-attempt surface; user clarification routes through the supervising
handler thread instead of letting a task-local agent open independent user-input requests.

## Dual Runtime Variant

The visible extension is a dual extension. The user sees one extension row and one extension pane,
but the app owns two internal variants:

| Variant       | Runtime behavior                                                                                                                                                                                                                       | Tool name            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `nonblocking` | The tool creates answerable side-panel requests, immediately returns the agent's default answer, and lets later user answers submit through `runtime.requestInput.answer`; nonblocking answers create queued delivery when applicable. | `request_user_input` |
| `blocking`    | The tool creates answerable side-panel requests and does not return until the user answers or the configured timeout supplies the default answer.                                                                                      | `request_user_input` |

The current variant is an app-global product setting for this builtin extension. Switching the
variant changes all three of these surfaces together:

- loaded instruction files
- tool runtime implementation
- generated tool declaration and schema descriptions

The agent must see only the currently active variant. It must not receive a prompt paragraph saying
"the current mode is nonblocking" or "the user may respond later." Those facts belong in the active
variant's instructions and runtime behavior, not in tool results.

When the active variant changes:

- the extension's generated context fingerprint changes
- every orchestrator or handler surface that has this extension loaded becomes stale by fingerprint
  mismatch and follows the normal checked-by-default update-before-next-turn pre-dispatch refresh
  rule
- already-created request records keep their original behavior and do not change variant mid-flight
- new tool calls use the newly active variant

## Extension Source And Settings Storage

File-backed extension source:

```text
~/.config/svvy/extensions/sources/builtin/request-user-input/
  manifest.json
  variants/
    nonblocking/
      instructions/full/*.mdx
      instructions/minimal.mdx
    blocking/
      instructions/full/*.mdx
      instructions/minimal.mdx
```

Product-state-backed settings and runtime records:

- active variant: `nonblocking` or `blocking`
- blocking timeout enabled flag
- blocking timeout duration
- request/question/option records written through `RuntimeRequestStatePort`
- default/user/timeout answer records written through `RuntimeRequestStatePort`
- `queuedItemId`-linked queue records only for later nonblocking user answers
- blocking timeout deadline, paused/resumed facts, and answer/default facts written through
  `RuntimeRequestStatePort`; process-local timeout fibers and wait-registry entries are runtime
  coordination state and are never product state
- command progress, waiting state, and terminal command facts written through
  `RuntimeCommandStatePort`
- session/surface wait projection created by blocking requests through `RuntimeSessionWaitStatePort`

Request User Input settings are DB/product-state-backed extension settings. The user-facing
extension pane submits an explicit runtime request. `@svvy/runtime` commits active variant and
blocking-timeout configuration through core-owned state ports implemented by `@svvy/state`, receives
after-commit descriptors, and publishes typed notifications after commit. Runtime reads the
committed settings when generating/binding the active extension variant and when resolving accepted
tool behavior. Extension handlers never write these settings.

Blocking wait and timeout execution is runtime-owned. The blocking implementation uses
`RuntimeRequestStatePort`, `RuntimeCommandStatePort`, `RuntimeSessionWaitStatePort`, a
runtime-owned pending wait registry, scoped `Deferred` completion, and Effect time services.
Blocking waits race the runtime-owned answer `Deferred` against the committed deadline using
`Effect.timeoutOrElse` or an equivalent scoped `Effect.sleep` timer fiber. Runtime computes
remaining time from Effect `DateTime.now` / `Clock`, records the deadline in state, and re-forks the
scoped timer only after committed pause/resume/version changes. Production bootstrap provides the
package layer graph and platform services; it does not provide a custom timeout policy or direct
host timer callbacks. Package tests use Effect test layers and `TestClock` for timeout behavior.
Desktop, renderer, headless, app/bootstrap bridge adapters, and pi-adapter edge adapters do not own
request-input pending maps, timeout/defaulting policy, package-private state-port mutation, command
settlement, or answer delivery. They call runtime/state facades and render read models.

Extension Managing exposes only the active variant's editable source paths when an agent inspects
this extension. Agent edit, reset, revert, and instruction-file lifecycle operations target only the
active variant. The user-facing extension pane may switch variants and may then inspect, edit, reset,
or build the newly active variant as the current extension source view.

The UI may show that this is a dual-mode builtin extension, but Extension Managing's agent-facing
inspection behaves as if there is one extension whose active source files are the relevant files.

## Extension Pane Settings

The Request User Input extension pane contains product-state settings:

- a two-option mode control: `Nonblocking` and `Blocking`
- blocking timeout controls, visible only in `Blocking`
- timeout enabled toggle
- timeout duration input

Default settings:

```json
{
  "mode": "nonblocking",
  "blockingTimeout": {
    "enabled": true,
    "durationMs": 300000
  }
}
```

The default timeout duration is five minutes.

The settings payload above is not a model-facing tool call and is not a tool result. It is the
product-state shape used by the app settings/extension pane boundary.

## Model-Facing Tool API

The model-facing tool name is always:

```text
request_user_input
```

Input:

```ts
type RequestUserInputInput = {
  questions: RequestUserInputQuestion[];
};

type RequestUserInputQuestion = ChoiceQuestion | FreeformQuestion;

type ChoiceQuestion = {
  title: string;
  question: string;
  options: [ChoiceOption, ChoiceOption] | [ChoiceOption, ChoiceOption, ChoiceOption];
};

type ChoiceOption = {
  label: string;
  description: string;
  recommended?: true;
};

type FreeformQuestion = {
  title: string;
  question: string;
  defaultAnswer: string;
};
```

Validation:

- `questions` is required.
- `questions` must contain at least one question and at most three questions.
- every question must have a non-empty `title`.
- `title` is written by the agent and shown as the compact side-panel title.
- the runtime must not generate `title`.
- every question must have a non-empty `question`.
- a choice question must have exactly two or three options.
- choice option `label` is required and should be one to five words.
- choice option `description` is required and must be one short sentence explaining the effect or
  tradeoff.
- exactly one choice option must set `recommended: true`.
- the recommended option is the default answer if the user does not answer.
- a freeform question must have `defaultAnswer`.
- `defaultAnswer` is the default answer if the user does not answer.
- a question must not include both `options` and `defaultAnswer`.
- a question must not include neither `options` nor `defaultAnswer`.
- the agent must not supply ids.
- additional properties are rejected.

Generated internal fields:

- `requestId`
- `questionId`
- `optionId`
- queue ids
- command ids
- timestamps
- status fields
- timer ids

Those fields are mechanical product state. The agent does not write them.

Choice example:

```json
{
  "questions": [
    {
      "title": "CI scope",
      "question": "Should CI run only unit checks or the full suite before handoff?",
      "options": [
        {
          "label": "Unit checks only",
          "description": "Faster; catches type, lint, format, and unit regressions.",
          "recommended": true
        },
        {
          "label": "Full suite",
          "description": "Slower; also verifies e2e behavior."
        }
      ]
    }
  ]
}
```

Freeform example:

```json
{
  "questions": [
    {
      "title": "Release note tone",
      "question": "What release-note tone should I use?",
      "defaultAnswer": "Concise engineering summary focused on user-visible changes."
    }
  ]
}
```

Rejected input shapes:

```json
{
  "questions": [
    {
      "id": "ci_scope",
      "title": "CI scope",
      "question": "Should CI run only unit checks or the full suite?",
      "options": []
    }
  ]
}
```

```json
{
  "questions": [
    {
      "title": "CI scope",
      "question": "Should CI run only unit checks or the full suite?",
      "options": [
        {
          "label": "Unit checks only",
          "description": "Faster."
        },
        {
          "label": "Full suite",
          "description": "Slower."
        }
      ]
    }
  ]
}
```

The first example is rejected because the agent supplied an id and no valid choices. The second is
rejected because no option is explicitly recommended.

## Tool Result API

This is the final model-facing result delivered by `@svvy/runtime` after applying the
`request_input.create` effect. The extension handler returns only validated accepted intent plus the
ordered runtime operation. Both variants deliver the same final output shape:

```ts
type RequestUserInputResult = {
  answers: RequestUserInputResolvedAnswer[];
};

type RequestUserInputResolvedAnswer = {
  title: string;
  question: string;
  answer: RequestUserInputResolvedAnswerValue;
  answeredBy: "user" | "default" | "timeout_default";
};

type RequestUserInputResolvedAnswerValue =
  | {
      kind: "option";
      label: string;
      text: string;
    }
  | {
      kind: "custom";
      text: string;
    };
```

The result must not include:

- active variant
- mode
- `userMayRespondLater`
- timer settings
- request ids
- question ids
- option ids
- command ids
- generated UI header/title guesses
- best-effort summaries of the question
- previews of side-panel state

This is the model-facing tool result delivered back to pi. Durable command facts may mirror the
final `RequestUserInputResult` with projection fields such as question count and answer source for
UI recovery, but those facts are state-backed command data, not extra fields in the model-facing
tool result. Callers that need request ids, question ids, answer ids, queue ids, or command status
must read structured state/read-model surfaces rather than expecting those fields in the tool
result.

Nonblocking immediate result example:

```json
{
  "answers": [
    {
      "title": "CI scope",
      "question": "Should CI run only unit checks or the full suite before handoff?",
      "answer": {
        "kind": "option",
        "label": "Unit checks only",
        "text": "Unit checks only"
      },
      "answeredBy": "default"
    }
  ]
}
```

Blocking user-answer result example:

```json
{
  "answers": [
    {
      "title": "CI scope",
      "question": "Should CI run only unit checks or the full suite before handoff?",
      "answer": {
        "kind": "option",
        "label": "Full suite",
        "text": "Full suite"
      },
      "answeredBy": "user"
    }
  ]
}
```

Blocking timeout result example:

```json
{
  "answers": [
    {
      "title": "CI scope",
      "question": "Should CI run only unit checks or the full suite before handoff?",
      "answer": {
        "kind": "option",
        "label": "Unit checks only",
        "text": "Unit checks only"
      },
      "answeredBy": "timeout_default"
    }
  ]
}
```

## Nonblocking Variant Semantics

The nonblocking variant is the default because ordinary coding-agent behavior should keep momentum
when the agent can choose a conservative default.

Runtime sequence:

1. The model starts composing a `request_user_input` tool call.
2. Live tool projection may show a disabled draft card from streamed arguments.
3. When arguments complete and validate, the extension handler returns validated question/default
   payload only, wrapped in one ordered `ExtensionRuntimeOperation` item for a
   `request_input.create` runtime effect.
4. `@svvy/runtime` attaches `workspaceSessionId`, `surfacePiSessionId`, optional `threadId`,
   `sourceCommandId`, `turnId`, `toolItemId`, active mode, and timeout policy from accepted
   invocation context and committed settings before calling `RuntimeRequestStatePort`;
   nonblocking creation does not create a `request_user_input_answer` queue row.
5. `@svvy/runtime` records created request/question progress through
   `RuntimeCommandStatePort.recordCommandEvent(...)`, then completes the current command through
   `RuntimeCommandStatePort.finishCommand(...)` with final facts containing the default
   `RequestUserInputResult`, question count, and `answeredBy: "default"`.
6. The side panel shows the request as answerable.
7. The tool returns immediately with the recommended/default answers.
8. The agent continues as if those defaults were the user's answer.
9. If the user later answers, the UI calls `runtime.requestInput.answer`; runtime validates and
   records the answer through request state, and only then may enqueue `request_user_input_answer`.

Nonblocking requests must not:

- put the surface or session into a blocked wait state
- hold the prompt lock open
- return a "maybe later" field to the agent
- require the user to answer before the turn continues
- create a second hidden turn outside the normal queue model

The active variant instructions must tell agents:

- use this tool only when user input could materially steer the work and a conservative default is
  available
- ask one to three short questions
- always provide the default through exactly one recommended option or a freeform `defaultAnswer`
- continue using the returned default result
- treat any later queued answer as normal answer follow-up and reassess if it materially changes the
  work

## Blocking Variant Semantics

The blocking variant exists for users who want clarification requests to stop the agent until they
answer or the timeout falls back to the default.

Runtime sequence:

1. The model starts composing a `request_user_input` tool call.
2. Live tool projection may show a disabled draft card from streamed arguments.
3. When arguments complete and validate, the extension handler returns one ordered
   `ExtensionRuntimeOperation` item wrapping a `request_input.create` `RuntimeEffectRequest`
   carrying the validated questions, options, and defaults. `@svvy/runtime` applies it through the
   core-owned request-input state port implemented by `@svvy/state`; that implementation allocates
   request/question/option ids and commits the durable records.
4. Runtime registers the scoped wait, records command waiting state and session wait projection,
   races committed answers against timeout, and settles the original command/tool result. The
   extension handler does not wait, own `Deferred`s or timers, write wait rows, or resolve answers.
5. The side panel shows the request as answerable.
6. The command enters `waiting`.
7. The surface wait projection records that this turn is waiting on user input.
8. The tool call returns only after every question receives either a user answer or a timeout
   default.
8. The runtime clears the surface wait projection when the tool result is delivered.

Blocking requests must:

- hold the active tool call open while waiting
- preserve the prompt lock for that surface
- use the configured timeout when enabled
- return the same `RequestUserInputResult` shape as nonblocking
- use `answeredBy: "user"` for user answers
- use `answeredBy: "timeout_default"` for timeout defaults

Blocking requests must not:

- create queued answer items after the tool result is delivered
- expose timeout settings in the tool result
- ask the agent to poll for answers
- model timeout as a Smithers wait

The active variant instructions must tell agents:

- use this tool only when the answer is required before proceeding safely
- still provide a default answer because the timeout may expire
- continue with the returned answer when the tool resolves
- treat `answeredBy: "timeout_default"` as a fallback, not as confirmed user preference

## Blocking Timer

Blocking mode has an optional timeout. The default is enabled for five minutes:

```json
{
  "enabled": true,
  "durationMs": 300000
}
```

Timer behavior:

- the timer starts when the request becomes answerable, not while arguments are still streaming
- the timer is per request
- the timeout completes any unanswered questions with their recommended/default answers
- answered questions stay answered if the timer later expires for other questions
- the side panel shows the remaining time while running as derived display state from durable
  `expiresAt`, `pausedAt`, `remainingMsWhenPaused`, and `timerVersion`; UI countdown state never
  drives timeout resolution
- the side panel has a pause button
- pausing freezes the countdown without resolving the tool call
- typing any non-empty text in the custom answer input automatically pauses the timer
- clearing the custom answer input does not automatically resume the timer
- the user may resume the timer explicitly after an automatic pause
- disabling the timeout means the tool call waits indefinitely until answered, cancelled by the
  active turn lifecycle, or the owning surface/session is closed

## Side-Panel UX

The request UI lives in the workspace side panel, not as a modal that blocks the whole app.

The panel shows all open request-user-input questions across the current workspace, grouped by
owning surface and ordered by creation time.

Question card behavior:

- multiple questions may exist at once
- each card can be expanded or collapsed
- the first unanswered card in the list starts expanded
- answering an expanded card expands the next unanswered card
- already answered cards collapse by default but remain inspectable
- the agent-authored `title` is the compact card title
- the full `question` text appears in the expanded card
- choice options render with label and description
- the recommended/default option is visually marked
- the UI adds a freeform custom answer path automatically
- the agent must not create an "Other" option
- the custom answer input is available for every question

Submission controls:

- Enter submits with `delivery: "enqueue-and-run"`
- Cmd+Enter submits with `delivery: "queue-only"`
- visible buttons provide the same two actions
- in blocking mode, either action records the submitted answer and never creates a later queued
  answer; if questions remain open runtime returns
  `delivery: { kind: "blocking-open", queuedItemId: null }`, and the final answer resolves the
  waiting tool call with `delivery: { kind: "blocking-resolved", queuedItemId: null }`
- in nonblocking mode, either action may create a durable `request_user_input_answer` queue item
  and return `delivery: { kind: "nonblocking-queued", queuedItemId }` when model delivery is still
  applicable; otherwise runtime records the answer and returns
  `delivery: { kind: "nonblocking-recorded", queuedItemId: null }`

The panel must keep unanswered requests visible even if no Dockview panel currently shows the owning
surface. Ownership is by surface, not by panel.

## Runtime Answer API And Nonblocking Queue Delivery

Later user answers are submitted through the runtime answer API:

```ts
type AnswerRequestInputInput = {
  surfacePiSessionId: SurfacePiSessionId;
  requestId: RequestInputRequestId;
  questionId: RequestInputQuestionId;
  answer: { kind: "option"; optionId: RequestInputOptionId } | { kind: "custom"; text: string };
  delivery: RuntimeMessageDelivery;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type AnswerRequestInputResult = {
  requestId: RequestInputRequestId;
  questionId: RequestInputQuestionId;
  status: "recorded" | "duplicate";
  delivery:
    | { kind: "blocking-resolved"; queuedItemId: null }
    | { kind: "blocking-open"; queuedItemId: null }
    | { kind: "nonblocking-queued"; queuedItemId: QueueItemId }
    | { kind: "nonblocking-recorded"; queuedItemId: null };
};
```

In nonblocking mode, a later user answer may become a durable surface queue item. Queue insertion is
a runtime-owned effect of the user's answer action. The core-owned runtime answer contract defines
the answer payload shape. The Request User Input extension owns model-facing question validation and
default derivation only; it does not handle later answers or create queue rows. The queue payload is
only the nonblocking delivery artifact needed to validate, order, cancel, and deliver the answer:

```ts
type RequestUserInputAnswerQueuePayload = {
  kind: "request_user_input_answer";
  requestId: RequestInputRequestId;
  questionId: RequestInputQuestionId;
  answerId: RequestInputAnswerId;
  delivery: RuntimeMessageDelivery;
};
```

The generic queue row owns `queuedItemId`, `workspaceId`, `workspaceSessionId`,
`surfacePiSessionId`, `threadId`, lifecycle status, timestamps, failure state, ordering, and
row-level metadata. Queue rows do not store `requestSummary`; any queue display summary is derived
by runtime/state read models from row kind, payload, and linked request-input state. The generated
prompt-bearing payload delivered to the agent is separate and id-free:

```ts
type RequestUserInputAnswerDelivery = {
  type: "request_user_input.answer";
  title: string;
  question: string;
  originalAnswer: RequestUserInputResolvedAnswerValue;
  userAnswer: RequestUserInputResolvedAnswerValue;
};
```

Example delivered payload:

```json
{
  "type": "request_user_input.answer",
  "title": "CI scope",
  "question": "Should CI run only unit checks or the full suite before handoff?",
  "originalAnswer": {
    "kind": "option",
    "label": "Unit checks only",
    "text": "Unit checks only"
  },
  "userAnswer": {
    "kind": "option",
    "label": "Full suite",
    "text": "Full suite"
  }
}
```

Queue rules:

- `request_user_input_answer` items belong to the same `surfacePiSessionId` that created the
  original request.
- nonblocking answer queue items outrank ordinary `user_message` rows.
- nonblocking answer queue items do not bypass required opted-in extension context refresh checks.
- within `request_user_input_answer`, ordering is FIFO by answer creation time unless the user
  cancels a row before delivery.
- `delivery` uses `RuntimeMessageDelivery`; it is not a steering mode.
- row-level `Steer` remains a separate queue action over the `queuedItemId` returned only by
  `delivery.kind === "nonblocking-queued"`.
- if the surface is idle, either delivery mode may be claimed immediately by the shared
  runtime-owned queue dispatcher lane.
- if delivery fails before pi accepts it, runtime marks the queue item `failed` with `failedAt` and
  `failureError`; the failed row remains inspectable and dismissable and is not silently returned to
  the queue front.
- once pi accepts it, the item is `delivered`; any later turn failure belongs to the normal turn
  lifecycle.

This does not introduce a pi-only steering fast path. It uses the existing durable queue logic.

## Internal Product Requests

These are typed desktop/headless facade requests exposed by app bootstrap, not model-facing tools,
tool output, or a parallel string command system. Facade handlers validate payloads with
package-boundary schemas, then call the bootstrap-provided runtime facade for active-variant
changes, timeout configuration, timer pause/resume, and answers. State read facades are used only to
refetch read models after runtime-published notifications. Desktop/headless handlers do not mutate
request-input settings through state command facades directly. `@svvy/runtime` owns answer
recording, wait resolution, timeout completion, committed state effects, and notification
publication.

Desktop/headless/app-bootstrap handlers call only the runtime facade group, such as
`runtime.requestInput.answer(...)`, `runtime.requestInput.setVariant(...)`, and
`runtime.requestInput.setTimerPaused(...)` as named by the runtime/core contract. They never call
`RuntimeRequestStatePort`, `RuntimeSessionWaitStatePort`, state command facades, or extension
handlers directly.

Set active variant:

```json
{
  "mode": "nonblocking"
}
```

Set blocking timeout:

```json
{
  "enabled": true,
  "durationMs": 300000
}
```

Pause or resume a running timer:

```json
{
  "surfacePiSessionId": "pi_orch_01J00000000000000000000000",
  "requestId": "rui_01J00000000000000000000000",
  "paused": true
}
```

Submit an option answer:

```json
{
  "surfacePiSessionId": "pi_orch_01J00000000000000000000000",
  "requestId": "rui_01J00000000000000000000000",
  "questionId": "ruiq_01J00000000000000000000000",
  "answer": {
    "kind": "option",
    "optionId": "ruio_01J00000000000000000000000"
  },
  "delivery": "enqueue-and-run"
}
```

Submit a custom answer:

```json
{
  "surfacePiSessionId": "pi_orch_01J00000000000000000000000",
  "requestId": "rui_01J00000000000000000000000",
  "questionId": "ruiq_01J00000000000000000000000",
  "answer": {
    "kind": "custom",
    "text": "Run the full suite, but skip already-known flaky browser coverage."
  },
  "delivery": "queue-only"
}
```

Request validation:

- `requestId`, `questionId`, and `optionId` must be generated product ids from an open request.
- `surfacePiSessionId` must match the request's owning surface.
- the request must reject ids from a different workspace or surface.
- the request must reject answers to already completed, cancelled, or expired questions.
- the request must reject blank custom text.
- the request must reject `delivery` values other than `enqueue-and-run` or `queue-only`.
- in blocking mode, `delivery` is accepted for API consistency but never creates a later queue
  item; partial answers record the answer and leave the wait open, and the final answer resolves
  the current tool call.
- the runtime returns `AnswerRequestInputResult`; `delivery.kind` tells the caller whether a
  blocking wait remains open, a blocking wait was resolved, nonblocking model delivery was queued,
  or the answer was only recorded.

## Live Tool Projection

Request User Input uses live tool projection.

Argument streaming:

- render a `request_user_input` tool card as soon as the tool name is known
- show a disabled draft request while arguments stream
- update the draft from the newest accepted argument snapshot
- display any completed `title`, `question`, options, and default answer fields as provisional
- do not make the side-panel card answerable until arguments complete and validate
- if final arguments are invalid, fail the tool item and do not create request records

Runtime projection:

- `@svvy/runtime`, not the app/pi-adapter edge, creates or reuses the command row for streamed pi
  tool calls through `RuntimeCommandStatePort`
- accepted request-input execution, effect application, progress events, waiting state, and
  successful command settlement belong to `@svvy/runtime`
- successful nonblocking execution records command progress with created request/question count
  through `RuntimeCommandStatePort.recordCommandEvent(...)`
- successful nonblocking execution immediately finishes the command with default answers through
  `RuntimeCommandStatePort.finishCommand(...)`
- blocking execution records request creation progress, then the runtime-owned blocking wait
  lifecycle records the command as `waiting` through nonterminal command-state/wait-state ports;
  `RuntimeCommandStatePort.finishCommand(...)` is used only when user answer, timeout default, or
  cancellation resolves the wait and terminalizes the command
- blocking timer progress may be rendered as command progress or request-card state
- final command facts contain the delivered `RequestUserInputResult`, question count, and
  `answeredBy` source

Recovery:

- argument previews before runtime acceptance are transient
- request/question/answer records after runtime acceptance are durable product state
- completed command cards recover from final command facts
- open side-panel requests recover from request records
- blocking wait projection recovers from command and surface wait records

## Structured State

Required request record:

```ts
type RequestUserInputRequestRecord = {
  requestId: RequestInputRequestId;
  sessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId?: ThreadId;
  turnId: TurnId;
  commandId: CommandId;
  toolItemId: ToolItemId;
  variant: "nonblocking" | "blocking";
  status: "open" | "completed" | "cancelled" | "expired";
  createdAt: ISODateString;
  completedAt: ISODateString | null;
  timeout: null | {
    enabled: boolean;
    durationMs: number;
    startedAt: ISODateString;
    pausedAt: ISODateString | null;
    remainingMsWhenPaused: number | null;
    expiresAt: ISODateString | null;
    timerVersion: number;
  };
};
```

Required question record:

```ts
type RequestUserInputQuestionRecord = {
  questionId: RequestInputQuestionId;
  requestId: RequestInputRequestId;
  ordinal: number;
  title: string;
  question: string;
  defaultAnswer: RequestUserInputResolvedAnswerValue;
  choices: Array<{
    optionId: RequestInputOptionId;
    ordinal: number;
    label: string;
    description: string;
    recommended: boolean;
  }>;
  status: "open" | "answered" | "defaulted" | "cancelled";
};
```

Required answer record:

```ts
type RequestUserInputAnswerRecord = {
  answerId: RequestInputAnswerId;
  requestId: RequestInputRequestId;
  questionId: RequestInputQuestionId;
  answer: RequestUserInputResolvedAnswerValue;
  answeredBy: "user" | "default" | "timeout_default";
  delivery: RuntimeMessageDelivery | null;
  queuedItemId: QueueItemId | null;
  createdAt: ISODateString;
};
```

`delivery` records the submitted delivery intent only for later nonblocking user answers. It is
`null` for default answers, timeout defaults, and blocking answers because blocking answers are
recorded against the current wait instead of creating queued model delivery. `queuedItemId` is
non-null only when the public result is `delivery.kind === "nonblocking-queued"`.

The records above are authoritative `svvy` product state for request-input waits. They may link to
surface wait projection, but they do not mirror pi, Smithers, or renderer-local wait state.

## Cancellation And Closure

If the active turn is cancelled while a blocking request is waiting:

- the command becomes `cancelled`
- the request becomes `cancelled`
- open question cards become non-answerable
- no timeout default is delivered after cancellation
- surface wait projection clears

If a nonblocking request exists and the originating turn later fails or is cancelled:

- already-open side-panel requests remain answerable unless the owning surface/session is closed or
  the user cancels the request
- later answers are still accepted through the runtime answer API and may enqueue to the owning
  surface because the original default may already have influenced visible work

If the owning surface/session is explicitly closed in a way that discards queued work:

- open request records are cancelled
- queued answer items for that surface are cancelled
- answer cards become non-answerable

## Agent Guidance

Loaded nonblocking instructions must include these rules:

```md
Use `request_user_input` only for user decisions that could materially steer the work and where you
can choose a conservative default now.

Ask one to three short questions. For each question, provide a concise `title` for the side panel.
Use either exactly two or three options with exactly one `recommended: true`, or a freeform
`defaultAnswer`.

Continue with the returned answer. If a later `request_user_input.answer` message arrives, treat it
as a normal queued answer follow-up and reassess only if it materially changes the work.
```

Loaded blocking instructions must include these rules:

```md
Use `request_user_input` only when the answer is required before proceeding safely.

Ask one to three short questions. For each question, provide a concise `title` for the side panel.
Use either exactly two or three options with exactly one `recommended: true`, or a freeform
`defaultAnswer`, because the configured timeout may fall back to that default.

When the tool returns, continue with the returned answer. If the answer is marked
`answeredBy: "timeout_default"`, treat it as a fallback, not confirmed user preference.
```

Minimal available instructions should explain that loading the extension provides the
`request_user_input` tool for bounded user clarification. They must not mention inactive variant
behavior.

## Public API Boundary

The accepted model-facing API is the `request_user_input` schema defined in this spec. The runtime
rejects inputs outside that schema, including these invalid shapes:

```ts
wait({ reason, resumeWhen });
ask_user({ id, header, question, options });
request_user_input({ questions: [{ id, header, question, options }] });
request_user_input({ mode: "blocking", questions: [...] });
request_user_input({ questions: [{ title, question, options, defaultAnswer }] });
request_user_input({ questions: [{ title, question, options: [{ label: "Other" }] }] });
```

Invalid behavior:

- agent-authored question ids
- generated question titles
- model-visible mode fields in tool results
- model-visible `userMayRespondLater`
- renderer-only answer state without durable records
- a second non-queue steering path
- model-facing `wait` aliases
- workflow task agents asking the user directly by default

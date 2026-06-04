# Request User Input Extension Spec

## Status

- Date: 2026-06-03
- Status: adopted product spec
- Scope:
  - define the shipped Request User Input native extension
  - define the model-facing `request_user_input` API
  - define the nonblocking and blocking runtime variants
  - define user-answer queue delivery and side-panel behavior
  - define which state is file-backed extension source and which state is product-state-backed

This spec replaces the previous draft/native `wait` tool as the model-facing way for orchestrator
and handler-thread agents to ask the user for missing intent. The product may still project generic
waiting state for blocked surfaces, Smithers runs, approvals, signals, timers, and external
dependencies, but there is no shipped model-facing native tool named `wait`.

## Source References

This design borrows only the useful narrow shape from Codex:

- Codex names the tool `request_user_input`.
- Codex asks one to three questions.
- Codex choices use short user-facing labels plus one-sentence tradeoff descriptions.
- Codex recommends two to three mutually exclusive choices.
- Codex clients add the freeform "Other" answer path.

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

Request User Input is a shipped native tool extension for asking the user a bounded question while
preserving the normal coding-agent turn and queue model.

The extension has one visible product identity:

```json
{
  "id": "request-user-input",
  "title": "Request User Input",
  "category": "shipped",
  "interface": "native_tool"
}
```

It exposes one model-facing tool name:

```text
request_user_input
```

Default usage state:

| Actor kind | State |
| --- | --- |
| Orchestrator | default_loaded |
| Handler | default_loaded |
| Workflow task agent | unavailable |

Workflow task agents do not receive this extension by default. A workflow task agent runs under
Smithers task-attempt ownership; user clarification should route through the supervising handler
thread or workflow attention path instead of letting a task-local agent open independent user-input
requests.

## Dual Runtime Variant

The visible extension is a dual extension. The user sees one extension row and one extension pane,
but the app owns two internal variants:

| Variant | Runtime behavior | Tool name |
| --- | --- | --- |
| `nonblocking` | The tool creates answerable side-panel requests, immediately returns the agent's default answer, and lets later user answers queue through normal surface queue delivery. | `request_user_input` |
| `blocking` | The tool creates answerable side-panel requests and does not return until the user answers or the configured timeout supplies the default answer. | `request_user_input` |

The current variant is an app-global product setting for this shipped extension. Switching the
variant changes all three of these surfaces together:

- loaded instruction files
- tool runtime implementation
- generated tool declaration and schema descriptions

The agent must see only the currently active variant. It must not receive a prompt paragraph saying
"the current mode is nonblocking" or "the user may respond later." Those facts belong in the active
variant's instructions and runtime behavior, not in tool results.

When the active variant changes:

- the extension's generated context fingerprint changes
- every orchestrator or handler surface that has this extension loaded receives normal
  `agent_context_refresh` queue work before later prompt-bearing delivery or at the next safe active
  run boundary
- already-created request records keep their original behavior and do not change variant mid-flight
- new tool calls use the newly active variant

## Extension Source And Settings Storage

File-backed extension source:

```text
~/.config/svvy/extensions/sources/builtin-overlays/request-user-input/
  manifest.json
  variants/
    nonblocking/
      instructions/full/*.md
      instructions/minimal.md
    blocking/
      instructions/full/*.md
      instructions/minimal.md
```

Product-state-backed settings and runtime records:

- active variant: `nonblocking` or `blocking`
- blocking timeout enabled flag
- blocking timeout duration
- request records
- question records
- generated option ids
- answer records
- queue records created from later answers
- active timer state and pause state
- command lifecycle state
- surface wait projection created by blocking requests

Extension Managing exposes only the active variant's editable source paths when an agent inspects
this extension. Agent edit, reset, revert, and instruction-file lifecycle operations target only the
active variant. The user-facing extension pane may switch variants and may then inspect, edit, reset,
or build the newly active variant as the current extension source view.

The UI may show that this is a dual-mode shipped extension, but Extension Managing's agent-facing
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

Both variants return the same output shape:

```ts
type RequestUserInputResult = {
  answers: RequestUserInputResolvedAnswer[];
};

type RequestUserInputResolvedAnswer = {
  title: string;
  question: string;
  answer: RequestUserInputAnswer;
  answeredBy: "user" | "default" | "timeout_default";
};

type RequestUserInputAnswer =
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
3. When arguments complete and validate, the runtime creates request/question records.
4. The side panel shows the request as answerable.
5. The tool returns immediately with the recommended/default answers.
6. The agent continues as if those defaults were the user's answer.
7. If the user later answers, the app creates a high-priority surface queue item.

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
- treat any later deferred answer as normal user steering and reassess if it materially changes the
  work

## Blocking Variant Semantics

The blocking variant exists for users who want clarification requests to stop the agent until they
answer or the timeout falls back to the default.

Runtime sequence:

1. The model starts composing a `request_user_input` tool call.
2. Live tool projection may show a disabled draft card from streamed arguments.
3. When arguments complete and validate, the runtime creates request/question records.
4. The side panel shows the request as answerable.
5. The command enters `waiting`.
6. The surface wait projection records that this turn is waiting on user input.
7. The tool call returns only after every question receives either a user answer or a timeout
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

- create later deferred answer queue items after the tool result is delivered
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
- the side panel shows the remaining time while running
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

- Enter queues the answer immediately with steering semantics
- Cmd+Enter queues the answer for after-turn delivery
- visible buttons provide the same two actions
- in blocking mode, either action resolves the waiting tool call; there is no later queued deferred
  answer
- in nonblocking mode, either action creates a durable `request_user_input_answer` queue item

The panel must keep unanswered requests visible even if no Dockview panel currently shows the owning
surface. Ownership is by surface, not by panel.

## Deferred Answer Queue Item

In nonblocking mode, a later user answer becomes a durable surface queue item:

```ts
type RequestUserInputAnswerQueueItem = {
  kind: "request_user_input_answer";
  queuedItemId: QueuedItemId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId?: ThreadId;
  requestId: RequestUserInputRequestId;
  questionId: RequestUserInputQuestionId;
  delivery: "steer" | "after_turn";
  status: "queued" | "steering" | "dispatching" | "delivered" | "cancelled";
  createdAt: ISODateString;
};
```

The generated prompt-bearing payload delivered to the agent is:

```ts
type RequestUserInputAnswerDelivery = {
  type: "request_user_input.answer";
  title: string;
  question: string;
  originalAnswer: RequestUserInputAnswer;
  userAnswer: RequestUserInputAnswer;
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
- answer queue items outrank ordinary `user_message` rows.
- answer queue items do not bypass required `agent_context_refresh` work.
- within `request_user_input_answer`, ordering is FIFO by answer creation time unless the user
  cancels a row before delivery.
- `delivery: "steer"` uses the existing queue steering semantics and status values.
- `delivery: "after_turn"` waits for the active turn to settle and then delivers as the next real
  prompt-bearing item.
- if the surface is idle, either delivery mode may be claimed immediately by the shared queue runner.
- if delivery fails before pi accepts it, the item returns to the front of the durable queue.
- once pi accepts it, the item is `delivered`; any later turn failure belongs to the normal turn
  lifecycle.

This does not introduce a pi-only steering fast path. It uses the existing durable queue logic.

## Internal Product Commands

These commands are renderer/backend product commands, not model-facing tools and not tool output.

Set active variant:

```json
{
  "command": "request_user_input.set_mode",
  "params": {
    "mode": "nonblocking"
  }
}
```

Set blocking timeout:

```json
{
  "command": "request_user_input.set_blocking_timeout",
  "params": {
    "enabled": true,
    "durationMs": 300000
  }
}
```

Pause or resume a running timer:

```json
{
  "command": "request_user_input.set_timer_paused",
  "params": {
    "requestId": "rui_01J00000000000000000000000",
    "paused": true
  }
}
```

Submit an option answer:

```json
{
  "command": "request_user_input.answer",
  "params": {
    "requestId": "rui_01J00000000000000000000000",
    "questionId": "ruiq_01J00000000000000000000000",
    "answer": {
      "kind": "option",
      "optionId": "ruio_01J00000000000000000000000"
    },
    "delivery": "steer"
  }
}
```

Submit a custom answer:

```json
{
  "command": "request_user_input.answer",
  "params": {
    "requestId": "rui_01J00000000000000000000000",
    "questionId": "ruiq_01J00000000000000000000000",
    "answer": {
      "kind": "custom",
      "text": "Run the full suite, but skip already-known flaky browser coverage."
    },
    "delivery": "after_turn"
  }
}
```

Command validation:

- `requestId`, `questionId`, and `optionId` must be generated product ids from an open request.
- the command must reject ids from a different workspace or surface.
- the command must reject answers to already completed, cancelled, or expired questions.
- the command must reject blank custom text.
- the command must reject `delivery` values other than `steer` or `after_turn`.
- in blocking mode, `delivery` affects UI button semantics but resolves the current tool call rather
  than creating a later queue item.

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

- once request records are created, link the tool item to the command record
- show created request/question count in command progress
- in nonblocking mode, finish the command immediately with default answers
- in blocking mode, show command status `waiting` while waiting on answers
- in blocking mode, timer progress may be rendered as command progress or request-card state
- final command facts contain the delivered `RequestUserInputResult`

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
  requestId: RequestUserInputRequestId;
  workspaceSessionId: WorkspaceSessionId;
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
  };
};
```

Required question record:

```ts
type RequestUserInputQuestionRecord = {
  questionId: RequestUserInputQuestionId;
  requestId: RequestUserInputRequestId;
  ordinal: number;
  title: string;
  question: string;
  defaultAnswer: RequestUserInputAnswer;
  choices: Array<{
    optionId: RequestUserInputOptionId;
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
  answerId: RequestUserInputAnswerId;
  requestId: RequestUserInputRequestId;
  questionId: RequestUserInputQuestionId;
  answer: RequestUserInputAnswer;
  answeredBy: "user" | "default" | "timeout_default";
  delivery: "steer" | "after_turn" | null;
  queuedItemId: QueuedItemId | null;
  createdAt: ISODateString;
};
```

The records above are `svvy` product state. They do not copy Smithers wait records and do not
replace Smithers run, node, attempt, approval, timer, signal, or wait state.

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
- later answers still queue to the owning surface because the original default may already have
  influenced visible work

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
as normal user steering and reassess only if it materially changes the work.
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

## Rejected Shapes

These shapes are not part of the current design:

```ts
wait({ reason, resumeWhen });
ask_user({ id, header, question, options });
request_user_input({ questions: [{ id, header, question, options }] });
request_user_input({ mode: "blocking", questions: [...] });
request_user_input({ questions: [{ title, question, options, defaultAnswer }] });
request_user_input({ questions: [{ title, question, options: [{ label: "Other" }] }] });
```

Rejected behavior:

- agent-authored question ids
- generated question titles
- model-visible mode fields in tool results
- model-visible `userMayRespondLater`
- renderer-only answer state without durable records
- a second non-queue steering path
- keeping a model-facing `wait` alias for compatibility
- workflow task agents asking the user directly by default

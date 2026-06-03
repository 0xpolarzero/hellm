# Artifacts Extension Spec

## Status

- Date: 2026-06-04
- Status: resolved extension API spec
- Scope:
  - define Artifacts as a shipped Incur-backed `svvyx` extension
  - define the complete v1 `svvyx artifacts ...` command API
  - define the generated `execute_typescript` client surface for the extension
  - define file-backed storage, product-state linkage, preview, deletion, and settings rules

This file is the source of truth for the agent-facing Artifacts API. Other specs may describe
artifact projection or durable storage, but they must point back here for command and generated-client
contracts.

## Extension Record

```json
{
  "id": "artifacts",
  "category": "shipped",
  "interface": "svvyx",
  "title": "Artifacts",
  "description": "Create, inspect, open, list, and delete durable byproduct and evidence files.",
  "typescriptApiEnabled": true
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `default_loaded` |
| Handler thread | `default_loaded` |
| Workflow task agent | `default_loaded` |

Artifacts is a `svvyx` extension because v1 requires both a stable CLI command family and generated
TypeScript clients inside `execute_typescript`. Native-tool extensions do not enable
`typescriptApiEnabled`.

## Generated Extension Instructions

When the Artifacts extension is loaded, the generated actor context includes one loaded instruction
block for this extension. The loaded instruction block must be generated from the current command and
TypeScript contracts in this spec rather than hand-maintained separately.

Generated loaded instruction content:

````md
## Loaded Extension: Artifacts

Artifacts are durable byproduct and evidence files for work outputs that should remain inspectable
but should not normally be committed into the repository.

Use Artifacts for screenshots, logs, traces, retained test output, coverage reports, audit reports,
benchmark reports, generated HTML previews, workflow exports, CI evidence, and other large or durable
execution byproducts.

Do not use Artifacts for ordinary repository files the user asked you to create or edit. If a file
belongs in the workspace, create or edit it as normal workspace state. If the information is small
enough to answer in prose, answer in prose.

To create an artifact, first create or obtain one regular file in a writable workspace or temporary
location, then run:

```sh
svvyx artifacts create --path <file> [--title <title>] [--mime-type <mime>] --json
```

The create command copies the source file into svvy's configured artifact store and returns the
copied artifact path. The original source path is not the artifact. Directory artifacts and inline
content arguments are not supported.

Use these commands with `--json`:

```sh
svvyx artifacts create --path <file> [--title <title>] [--mime-type <mime>] --json
svvyx artifacts inspect --id <artifact_id> --json
svvyx artifacts list [--thread-id <thread_id>] [--limit <n>] --json
svvyx artifacts open --id <artifact_id> --json
svvyx artifacts delete --id <artifact_id> --json
```

`list` defaults to the current thread when running inside a handler thread, otherwise to the current
session. It may filter by `--thread-id`. It does not support `--command-id`.

`inspect` returns metadata and the copied artifact path; it does not print file contents. You may
read the returned artifact path directly when you need to inspect content.

`open` opens or focuses the product artifact inspector. It is a UI action and does not return
metadata.

`delete` is an explicit artifact lifecycle command. It tombstones the artifact record and removes the
copied artifact file when present. Do not use delete to hide failed work or remove evidence unless
the user asked for deletion or the task explicitly requires cleaning up an artifact.

When writing TypeScript inside `execute_typescript`, prefer the generated client:

```ts
await extensions.artifacts.run("create", {
  options: { path, title, mimeType },
});
await extensions.artifacts.run("inspect", {
  options: { id },
});
await extensions.artifacts.run("list", {
  options: { threadId, limit },
});
await extensions.artifacts.run("open", {
  options: { id },
});
await extensions.artifacts.run("delete", {
  options: { id },
});
```

Generated client failures reject with `Client.ClientError` from `incur/client`.

HTML artifact previews are sandboxed by the product. You cannot loosen preview sandbox permissions
through command flags, TypeScript inputs, MIME type overrides, or artifact content.
````

If the Artifacts extension is available but not loaded, the generated actor context includes this
minimal available instruction:

```md
Artifacts can create, inspect, open, list, and delete durable byproduct/evidence files through
`svvyx artifacts ...`; once Artifacts is loaded, `execute_typescript` also receives the generated
`extensions.artifacts.run(...)` TypeScript client. Load Artifacts when you need to preserve
screenshots, logs, reports, previews, workflow exports, CI evidence, or other large inspectable
outputs outside the repository tree.
```

## Product Model

Artifacts are durable byproducts or evidence files produced by commands, workflow runs, Project CI,
`execute_typescript`, and related execution. They are not a second workspace filesystem and are not a
normal path for source files, docs, tests, configuration, or assets the user asked the agent to add
to the repository.

Use artifacts for:

- screenshots
- generated reports, audits, benchmark output, and inspection output
- retained logs, traces, test output, coverage summaries, JUnit XML, and CI evidence
- generated HTML previews that should remain inspectable
- submitted `execute_typescript` source snippets, including failed attempts
- workflow exports and other execution evidence

Do not use artifacts for:

- ordinary repository files the user asked to create or edit
- small answers that fit naturally in the transcript or command summary
- reusable workflow source under `.svvy/workflows/...`
- directories

The agent should first create or obtain the intended file in a writable workspace or temporary
location, then call `svvyx artifacts create --path ...`. The Artifacts extension copies that file
into the configured artifact store and records app-owned product state. The original source path is
not the artifact.

## Storage

Artifact content is file-backed.

Default artifact directory:

```text
~/.config/svvy/artifacts
```

The artifact directory is configurable in app settings. If unset, the default above is authoritative.
The resolved artifact directory is product configuration, not an agent-supplied command argument.

Stored file layout:

```text
<artifactDir>/<sessionId>/<artifactId>-<sanitized-source-basename>
```

Rules:

- `sessionId` is the current structured session id resolved by the runtime boundary.
- `artifactId` is generated by `svvy`.
- the stored basename is derived from the source file basename after path separator removal and
  filename sanitization.
- the stored path must remain inside the resolved artifact directory after path normalization.
- source files are copied, not moved.
- directories are rejected in v1.
- symlink sources are resolved before copying; the copied bytes come from the resolved file target.
- the artifact record stores the copied artifact path, not the original source path.
- command sandboxes receive read-only access to copied artifact files that belong to non-deleted
  artifact records in the current workspace and current session. They do not receive write access to
  the artifact store; writes go through `create` and deletion goes through `delete`.

## Product-State Linkage

Artifact creation is a product-state mutation.

`svvyx artifacts create` must automatically link the artifact to the current runtime context:

- `sessionId`: always set from the current session
- `threadId`: set when the current surface belongs to a handler thread, or when the current workflow
  run or workflow task attempt belongs to a handler thread
- `workflowRunId`: set when the current runtime context is inside a workflow run
- `workflowTaskAttemptId`: set when the current runtime context is inside a workflow task attempt
- `sourceCommandId`: set to the command record for the `svvyx artifacts create` invocation or to
  the generated-client child command when invoked from `execute_typescript`

The agent must not provide ownership fields such as `sessionId`, `sourceCommandId`, `workflowRunId`,
or `workflowTaskAttemptId` to `create`. Those are runtime-derived facts.

`list --thread-id` is the only explicit ownership filter in v1. It is for inspecting a known thread's
artifacts. Command-scoped listing remains an internal selector/debug concern and is not part of the
agent-facing v1 API.

Artifact id commands resolve only inside the current workspace runtime and current session. `inspect`,
`open`, and `delete` return `ARTIFACT_NOT_FOUND` when the id is unknown, belongs to another
workspace, or belongs to another session.

## Shared JSON Types

All commands accept `--json`. Agent-facing instructions must use `--json`; non-JSON human output is
allowed only for manual terminal use and is not specified here.

### ArtifactRef

```ts
type ArtifactRef = {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  createdAt: string;
};
```

Field rules:

| Field | Rule |
| --- | --- |
| `id` | Stable app-generated artifact id. |
| `path` | Absolute path to the copied artifact file in the resolved artifact directory. |
| `name` | Human-readable display name. |
| `mimeType` | Stored MIME type used for projection and preview selection. |
| `bytes` | Current byte size of the copied artifact file. |
| `sha256` | Lowercase hex SHA-256 digest of the copied artifact file bytes. |
| `createdAt` | ISO-8601 timestamp for artifact creation. |

`ArtifactRef` intentionally omits summaries, content previews, original source paths, owner ids,
internal storage kind, UI pane ids, and URLs. The command sandbox grants read-only access to returned
artifact paths for visible artifacts in the current session, so the agent can inspect file content
directly from `path` when needed. Product owner/linkage facts remain in structured state.

### Error Output

Every failed JSON command returns:

```ts
type ArtifactErrorResult = {
  error: {
    code:
      | "INVALID_ARGUMENT"
      | "SOURCE_NOT_FOUND"
      | "SOURCE_IS_DIRECTORY"
      | "SOURCE_NOT_FILE"
      | "SOURCE_UNREADABLE"
      | "COPY_FAILED"
      | "ARTIFACT_NOT_FOUND"
      | "ARTIFACT_DELETED"
      | "ARTIFACT_FILE_MISSING"
      | "DELETE_FAILED"
      | "UI_UNAVAILABLE"
      | "INTERNAL_ERROR";
    message: string;
    path?: string;
    id?: string;
  };
};
```

Error rules:

- `message` is short and user-readable.
- `path` is present only for path-specific failures.
- `id` is present only for id-specific failures.
- errors must be redacted before persistence, transcript display, logs, generated client results, and
  artifacts.
- commands must use a nonzero process exit status when returning an error.

## CLI API

The command family is:

```sh
svvyx artifacts <command> ... --json
```

The v1 commands are:

```sh
svvyx artifacts create --path <file> [--title <title>] [--mime-type <mime>] --json
svvyx artifacts inspect --id <artifact_id> --json
svvyx artifacts list [--thread-id <thread_id>] [--limit <n>] --json
svvyx artifacts open --id <artifact_id> --json
svvyx artifacts delete --id <artifact_id> --json
```

No other `svvyx artifacts` commands are part of v1.

### `create`

```sh
svvyx artifacts create \
  --path /private/tmp/coverage-report.html \
  --title "Coverage report" \
  --mime-type text/html \
  --json
```

Success:

```json
{
  "id": "artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A",
  "path": "/Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A-coverage-report.html",
  "name": "Coverage report",
  "mimeType": "text/html",
  "bytes": 48291,
  "sha256": "9d59a7f6c8b9d72204a9dbbb0d5e5f27f3ff948731b73420f4e7e8f2820a6e9b",
  "createdAt": "2026-06-04T09:42:31.214Z"
}
```

Parameters:

| Parameter | Required | Meaning |
| --- | --- | --- |
| `--path <file>` | yes | Source file to copy into the artifact store. Must resolve to a readable regular file. |
| `--title <title>` | no | Human-readable artifact name. Defaults to the source basename. |
| `--mime-type <mime>` | no | MIME type override. Defaults to product MIME inference. |
| `--json` | yes for agents | Emits the specified JSON result. |

Behavior:

- validates that `--path` exists and resolves to a regular readable file
- accepts any regular file readable by the current command sandbox and operating-system permissions
- rejects directories with `SOURCE_IS_DIRECTORY`
- rejects non-file sources with `SOURCE_NOT_FILE`
- normalizes `--title` by trimming leading and trailing whitespace, replacing control characters with
  spaces, collapsing internal whitespace runs to one space, and truncating to 120 Unicode scalar
  values
- treats an omitted or empty normalized title as the source basename
- validates `--mime-type`, when present, as a syntactically valid MIME string with a `type/subtype`
  media type and optional parameters; invalid syntax returns `INVALID_ARGUMENT`
- stores `mimeType` in lowercase media-type form without parameters, such as `text/html`; parameters
  such as `charset=utf-8` are accepted but not preserved in `ArtifactRef.mimeType`
- does not reject unknown-but-valid MIME types
- copies the source file into the artifact store
- computes `bytes` and `sha256` from the copied artifact file
- records the artifact row and linkage in structured state
- emits `artifact.created`
- records final command facts containing artifact id, path, MIME type, byte size, digest, and linkage

The command does not accept inline content. To create a text, JSON, HTML, image, or log artifact, the
agent writes the file first and then calls `create --path`.

V1 has no Artifacts-extension-specific maximum file size. Creation is bounded by the command sandbox,
available disk space, filesystem limits, and any general app-wide storage policy. Disk or filesystem
failures return `COPY_FAILED`.

### `inspect`

```sh
svvyx artifacts inspect --id artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A --json
```

Success:

```json
{
  "id": "artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A",
  "path": "/Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A-coverage-report.html",
  "name": "Coverage report",
  "mimeType": "text/html",
  "bytes": 48291,
  "sha256": "9d59a7f6c8b9d72204a9dbbb0d5e5f27f3ff948731b73420f4e7e8f2820a6e9b",
  "createdAt": "2026-06-04T09:42:31.214Z"
}
```

Behavior:

- resolves the artifact record from product state
- rejects deleted artifacts with `ARTIFACT_DELETED`
- stats and hashes the copied artifact file
- returns `ARTIFACT_FILE_MISSING` if the product record exists but the file is missing
- does not print file contents
- does not open UI

### `list`

```sh
svvyx artifacts list --limit 20 --json
```

```sh
svvyx artifacts list --thread-id thread_01JZ3R8YV4MYQPGF2K6CP3CM3Q --limit 20 --json
```

Success:

```json
{
  "artifacts": [
    {
      "id": "artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A",
      "path": "/Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A-coverage-report.html",
      "name": "Coverage report",
      "mimeType": "text/html",
      "bytes": 48291,
      "sha256": "9d59a7f6c8b9d72204a9dbbb0d5e5f27f3ff948731b73420f4e7e8f2820a6e9b",
      "createdAt": "2026-06-04T09:42:31.214Z"
    }
  ]
}
```

Parameters:

| Parameter | Required | Meaning |
| --- | --- | --- |
| `--thread-id <thread_id>` | no | List artifacts for a specific handler thread. |
| `--limit <n>` | no | Maximum returned artifacts. Defaults to `20`; minimum `1`; maximum `100`. |
| `--json` | yes for agents | Emits the specified JSON result. |

Behavior:

- without `--thread-id`, lists non-deleted artifacts for the current thread when inside a handler
  thread, otherwise lists non-deleted artifacts for the current orchestrator session
- with `--thread-id`, lists non-deleted artifacts linked directly to that thread plus artifacts whose
  `workflowRunId` belongs to that thread
- returns `INVALID_ARGUMENT` when `--limit` is not an integer from `1` through `100`
- sorts by `createdAt` descending
- applies `limit` after filtering and sorting
- refreshes `bytes` and `sha256` from disk for each returned artifact
- omits active artifact records whose copied files are missing; inspectors and product selectors may
  still surface missing-file rows from retained metadata, but the agent-facing `list` result contains
  only currently readable artifact files
- omits deleted artifacts

`list` does not expose `--command-id` in v1. Command-level ownership remains available to product
selectors and inspectors, but it is not part of the normal agent API.

### `open`

```sh
svvyx artifacts open --id artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A --json
```

Success:

```json
{
  "id": "artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A",
  "opened": true
}
```

Behavior:

- resolves the artifact record from product state
- rejects deleted artifacts with `ARTIFACT_DELETED`
- opens a missing-file inspector row when the product record exists but the copied artifact file is
  missing
- asks the current app surface to open or focus the artifact inspector pane
- keys the inspector by artifact id plus owning workspace and session context
- does not mutate artifact metadata or artifact file content
- returns `UI_UNAVAILABLE` when no app UI is attached to the current runtime

`open` is a UI action command. It is not a read API and does not return artifact metadata.

### `delete`

```sh
svvyx artifacts delete --id artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A --json
```

Success:

```json
{
  "id": "artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A",
  "deleted": true
}
```

Behavior:

- resolves the artifact record from product state
- marks the artifact deleted in structured state
- removes the copied artifact file from the artifact store when it exists
- tombstones successfully when the product record exists and the copied file is already missing
- emits `artifact.deleted`
- records final command facts containing the deleted artifact id
- leaves historical command and thread links intact

Delete is a tombstone lifecycle transition, not silent record erasure. Product inspectors may still
show that a historical artifact existed and was deleted, but `list` omits deleted artifacts and
`inspect` returns `ARTIFACT_DELETED`.

Deleting an already-deleted artifact is idempotent and returns `deleted: true` if the artifact id is
known. Deleting an unknown artifact returns `ARTIFACT_NOT_FOUND`.

## Generated TypeScript API

When Artifacts is loaded for an actor, `execute_typescript` receives an Incur-compatible generated
client at `extensions.artifacts`. The exact helper type names are generated, but the command map must
be equivalent to:

```ts
type ArtifactRef = {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  createdAt: string;
};

type ArtifactsCommands = {
  create: {
    args: {};
    options: {
      path: string;
      title?: string;
      mimeType?: string;
    };
    output: ArtifactRef;
  };
  inspect: {
    args: {};
    options: {
      id: string;
    };
    output: ArtifactRef;
  };
  list: {
    args: {};
    options: {
      threadId?: string;
      limit?: number;
    };
    output: {
      artifacts: ArtifactRef[];
    };
  };
  open: {
    args: {};
    options: {
      id: string;
    };
    output: {
      id: string;
      opened: true;
    };
  };
  delete: {
    args: {};
    options: {
      id: string;
    };
    output: {
      id: string;
      deleted: true;
    };
  };
};

declare const extensions: {
  artifacts: IncurExtensionClient<ArtifactsCommands>;
};
```

Agent-authored snippets use the generated client with Incur command ids and `options`:

```ts
const created = await extensions.artifacts.run("create", {
  options: {
    path: "/private/tmp/coverage-report.html",
    title: "Coverage report",
    mimeType: "text/html",
  },
});

console.log(created);
/// Run.Result<ArtifactRef, ArtifactsCommands>
// {
//   ok: true,
//   data: {
//     id: "artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A",
//     path: "/Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A-coverage-report.html",
//     name: "Coverage report",
//     mimeType: "text/html",
//     bytes: 48291,
//     sha256: "9d59a7f6c8b9d72204a9dbbb0d5e5f27f3ff948731b73420f4e7e8f2820a6e9b",
//     createdAt: "2026-06-04T09:42:31.214Z",
//   },
//   output: {
//     text: "id: artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A\npath: /Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A-coverage-report.html\nname: Coverage report\nmimeType: text/html\nbytes: 48291\nsha256: 9d59a7f6c8b9d72204a9dbbb0d5e5f27f3ff948731b73420f4e7e8f2820a6e9b\ncreatedAt: 2026-06-04T09:42:31.214Z",
//     format: "toon",
//   },
//   meta: {
//     command: "create",
//     duration: "18ms",
//   },
// }
```

Handle failures with `Client.ClientError`:

```ts
import { Client } from "incur/client";

try {
  await extensions.artifacts.run("inspect", {
    options: { id: "artifact_missing" },
  });
} catch (error) {
  if (error instanceof Client.ClientError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  throw error;
}
```

Generated-client calls:

- use the same Incur command contracts as `svvyx artifacts ...`
- reject with `Client.ClientError` on command failure rather than resolving an `{ error }` union
- apply the same readiness checks, env injection, redaction, command facts, and failure semantics as
  shell dispatch
- create child command records under the parent `execute_typescript` command
- expose only the per-loaded-extension client under `extensions.artifacts`; do not expose
  `MemoryClient`, local actions, or a broad all-extension Incur client

## Preview And UX

The artifact inspector is product UI over the copied artifact file and product metadata.

Projection rules:

- text, JSON, log, image, and HTML artifacts may receive specialized previews
- unknown MIME types fall back to file metadata plus open/reveal actions
- visible HTML previews must render inside sandboxed iframes
- script-capable HTML previews may grant `allow-scripts`
- HTML preview sandboxes must not include `allow-same-origin`, top navigation, popups, form
  submission, downloads, pointer-lock, presentation, or parent/app escape permissions
- the agent cannot loosen preview sandbox permissions through CLI flags, TypeScript client input, MIME
  type overrides, artifact content, or metadata

Command projection:

- `svvyx artifacts create` shows source path, copy progress when available, and final artifact id
- `svvyx artifacts inspect` and `list` settle from final structured JSON output
- `svvyx artifacts open` shows the target artifact id and final open result
- `svvyx artifacts delete` shows the target artifact id and final deleted result
- the renderer must still show raw command output detail because `svvyx` remains an `exec_command`
  command-family projection

## Redaction And Policy

Artifacts commands are `svvyx` commands and therefore ordinary `exec_command` input for policy,
approval, sandbox, output caps, command records, and projection.

Rules:

- Explicit `create --path` copies exact source bytes into the artifact store. It does not transform
  or redact artifact file content, and `sha256` is computed over the exact copied bytes.
- For explicit `create --path`, command output, errors, logs, command facts, generated TypeScript
  declarations, generated-client results, and metadata pass through the same extension redaction layer
  as other `svvyx` extension invocations.
- Runtime-created artifacts that capture command output, extension output, logs, or generated
  diagnostics must be redacted before file-backed artifact persistence. If a runtime cannot safely
  redact a payload, it must persist a redacted placeholder artifact or fail the artifact creation
  path rather than writing unredacted sensitive content.
- MIME inference and file hashing must read only the source file selected by `--path` and the copied
  artifact file.
- `create` must not read sibling files, crawl directories, or package directories in v1.
- `delete` may remove only the copied artifact file for the resolved artifact id.
- no command may expose extension env secrets, app secrets, or redacted values through JSON output,
  human output, command facts, logs, previews, or generated-client errors.

## Non-Goals

V1 does not include:

- `artifact_write_text`
- `artifact_write_json`
- `artifact_attach_file`
- inline content arguments
- directory artifacts
- agent-supplied owner/linkage ids
- command-id filtering in the agent-facing `list` command
- preview-policy flags
- trust or sandbox override flags
- artifact summaries generated by the command
- sharing or public URLs
- retention policy controls
- artifact mutation other than `delete`

The old draft names `artifact_write_text`, `artifact_write_json`, and `artifact_attach_file` are not
stable agent-facing APIs.

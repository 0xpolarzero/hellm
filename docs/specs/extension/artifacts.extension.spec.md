# Artifacts Extension Spec

## Status

- Date: 2026-06-04
- Status: resolved extension API spec
- Scope:
  - define Artifacts as a builtin Incur-backed `svvyx` extension
  - define the complete v1 `svvyx artifacts ...` command API
  - define the generated `execute_typescript` client surface for the extension
  - define file-backed storage, mutability boundaries, product-state linkage, preview, deletion, and
    settings rules

This file is the source of truth for the agent-facing Artifacts API. Other specs may describe
artifact projection or durable storage, but they must point back here for command and generated-client
contracts.

## Extension Record

```json
{
  "id": "artifacts",
  "category": "builtin",
  "interface": "svvyx",
  "title": "Artifacts",
  "description": "Create, inspect, open, list, and delete durable session artifact files.",
  "typescriptApiEnabled": true
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `loaded` |
| Handler thread | `loaded` |
| Workflow task agent | `loaded` |

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

Artifacts are durable session files for work outputs that should remain inspectable but should not
normally be committed into the repository.

Use Artifacts for screenshots, logs, traces, retained test output, coverage reports, audit reports,
benchmark reports, generated HTML previews, workflow exports, CI evidence, implementation plans,
review notes, and other large or durable work outputs.

Artifacts are also a good handoff surface when later agents should read, reassess, or modify a
bounded plan, design note, review brief, checklist, or research summary without inheriting the full
conversation that produced it. Create a mutable Markdown artifact for these handoffs when the
handoff content is too large or too durable for transcript prose and should stay inspectable as a
session artifact.

Do not use Artifacts for ordinary repository files the user asked you to create or edit. If a file
belongs in the workspace, create or edit it as normal workspace state. If the information is small
enough to answer in prose, answer in prose.

To create a new empty mutable artifact file, run:

```sh
svvyx artifacts create --name <filename-with-extension> --json
```

The `--name` value is the exact stored filename. It must include the extension and must be a
basename, not a path. The command creates the empty file in svvy's configured artifact store and
returns the artifact path. Edit mutable artifact files with normal file-editing tools such as
`apply_patch`. There is no implicit `.md` default, and the command must not invent or rewrite the
extension.

To preserve an existing file as an artifact, run:

```sh
svvyx artifacts create --path <file> [--name <filename-with-extension>] [--mime-type <mime>] --json
```

When `--path` is present, the command copies the source file into the artifact store. When `--name`
is also present, the copied artifact uses that exact filename; otherwise it uses the source basename.
The original source path is not the artifact. Directory artifacts and inline content arguments are
not supported. There is no `--kind` option.

To create a read-only artifact, add `--immutable`:

```sh
svvyx artifacts create --name <filename-with-extension> --immutable --json
svvyx artifacts create --path <file> [--name <filename-with-extension>] --immutable --json
```

Immutable artifacts are stored under the session's `immutable/` artifact directory. Ordinary shell
commands and `apply_patch` may read immutable artifacts but must not write them.

Use these commands with `--json`:

```sh
svvyx artifacts create --name <filename-with-extension> [--immutable] [--mime-type <mime>] --json
svvyx artifacts create --path <file> [--name <filename-with-extension>] [--immutable] [--mime-type <mime>] --json
svvyx artifacts inspect --id <artifact_id> --json
svvyx artifacts list [--thread-id <thread_id>] [--limit <n>] --json
svvyx artifacts open --id <artifact_id> --json
svvyx artifacts delete --id <artifact_id> --json
```

`list` defaults to the current thread when running inside a handler thread, otherwise to the current
session. It may filter by `--thread-id`. It does not support `--command-id`.

`inspect` returns metadata and the artifact path; it does not print file contents. You may read the
returned artifact path directly when you need to inspect content.

`open` opens or focuses the product artifact inspector. It is a UI action and does not return
metadata.

`delete` is an explicit artifact lifecycle command. It tombstones the artifact record and removes the
artifact file when present. Do not use delete to hide failed work or remove evidence unless the user
asked for deletion or the task explicitly requires cleaning up an artifact.

When writing TypeScript inside `execute_typescript`, prefer the generated client:

```ts
await extensions.artifacts.run("create", {
  options: { name, path, immutable, mimeType },
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
Artifacts can create, inspect, open, list, and delete durable session files through `svvyx artifacts
...`; once Artifacts is loaded, `execute_typescript` also receives the generated
`extensions.artifacts.run(...)` TypeScript client. Load Artifacts when you need to preserve
implementation plans, review notes, screenshots, logs, reports, previews, Smithers exports, or
other large inspectable outputs outside the repository tree.
```

## Product Model

Artifacts are durable session files produced by commands, `execute_typescript`, and related
execution. They support both mutable draft/review files and
immutable evidence/final files. They are not a second repository workspace and are not the normal path
for source files, docs, tests, configuration, or assets the user asked the agent to add to the
repository.

Use artifacts for:

- screenshots
- generated reports, audits, benchmark output, and inspection output
- retained logs, traces, test output, coverage summaries, and JUnit XML
- generated HTML previews that should remain inspectable
- implementation plans, review notes, and other session-local planning or review documents
- bounded handoff documents intended to be read, reassessed, or modified by another agent without
  requiring that agent to inherit the full conversation context
- submitted `execute_typescript` source snippets, including failed attempts
- Smithers exports and other execution evidence

Do not use artifacts for:

- ordinary repository files the user asked to create or edit
- small answers that fit naturally in the transcript or command summary
- reusable workflow source under `~/.config/svvy/workflows/...`
- directories

For a new artifact file, the agent calls `svvyx artifacts create --name <filename-with-extension>
--json`. The command creates an empty mutable artifact directly in the active session artifact
directory. The returned `path` is the artifact file and may be edited by ordinary file-editing tools
while it remains mutable.

For an existing source file, the agent calls `svvyx artifacts create --path <file> [--name
<filename-with-extension>] --json`. The command copies that single source file into the active
session artifact directory and records app-owned product state. The original source path is not the
artifact. If `--immutable` is present, the artifact is created under the session `immutable/`
directory and ordinary command execution must not mutate it afterward.

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
<artifactDir>/<sessionId>/<name>
<artifactDir>/<sessionId>/immutable/<name>
```

Rules:

- `sessionId` is the current structured session id resolved by the runtime boundary.
- `artifactId` is generated by `svvy`.
- `name` is the exact stored filename. It is supplied by `--name`, or, for `create --path` without
  `--name`, derived from the source file basename.
- the stored filename must include an extension. The runtime must reject a filename with no dot after
  the first character or with a trailing dot. `plan.md` and `archive.tar.gz` are valid; `plan`,
  `.env`, and `plan.` are invalid artifact names.
- the stored filename must be a basename, not a path. It must not contain `/`, `\`, `..`, NUL,
  control characters, or platform path separators after normalization.
- `immutable` is a reserved storage directory name, not an agent-provided path component.
- the stored path must remain inside the resolved artifact directory after path normalization.
- non-immutable artifacts are stored directly under `<artifactDir>/<sessionId>/`.
- immutable artifacts are stored under `<artifactDir>/<sessionId>/immutable/`.
- source files supplied through `--path` are copied, not moved.
- directories are rejected in v1.
- symlink sources are resolved before copying; the copied bytes come from the resolved file target.
- the artifact record stores the artifact path in the configured artifact directory, not the original
  source path.
- active artifact names must be unique within the same `(sessionId, immutable)` storage scope.
  Creating an artifact whose target artifact path already belongs to an active artifact or already
  exists on disk returns `ARTIFACT_EXISTS`.
- deleted artifact names may be reused only after the prior artifact file is absent and no active
  artifact record owns the target path.
- ordinary command sandboxes receive write access only to the active session artifact directory for
  the current session. They do not receive write access to any other session's artifact directory.
- the active session's `immutable/` child directory is a read-only subpath under that writable
  session artifact root. Ordinary shell commands, `apply_patch`, and arbitrary TypeScript side
  effects may read immutable artifacts but must not write, rename, replace, or delete files under
  `immutable/`.
- `svvyx artifacts create --immutable` and `svvyx artifacts delete` are app-owned product mutations.
  They may receive scoped runtime permission for the exact artifact file operation they are
  performing, but that permission must not widen ordinary command or `apply_patch` access to
  `immutable/`.
- immutable behavior is enforced by the managed filesystem policy and product command routing. It
  must not rely on `chmod`, `chflags`, ACLs, or other operating-system file flags as the artifact
  immutability model.

## Product-State Linkage

Artifact creation is a product-state mutation.

`svvyx artifacts create` must automatically link the artifact to the current runtime context:

- `sessionId`: always set from the current session
- `threadId`: set when the current surface belongs to a handler thread
- `sourceCommandId`: set to the command record for the `svvyx artifacts create` invocation or to
  the generated-client child command when invoked from `execute_typescript`

The agent must not provide ownership fields such as `sessionId`, `threadId`, or `sourceCommandId` to
`create`. Those are runtime-derived facts.

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
  immutable: boolean;
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
| `path` | Absolute path to the artifact file in the resolved artifact directory. |
| `name` | Exact stored filename, including extension. This is not a title or display-only label. |
| `immutable` | `true` when the artifact lives under the session `immutable/` directory and is read-only to ordinary command execution. |
| `mimeType` | Stored MIME type used for projection and preview selection. |
| `bytes` | Current byte size of the artifact file at the time the command returns. |
| `sha256` | Lowercase hex SHA-256 digest of the artifact file bytes at the time the command returns. |
| `createdAt` | ISO-8601 timestamp for artifact creation. |

`ArtifactRef` intentionally omits summaries, content previews, original source paths, owner ids,
UI pane ids, and URLs. The command sandbox grants read access to returned artifact paths for visible
artifacts in the current session. Mutable artifact paths in the active session artifact directory may
also be edited through ordinary file-editing tools; immutable artifact paths may not. Product
owner/linkage facts remain in structured state.

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
      | "ARTIFACT_EXISTS"
      | "ARTIFACT_NOT_FOUND"
      | "ARTIFACT_DELETED"
      | "ARTIFACT_FILE_MISSING"
      | "DELETE_FAILED"
      | "UI_UNAVAILABLE"
      | "INTERNAL_ERROR";
    message: string;
    path?: string;
    name?: string;
    id?: string;
  };
};
```

Error rules:

- `message` is short and user-readable.
- `path` is present only for path-specific failures.
- `name` is present only for artifact-name-specific failures.
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
svvyx artifacts create --name <filename-with-extension> [--immutable] [--mime-type <mime>] --json
svvyx artifacts create --path <file> [--name <filename-with-extension>] [--immutable] [--mime-type <mime>] --json
svvyx artifacts inspect --id <artifact_id> --json
svvyx artifacts list [--thread-id <thread_id>] [--limit <n>] --json
svvyx artifacts open --id <artifact_id> --json
svvyx artifacts delete --id <artifact_id> --json
```

No other `svvyx artifacts` commands are part of v1.

### `create`

```sh
svvyx artifacts create \
  --name implementation_plan.md \
  --json
```

Success:

```json
{
  "id": "artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A",
  "path": "/Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/implementation_plan.md",
  "name": "implementation_plan.md",
  "immutable": false,
  "mimeType": "text/markdown",
  "bytes": 0,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "createdAt": "2026-06-04T09:42:31.214Z"
}
```

Parameters:

| Parameter | Required | Meaning |
| --- | --- | --- |
| `--name <filename>` | required when `--path` is omitted; optional when `--path` is present | Exact stored artifact filename. Must be a basename with an extension. |
| `--path <file>` | no | Optional source file to copy into the artifact store. Must resolve to a readable regular file when present. |
| `--immutable` | no | Store the artifact under the session `immutable/` directory and make it read-only to ordinary command execution. |
| `--mime-type <mime>` | no | MIME type override. Defaults to product MIME inference. |
| `--json` | yes for agents | Emits the specified JSON result. |

Behavior:

- requires at least one of `--name` or `--path`
- rejects `--name` when it is empty, extensionless, path-like, contains `..`, contains path
  separators, contains NUL or control characters, or normalizes outside a single basename
- treats `--name` as the exact stored filename; the command must not add, remove, infer, or rewrite an
  extension
- when `--path` is omitted, creates a new empty artifact file at the target artifact path
- when `--path` is present, validates that it exists and resolves to a regular readable file
- when `--path` is present, accepts any regular file readable by the current command sandbox and
  operating-system permissions
- when `--path` is present, rejects directories with `SOURCE_IS_DIRECTORY`
- when `--path` is present, rejects non-file sources with `SOURCE_NOT_FILE`
- when `--path` is present and `--name` is omitted, uses the source basename as the exact stored
  filename and applies the same stored-filename validation
- rejects a target artifact path that already belongs to an active artifact record or already exists
  on disk with `ARTIFACT_EXISTS`
- validates `--mime-type`, when present, as a syntactically valid MIME string with a `type/subtype`
  media type and optional parameters; invalid syntax returns `INVALID_ARGUMENT`
- stores `mimeType` in lowercase media-type form without parameters, such as `text/html`; parameters
  such as `charset=utf-8` are accepted but not preserved in `ArtifactRef.mimeType`
- does not reject unknown-but-valid MIME types
- infers MIME type from the stored filename and artifact bytes when `--mime-type` is omitted
- creates non-immutable artifacts directly under `<artifactDir>/<sessionId>/`
- creates immutable artifacts under `<artifactDir>/<sessionId>/immutable/`
- copies the source file into the artifact store when `--path` is present
- computes `bytes` and `sha256` from the artifact file after creation or copy
- records the artifact row and linkage in structured state
- emits `artifact.created`
- records final command facts containing artifact id, path, exact name, immutable flag, MIME type,
  byte size, digest, and linkage

The command does not accept inline content. To create a text, JSON, HTML, image, or log artifact from
new content, the agent creates an empty artifact with `create --name <filename-with-extension>`, then
edits the returned mutable artifact path. To preserve an existing file, the agent uses `create
--path`.

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
  "path": "/Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/implementation_plan.md",
  "name": "implementation_plan.md",
  "immutable": false,
  "mimeType": "text/markdown",
  "bytes": 1284,
  "sha256": "2d59a7f6c8b9d72204a9dbbb0d5e5f27f3ff948731b73420f4e7e8f2820a6e9b",
  "createdAt": "2026-06-04T09:42:31.214Z"
}
```

Behavior:

- resolves the artifact record from product state
- rejects deleted artifacts with `ARTIFACT_DELETED`
- stats and hashes the artifact file
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
      "path": "/Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/implementation_plan.md",
      "name": "implementation_plan.md",
      "immutable": false,
      "mimeType": "text/markdown",
      "bytes": 1284,
      "sha256": "2d59a7f6c8b9d72204a9dbbb0d5e5f27f3ff948731b73420f4e7e8f2820a6e9b",
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
- omits active artifact records whose files are missing; inspectors and product selectors may
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
- opens a missing-file inspector row when the product record exists but the artifact file is missing
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
- rejects artifacts outside the current workspace and current structured session scope with
  `ARTIFACT_NOT_FOUND`
- marks the artifact deleted in structured state
- removes the artifact file from the artifact store when it exists
- when the artifact is immutable, performs only the exact tombstone and file removal operation for
  the resolved current-session artifact path; it must not grant writable access to any other file in
  the session `immutable/` directory
- tombstones successfully when the product record exists and the artifact file is already missing
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
  immutable: boolean;
  mimeType: string;
  bytes: number;
  sha256: string;
  createdAt: string;
};

type ArtifactsCommands = {
  create: {
    args: {};
    options:
      | {
          name: string;
          path?: never;
          immutable?: boolean;
          mimeType?: string;
        }
      | {
          path: string;
          name?: string;
          immutable?: boolean;
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
    name: "implementation_plan.md",
  },
});

console.log(created);
/// Run.Result<ArtifactRef, ArtifactsCommands>
// {
//   ok: true,
//   data: {
//     id: "artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A",
//     path: "/Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/implementation_plan.md",
//     name: "implementation_plan.md",
//     immutable: false,
//     mimeType: "text/markdown",
//     bytes: 0,
//     sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
//     createdAt: "2026-06-04T09:42:31.214Z",
//   },
//   output: {
//     text: "id: artifact_01JZ3R9YH0V8C8V6K4F6N1HX4A\npath: /Users/polarzero/.config/svvy/artifacts/session_01JZ3R8Y4B/implementation_plan.md\nname: implementation_plan.md\nimmutable: false\nmimeType: text/markdown\nbytes: 0\nsha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\ncreatedAt: 2026-06-04T09:42:31.214Z",
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
  generic Incur transports, local actions, generated-client internals, or a broad all-extension
  Incur client

## Preview And UX

The artifact inspector is product UI over the artifact file and product metadata.

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

- `svvyx artifacts create` shows the target name, immutable flag, source path and copy progress when
  `--path` is present, and final artifact id
- `svvyx artifacts inspect` and `list` settle from final structured JSON output
- `svvyx artifacts open` shows the target artifact id and final open result
- `svvyx artifacts delete` shows the target artifact id and final deleted result
- the renderer must still show raw command output detail because `svvyx` remains an `exec_command`
  command-family projection

## Redaction And Policy

Artifacts commands are `svvyx` commands and therefore ordinary `exec_command` input for policy,
approval, sandbox, output caps, command records, and projection.

Rules:

- Explicit `create --path` copies exact source bytes into the artifact store. It does not transform or
  redact artifact file content, and `sha256` is computed over the artifact bytes after copy.
- Explicit `create --name` without `--path` creates an empty artifact file. Its initial `sha256` is
  the SHA-256 digest of the empty file and changes only when ordinary artifact editing changes the
  artifact content.
- Command output, errors, logs, command facts, generated TypeScript declarations, generated-client
  results, and metadata pass through the same extension redaction layer as other `svvyx` extension
  invocations.
- Runtime-created artifacts that capture command output, extension output, logs, or generated
  diagnostics must be redacted before file-backed artifact persistence. If a runtime cannot safely
  redact a payload, it must persist a redacted placeholder artifact or fail the artifact creation
  path rather than writing unredacted sensitive content.
- MIME inference and file hashing must read only the source file selected by `--path`, when present,
  and the artifact file.
- `create` must not read sibling files, crawl directories, package directories, or infer artifact
  names from unrelated filesystem state in v1.
- `delete` may remove only the artifact file for the resolved artifact id.
- ordinary writes to mutable artifact files are normal command or `apply_patch` file edits. They are
  not `svvyx artifacts` command mutations, and they must still be projected and recorded as ordinary
  file-change command facts.
- no command may expose extension env secrets, app secrets, or redacted values through JSON output,
  human output, command facts, logs, previews, or generated-client errors.

## Non-Goals

V1 does not include:

- `artifact_write_text`
- `artifact_write_json`
- `artifact_attach_file`
- inline content arguments
- directory artifacts
- `--kind`
- implicit filename extensions
- extensionless artifact names
- path-like artifact names
- agent-supplied owner/linkage ids
- command-id filtering in the agent-facing `list` command
- preview-policy flags
- trust or sandbox override flags
- artifact summaries generated by the command
- sharing or public URLs
- retention policy controls
- OS-level permission or file-flag based artifact immutability
- `svvyx artifacts` content-mutation commands other than `create` and `delete`

The command family must not expose commands named `artifact_write_text`, `artifact_write_json`, or
`artifact_attach_file`.

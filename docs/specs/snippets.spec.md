# Snippets Prompt Macros Spec

## Status

- Date: 2026-06-02
- Status: product spec for explicit prompt macros
- Related specs:
  - `docs/specs/ambient-agent-resources-baseline.spec.md`
  - `docs/specs/composer-mention-links.spec.md`
  - `docs/specs/extensions-and-tools.spec.md`

## Purpose

Snippets are reusable prompt macros that users explicitly insert into the composer.

They are prompt text only. They are not tools, extensions, skills, hooks, commands, provider
settings, permission grants, or execution policy.

## Product Contract

Snippets exist to make repeated prompt text fast to insert without changing actor capability.

Baseline behavior:

- support Snippets as a first-class `svvy` pane
- discover known Markdown prompt macro files from supported hosts
- show discovered Snippets as read-only external files
- allow `svvy`-owned Snippets to be created, edited, renamed, and deleted through Snippets pane
  controls backed by runtime/state commands
- allow individual managed or discovered Snippets to be enabled or disabled for composer insertion
- insert Snippets explicitly from the composer through `@` fuzzy matching
- expand Snippets through `svvy`, not through pi, Claude, Codex, or another host runtime
- keep host slash-command execution disabled

Snippets do nothing until the user inserts one. They are not loaded by default instructions, so they do
not need actor toggles, extension usage states, generated agent context refresh, or runtime command
surfaces.

## Discovery Sources

`svvy` discovers external Snippets from prompt macro formats that are already simple Markdown files.

Claude command files:

- user commands: `~/.claude/commands/**/*.md`
- workspace commands: `<workspace>/.claude/commands/**/*.md`

Claude command directories are recursive because Claude uses subdirectories for organization and
namespace display.

Pi prompt template files:

- user templates: `~/.pi/agent/prompts/*.md`
- workspace templates: `<workspace>/.pi/prompts/*.md`

Pi prompt-template directory discovery is non-recursive. Nested directories under a pi `prompts`
directory are unsupported by this spec.

Codex baseline:

- do not discover Codex skills as Snippets
- do not parse `SKILL.md` as a Snippet source
- do not reinterpret Codex plugins, skill bundles, or generated skill commands as Snippets

Codex standalone Markdown prompt-snippet or custom-command paths are outside this spec until a
supported non-skill, non-plugin, non-executable package interface is specified.

## Discovered Versus Managed Snippets

Discovered Snippets are external files:

- read-only inside `svvy`
- opened through the configured external editor
- never duplicated automatically into editable `svvy` Snippets
- not deleted, renamed, or rewritten by `svvy`
- refreshed through `@svvy/runtime` source invalidation/fingerprint coordinators and projected
  through `@svvy/state` snippet read models

Managed Snippets are product-owned records persisted by `@svvy/state`:

- the Snippets pane submits typed create intents through runtime/state facades
- the Snippets pane submits typed edit intents through runtime/state facades
- the Snippets pane submits typed rename intents through runtime/state facades
- the Snippets pane submits typed delete intents through runtime/state facades
- `@svvy/state` owns the durable managed Snippet record state
- `@svvy/runtime` owns discovered Snippet source refresh, expansion, provenance, and invalidation

There is no clone or "make editable copy" flow in the baseline. If a user wants an editable version
of an external Snippet, they can create a separate managed Snippet manually.

## Snippets Pane

The app sidebar includes a Snippets pane when this feature is enabled.

The pane shows:

- managed Snippets
- discovered Claude command files
- discovered pi prompt-template files
- source filters for all, managed `svvy`, Claude, and pi Snippets with counts; filtering changes
  only the pane view and never changes snippet content, source ownership, actor capability, or
  generated agent context
- shared collapsible rows that expand inline for managed editing or discovered Snippet preview
- source badge: `svvy`, `Claude`, or `pi`
- enable checkbox controlling whether the Snippet appears in composer `@` results
- title
- description when available
- argument hint when available
- absolute path for discovered Snippets
- read-only live preview for discovered Snippets
- editor for managed Snippets
- unsaved-change protection so list selection, creation, or live refresh cannot silently discard a
  dirty managed Snippet draft
- open-external-editor action for discovered Snippets from the expanded source preview

The pane does not show:

- actor enablement controls
- extension usage controls
- permission controls
- tool grants
- package or plugin controls
- skill import controls

Disabled Snippets remain visible and expandable in the Snippets pane, but they are subdued and are
excluded from composer `@` picker results and typed `@Snippet Name` commits. Disabling a discovered
Snippet does not modify the external Markdown file; `svvy` persists that visibility choice in its
own Snippets state.

## Format

Snippets are Markdown with optional YAML frontmatter.

Supported metadata:

- `description`: short picker and pane description
- `argument-hint`: user-facing hint for expected arguments

Behavior-changing metadata is ignored:

- `allowed-tools` does not grant tools
- `model` does not change model selection
- `disable-model-invocation` does not create host command behavior
- package/plugin metadata does not affect discovery or execution

Supported placeholders:

- `$1`, `$2`, and higher positional arguments
- `$@`
- `$ARGUMENTS`
- `${@:N}`
- `${@:N:L}`

Unsupported host command behavior:

- no Claude bash pre-execution from `!` command syntax
- no MCP prompt discovery as Snippets
- no plugin-provided commands
- no extension-provided commands
- no skill commands
- no host command execution during expansion

Unsupported behavior is not emulated. `svvy` treats the Markdown body as prompt text and substitutes
only supported argument placeholders.

## Composer UX

The composer `@` picker searches files, folders, and enabled Snippets together in one fuzzy result
list.

Snippet results are not placed in a separate picker mode. They use different visual treatment so the
user can distinguish them while still getting the best overall fuzzy match:

- Snippet icon
- source badge
- description or argument hint
- path subtitle for discovered Snippets

Accepting an enabled Snippet inserts a structured inline mention into the composer. The composer
displays the mention chip, not the full expanded Markdown body.

If the Snippet has arguments, the mention exposes inline argument fields:

- `Tab` moves to the next field
- `Enter` accepts the current field and moves forward when another field exists
- final `Enter` returns focus to normal composer text entry
- the mention visibly shows the supplied arguments

The same argument flow applies when the user types a full Snippet mention and commits it with a
space.

Each Snippet chip has a small expand action. Expanding replaces the chip with the resolved Snippet
text directly in the composer so the user can edit the generated prompt text before sending.

## Sent Prompt Behavior

When the user sends a message containing a Snippet mention, `svvy` resolves the mention before the
message reaches pi.

The agent receives the expanded prompt text inline.

`svvy` does not wrap expanded Snippet content in XML or provenance markers by default. Wrappers would
add noise to the model-facing prompt for a feature whose whole purpose is fast prompt text insertion.

Provenance stays in product metadata:

- transcript chips can show which Snippet was used
- transcript chips can expand to show the resolved content
- durable message metadata can store the Snippet id, source, path, content hash, and arguments
- the agent-facing prompt remains clean text

If a user expands the chip before sending, the structured mention is removed and the message is just
ordinary edited text.

## Host Runtime Opt-Out

Host runtime expansion stays disabled.

For pi-backed actors, `@svvy/runtime` and `@svvy/pi-adapter` setup disables host prompt-template
and slash-command expansion for snippet submissions. Exact pi resource-loader flags belong to the
pi-adapter package contract, not to renderer or shared UI contracts.

This means pi prompt-template files can be discovered by `svvy` as read-only Snippets, but pi itself
does not load them, list them as commands, or expand them.

Claude and Codex runtimes are not invoked for Snippet discovery or expansion. The `@svvy/runtime`
source invalidation coordinator discovers and fingerprints supported Markdown files and projects
snippet read models through `@svvy/state`. `@svvy/desktop` renders those read models and draft
previews. Runtime resolves accepted snippet mentions into final user text plus durable provenance
metadata before pi submission.

## Invariants

- Snippets never grant tools.
- Snippets never change model, provider, reasoning, extension loading, generated declarations, or
  execution policy.
- Snippets never add `svvyx` command guidance or generated facades.
- Snippets never alter generated agent context.
- Snippets are sent as user-authored prompt text after explicit insertion.

# Chat shell

The chat-first Studio surface. One long conversation with the agent is the whole
app: the agent manages issues, runs, PRs, workflows, and sandboxes for you, and
shows rich data inline (its HTML tool) or in an **overlay** layered over — or
split beside — the chat. There is **no tab navigation**. The previous tabbed
shell (`shell/AppShell.tsx` and every `*/`-surface it mounts) is untouched and
still reachable via `/studio` or the project-bar gear; this folder is additive.

```
┌────────────────────────────────────────────┐
│ ● acme-web   ▶ 3 runs  ◷ 2 PRs   ⚙          │  ProjectBar + StatsStrip
├───────────────────────────────┬────────────┤
│  YOU  ship the auth fix        │  OVERLAY   │
│  ASSISTANT  opened PR #42      │  (split)   │
│   #auth  #pr-42                │  PR #42    │
│  ┌ html-tool card ──────────┐  │  …         │
│  │ <sandboxed iframe>       │  │            │
│  └──────────────────────────┘  │            │
│  > /pr 42  ⌨ slash autocomplete │            │
└───────────────────────────────┴────────────┘
```

## What is real vs. seam-mocked

The backend has no concept of projects, per-message tags, an agent HTML tool, or
overlays yet. Per the build decision, those four are fed from **typed seams**
with mock implementations today, behind interfaces a real backend drops into
without touching any component. Everything that already has a backend is wired to
it directly.

| Concern              | Today                                  | Real backend (later)                         |
| -------------------- | -------------------------------------- | -------------------------------------------- |
| Conversation         | `feed/useChatFeed` (mock seed)         | wrap `workspace/useAgentChat` (real chat API) |
| Projects + colors    | `projects/useProjects` (mock)          | control-plane projects RPC                    |
| Per-message tags     | seeded on `ChatItem.tags`              | fast tagger agent writes tags server-side     |
| Project stats        | `projects/useProjectStats` (mock)      | gateway run/PR counts                          |
| Agent HTML tool      | `feed/HtmlContent` (sandboxed iframe)  | same renderer; HTML arrives over chat stream  |
| Overlays             | `overlay/*` driven by slash + feed     | overlay tool-calls on the chat stream         |
| Terminal overlay     | **real** Ghostty PTY                   | unchanged                                      |
| Surface overlays     | **real** existing Studio surfaces      | unchanged                                      |
| Slash → CLI/Smithers | `slash/*` catalog maps to CLI features | dispatch executes the command                  |

Each seam lives in one file whose only job is to be swapped. Grep for
`SEAM:` to find every place a mock stands in for a not-yet-built backend.

## Slash commands

Slash commands are the CLI in the UI — each maps to a Smithers feature/endpoint
visible in `smithers --help`. Typing `/` opens an autocomplete menu; selecting a
command either opens its default UI as an overlay or hands the rest to the agent.

| Command      | Smithers feature        | Default UI (overlay)               |
| ------------ | ----------------------- | ---------------------------------- |
| `/workflow`  | `smithers up` / workflow| Workflows surface, then run UI     |
| `/issue`     | issue management        | PR/issue view                      |
| `/pr`        | VCS / landings          | PR view                            |
| `/prompt`    | `smithers ask`          | inline chat                        |
| `/runs`      | `smithers ps`           | Runs surface                       |
| `/memory`    | `smithers memory`       | Memory surface                     |
| `/terminal`  | hijack / PTY            | live Ghostty terminal              |
| `/sandbox`   | sandbox / JJHub         | sandbox iframe                     |
| `/web`       | agent browse            | arbitrary site iframe (agent-wired)|
| `/studio`    | —                       | switches back to the tabbed shell  |

## Overlays

`overlay/overlayStore.ts` holds at most one overlay and a present mode
(`split` beside the chat, or `full` over it). `OverlayHost` renders it;
`renderOverlay` switches on the descriptor `kind`. `surface` overlays reuse the
existing Studio surface components verbatim — "the default UI is just displayed."

## Conventions

One export per file, filename matches the export (`tagColor.ts` → `tagColor`).
Pure logic (`parseSlash`, `resolveSlashAction`, `tagColor`) is split from
components so it is unit-tested without a DOM. Styling is one stylesheet,
`chat.css`, using only the shared `theme.css` tokens.

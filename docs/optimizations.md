# Optimization Notes

## Status

- Date: 2026-06-08
- Status: current performance guidance

## Durable State

Optimize around explicit product records instead of transcript replay:

- sessions
- handler threads
- turns
- commands
- episodes
- artifacts
- generated agent-context bindings
- saved Workflows generated metadata
- app logs

## Workflows

Saved Workflows visibility comes from the latest successful generated `@svvy/workflows` package.

The Workflows pane should read generated export metadata and source/generated file links directly
from the build output metadata instead of scanning transcripts or workspace files repeatedly.

Workspace `.smithers/` authoring remains ordinary repository source and should be indexed like other
workspace files when needed.

## UI

Use metadata-first read models for navigation and panes.

Avoid:

- reconstructing thread state from transcript prose
- repeatedly reading whole command logs into renderer state
- scanning generated Workflows files on every render
- treating generated package links as editable workspace source

## Logs

App logs are observability, not product truth. Use them for debugging and operator inspection, not as
the source of state reconstruction.

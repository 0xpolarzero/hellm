# UI Implementation Notes

Status: non-authoritative UI notes. Do not implement from this file alone; promote any new or
changed product behavior to `docs/prd.md`, `docs/features.ts`, `docs/progress.md`, and the owning
spec first.

## Candidate UI Coverage

- [ ] Render multi-session workspace navigation, Dockview panel bindings, transcript surfaces,
      composer, artifacts, command palette, provider settings, agent-profile settings, workflow-agent
      parameter settings, and app preferences only from `@svvy/core` contracts, `@svvy/state` read
      models, and app/bootstrap-prepared `DesktopRendererNotification` invalidations, rebaseline
      notices, and bounded `surface-stream-patch` payloads, without renderer-owned pi `Agent` state or
      pi-native transcript snapshots.
- [ ] Renderer code must not own runtime behavior; it renders state read models and submits intents
      through bootstrap-provided runtime and state command facades.
- [ ] Render the Workflows pane as read-only generated `@svvyx/workflows` visibility with source and
      generated file links.
- [ ] Link `Agents.*` rows from the Workflows pane to the corresponding Agents-pane customization
      surface.

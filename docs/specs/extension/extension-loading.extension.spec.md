# Extension Loading Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension index; concrete API remains in `docs/specs/extensions-and-tools.spec.md`
- Scope:
  - define Extension Loading as the fixed app-native control extension
  - point to the current canonical `list_extensions` and `load_extension` contracts

## Extension Record

```json
{
  "id": "extension-loading",
  "category": "shipped",
  "interface": "native_tool",
  "title": "Extension Loading",
  "description": "Inspect available extensions and load ready available extensions into the current actor context.",
  "typescriptApiEnabled": false
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `default_loaded` |
| Handler thread | `default_loaded` |
| Workflow task agent | `default_loaded` |

Extension Loading is fixed app-native control. It is always default-loaded and is not configurable
through agent profile extension usage state.

## Tool Surface

```ts
list_extensions()
load_extension({ extensionId: string })
```

Current detailed behavior is defined in:

- `docs/specs/extensions-and-tools.spec.md`, "`list_extensions`"
- `docs/specs/extensions-and-tools.spec.md`, "`load_extension`"
- `docs/specs/extensions-and-tools.spec.md`, "Extension Usage State And Invocation-Time Overrides"

## Notes

- `load_extension` loads an extension for the current actor binding only.
- `load_extension` does not build, install, repair, approve dependencies, or enter secrets.
- Extension lifecycle and source changes belong to the Extension Managing extension.

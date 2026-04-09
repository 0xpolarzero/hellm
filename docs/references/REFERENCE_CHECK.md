# Reference Check

This directory should contain vendored local references for pi and Smithers.

## Required References

- `pi-mono/` — pi agent monorepo reference (git submodule from https://github.com/badlogic/pi-mono.git)
- `smithers/` — Smithers workflow engine reference (git submodule from https://github.com/codeplaneapp/smithers.git)

## Initialization

Run from the repository root:

```sh
bun run prepare:references
```

## Guard Check

If these directories are empty, the references are not initialized and reference-first validation against pi/smithers cannot be performed.

Use strict validation for implementation-review passes:

```sh
bun run validate:references
bun run validate:references:strict
```

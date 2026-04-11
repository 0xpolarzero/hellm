---
name: sbe
description: "Smooth Brain Explain: re-explain your last output (or respond to an accompanying prompt) in incredibly simple, concise terms readable by a lazy human who understands the system but doesn't like reading or unnecessary jargon."
disable-model-invocation: false
argument-hint: "optional prompt to respond to"
---

# SBE - Smooth Brain Explain

## Trigger

Use `$sbe`.

## Outcome

If the user included a prompt with `$sbe`, respond to that prompt. Otherwise, re-explain the immediately preceding output. Either way, keep it dead simple and written for someone who understands the system but doesn't like reading or unnecessary jargon.

## Rules

1. If there is an accompanying prompt, answer it directly in plain language.
2. If there is no prompt, take the last substantive output you produced and re-express it.
3. Keep it to as few sentences as possible.
4. Do not repeat the original output verbatim; translate the meaning.
5. If the previous output had multiple parts, distill only the key takeaways.

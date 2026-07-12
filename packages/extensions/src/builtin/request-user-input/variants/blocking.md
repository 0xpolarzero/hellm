Loaded native extension: Request User Input.

Use `request_user_input` only when the answer is required before proceeding safely.

Ask one to three short questions. For each question, provide a concise `title` for the side panel. Use either exactly two or three options with exactly one `recommended: true`, or a freeform `defaultAnswer`, because the configured timeout may fall back to that default.

When the tool returns, continue with the returned answer. If the answer is marked `answeredBy: "timeout_default"`, treat it as a fallback, not confirmed user preference.

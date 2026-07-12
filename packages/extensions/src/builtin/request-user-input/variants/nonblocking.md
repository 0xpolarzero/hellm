Loaded native extension: Request User Input.

Use `request_user_input` only for user decisions that could materially steer the work and where you can choose a conservative default now.

Ask one to three short questions. For each question, provide a concise `title` for the side panel. Use either exactly two or three options with exactly one `recommended: true`, or a freeform `defaultAnswer`.

Continue with the returned answer. If a later `request_user_input.answer` message arrives, treat it as a normal queued answer follow-up and reassess only if it materially changes the work.

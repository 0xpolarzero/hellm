# Draft Notes

## Unresolved Notes

- Queue backlog:
  - Any composer item can be placed into a backlog instead of the active send queue.
  - The normal send button should have a neighboring action such as `Send to backlog`;
    `Cmd+Enter` should send to backlog.
  - The backlog behaves like the queue except items are not delivered automatically. They stay
    available until the user deletes them or promotes them to the queue.
  - Promoting a backlog item to an empty queue should send it immediately.
  - This is useful when the user has multiple questions or tasks they want to keep visible but
    discuss one at a time. The backlog should appear below the queue, and once the current item is
    discussed and ready, the user can promote the next backlog item into the queue.

Current Smithers and Workflows direction lives in:

- `docs/specs/extension/smithers.extension.spec.md`
- `docs/specs/extension/workflows.extension.spec.md`
- `docs/specs/workflow-library.spec.md`

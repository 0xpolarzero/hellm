export type RuntimeSurfaceQueueWakeReason =
  | "message-submitted"
  | "message-edited"
  | "request-input-answer-queued"
  | "queue-steered"
  | "runtime-queue-inserted"
  | "startup-recovery";

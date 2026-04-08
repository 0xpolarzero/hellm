import {
  createSessionHeader,
  createStructuredSessionEntry,
  reconstructSessionState,
  type SessionJsonlEntry,
  type SessionState,
  type StructuredPayload,
  type StructuredSessionEntry,
} from "@hellm/session-model";
import { nextFixtureId } from "./fixtures";

export class InMemorySessionJsonlHarness {
  private readonly header: SessionJsonlEntry;
  private readonly entries: StructuredSessionEntry[] = [];
  private parentId: string | null = null;

  constructor(input: {
    sessionId?: string;
    cwd: string;
    timestamp?: string;
    parentSession?: string;
  }) {
    this.header = createSessionHeader({
      id: input.sessionId ?? nextFixtureId("session"),
      cwd: input.cwd,
      timestamp: input.timestamp ?? "2026-04-08T09:00:00.000Z",
      ...(input.parentSession ? { parentSession: input.parentSession } : {}),
    });
  }

  append(
    payload: StructuredPayload,
    timestamp = "2026-04-08T09:00:00.000Z",
  ): StructuredSessionEntry {
    const entry = createStructuredSessionEntry({
      id: nextFixtureId("entry"),
      parentId: this.parentId,
      timestamp,
      payload,
    });
    this.entries.push(entry);
    this.parentId = entry.id;
    return entry;
  }

  lines(): SessionJsonlEntry[] {
    return [this.header, ...this.entries];
  }

  jsonl(): string {
    return this.lines().map((entry) => JSON.stringify(entry)).join("\n");
  }

  reconstruct(): SessionState {
    return reconstructSessionState(this.lines());
  }
}

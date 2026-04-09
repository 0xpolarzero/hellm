import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
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

export class FileBackedSessionJsonlHarness {
  readonly filePath: string;
  private parentId: string | null = null;

  constructor(input: {
    filePath: string;
    sessionId?: string;
    cwd: string;
    timestamp?: string;
    parentSession?: string;
  }) {
    this.filePath = resolve(input.filePath);
    mkdirSync(dirname(this.filePath), { recursive: true });

    const header = createSessionHeader({
      id: input.sessionId ?? nextFixtureId("session"),
      cwd: input.cwd,
      timestamp: input.timestamp ?? "2026-04-08T09:00:00.000Z",
      ...(input.parentSession ? { parentSession: input.parentSession } : {}),
    });

    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, `${JSON.stringify(header)}\n`, "utf8");
    }

    const entries = this.lines();
    const lastStructuredEntry = [...entries]
      .toReversed()
      .find(
        (entry): entry is StructuredSessionEntry =>
          typeof entry === "object" &&
          entry !== null &&
          "type" in entry &&
          entry.type === "message" &&
          "id" in entry &&
          typeof entry.id === "string",
      );
    this.parentId = lastStructuredEntry?.id ?? null;
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
    this.appendEntries([entry]);
    return entry;
  }

  appendEntries(entries: readonly StructuredSessionEntry[]): void {
    if (entries.length === 0) {
      return;
    }

    appendFileSync(
      this.filePath,
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
    this.parentId = entries.at(-1)?.id ?? this.parentId;
  }

  jsonl(): string {
    return readFileSync(this.filePath, "utf8");
  }

  lines(): SessionJsonlEntry[] {
    return readFileSync(this.filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SessionJsonlEntry);
  }

  reconstruct(): SessionState {
    return reconstructSessionState(this.lines());
  }
}

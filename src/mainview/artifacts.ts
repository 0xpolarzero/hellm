import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";

const ARTIFACT_COMMANDS = ["create", "update", "rewrite", "get", "delete", "logs"] as const;

export type ArtifactCommand = (typeof ARTIFACT_COMMANDS)[number];
export type ArtifactKind =
  | "html"
  | "svg"
  | "markdown"
  | "image"
  | "pdf"
  | "excel"
  | "docx"
  | "text"
  | "generic";

export interface ArtifactRecord {
  filename: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactsSnapshot {
  activeFilename: string | null;
  artifacts: ArtifactRecord[];
  logsByFilename: Record<string, string>;
}

const artifactCommandSchema = Type.Union(ARTIFACT_COMMANDS.map((command) => Type.Literal(command)));

export const artifactsParamsSchema = Type.Object({
  command: artifactCommandSchema,
  filename: Type.String({
    description: "Filename including extension, for example index.html or notes.md.",
  }),
  content: Type.Optional(
    Type.String({ description: "File content for create or rewrite operations." }),
  ),
  old_str: Type.Optional(
    Type.String({ description: "Existing string to replace for update operations." }),
  ),
  new_str: Type.Optional(Type.String({ description: "Replacement string for update operations." })),
});

export type ArtifactsParams = Static<typeof artifactsParamsSchema>;

const ARTIFACT_TOOL_DESCRIPTION = [
  "Manage renderer artifacts with preview support.",
  "Use create to add a new file, rewrite to replace a file, update to replace one exact substring, get to read a file, delete to remove it, and logs to inspect the latest HTML preview logs.",
  "HTML artifacts run in a sandboxed preview and can call listArtifacts() and getArtifact(filename) to read other artifacts.",
].join(" ");

export function parseArtifactsParams(value: unknown): ArtifactsParams | null {
  if (!value || typeof value !== "object") return null;

  const maybeParams = value as Record<string, unknown>;
  const command = maybeParams.command;
  const filename = maybeParams.filename;
  if (!ARTIFACT_COMMANDS.includes(command as ArtifactCommand) || typeof filename !== "string") {
    return null;
  }

  const params: ArtifactsParams = {
    command,
    filename,
  } as ArtifactsParams;

  if (typeof maybeParams.content === "string") {
    params.content = maybeParams.content;
  }
  if (typeof maybeParams.old_str === "string") {
    params.old_str = maybeParams.old_str;
  }
  if (typeof maybeParams.new_str === "string") {
    params.new_str = maybeParams.new_str;
  }

  return params;
}

export function getArtifactKind(filename: string): ArtifactKind {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "html") return "html";
  if (extension === "svg") return "svg";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "pdf") return "pdf";
  if (extension === "xlsx" || extension === "xls") return "excel";
  if (extension === "docx") return "docx";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].includes(extension || "")) return "image";
  if (
    [
      "txt",
      "json",
      "xml",
      "yaml",
      "yml",
      "csv",
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "java",
      "c",
      "cpp",
      "h",
      "css",
      "scss",
      "sass",
      "less",
      "sh",
    ].includes(extension || "")
  ) {
    return "text";
  }
  return "generic";
}

export function getArtifactCommandCopy(command: ArtifactCommand): {
  inProgress: string;
  complete: string;
} {
  const copy: Record<ArtifactCommand, { inProgress: string; complete: string }> = {
    create: { inProgress: "Creating artifact", complete: "Created artifact" },
    update: { inProgress: "Updating artifact", complete: "Updated artifact" },
    rewrite: { inProgress: "Rewriting artifact", complete: "Rewrote artifact" },
    get: { inProgress: "Reading artifact", complete: "Read artifact" },
    delete: { inProgress: "Deleting artifact", complete: "Deleted artifact" },
    logs: { inProgress: "Inspecting logs", complete: "Read logs" },
  };

  return copy[command];
}

type ArtifactsListener = (snapshot: ArtifactsSnapshot) => void;

type ExecuteOptions = {
  silent?: boolean;
  skipWait?: boolean;
};

function createRuntimeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getTextResult(content: Array<{ type: string }> | undefined): string {
  if (!content) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export class ArtifactsController {
  private artifacts = new Map<string, ArtifactRecord>();
  private logsByFilename = new Map<string, string>();
  private toolCallsById = new Map<string, ArtifactsParams>();
  private activeFilename: string | null = null;
  private listeners = new Set<ArtifactsListener>();
  private refreshGeneration = 0;
  private htmlLogsRefreshPromise: Promise<void> | null = null;
  private disposed = false;
  private syncedMessageCount = 0;

  subscribe(listener: ArtifactsListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  getSnapshot(): ArtifactsSnapshot {
    return {
      activeFilename: this.activeFilename,
      artifacts: Array.from(this.artifacts.values()),
      logsByFilename: Object.fromEntries(this.logsByFilename.entries()),
    };
  }

  getPreviewDocument(filename: string): string {
    const artifact = this.artifacts.get(filename);
    if (!artifact) return "";
    return this.buildHtmlDocument(artifact.content);
  }

  selectArtifact(filename: string): void {
    if (!this.artifacts.has(filename)) return;
    this.activeFilename = filename;
    this.emit();
  }

  get tool(): AgentTool<typeof artifactsParamsSchema, undefined> {
    return {
      label: "Artifacts",
      name: "artifacts",
      description: ARTIFACT_TOOL_DESCRIPTION,
      parameters: artifactsParamsSchema,
      execute: async (_toolCallId, args) => {
        const result = await this.executeCommand(args);
        return { content: [{ type: "text", text: result }], details: undefined };
      },
    };
  }

  // Sync committed transcript messages from a cursor; steady-state runtime ticks can advance
  // the cursor without replaying the full history.
  async syncFromMessages(
    messages: AgentMessage[],
    options: { replace?: boolean } = {},
  ): Promise<void> {
    const shouldReset = options.replace || messages.length < this.syncedMessageCount;
    if (shouldReset) {
      this.resetProjection();
    }

    const startIndex = this.syncedMessageCount;
    if (startIndex >= messages.length) {
      if (shouldReset) {
        this.emit();
      }
      return;
    }

    const batch = messages.slice(startIndex);
    let mutated = false;
    let needsHtmlRefresh = false;

    for (const message of batch) {
      if (message.role !== "assistant") continue;
      for (const block of message.content) {
        if (block.type !== "toolCall" || block.name !== "artifacts") continue;
        const params = parseArtifactsParams(block.arguments);
        if (params) {
          this.toolCallsById.set(block.id, params);
        }
      }
    }

    for (const message of batch) {
      if (message.role !== "toolResult" || message.toolName !== "artifacts" || message.isError) {
        continue;
      }

      const params = this.toolCallsById.get(message.toolCallId);
      if (!params) continue;
      this.toolCallsById.delete(message.toolCallId);
      if (params.command === "get" || params.command === "logs") continue;

      const result = this.applyArtifactOperation(params);
      mutated ||= result.mutated;
      needsHtmlRefresh ||= result.needsHtmlRefresh;
    }

    this.syncedMessageCount = messages.length;
    if (shouldReset) {
      this.activeFilename =
        this.artifacts.size > 0 ? (Array.from(this.artifacts.keys())[0] ?? null) : null;
    }

    if (needsHtmlRefresh) {
      await this.ensureHtmlLogsRefreshed();
      return;
    }

    if (mutated || shouldReset) {
      this.emit();
    }
  }

  private emit(): void {
    if (this.disposed) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private async executeCommand(
    params: ArtifactsParams,
    options: ExecuteOptions = {},
  ): Promise<string> {
    switch (params.command) {
      case "create":
        return this.createArtifact(params, options);
      case "update":
        return this.updateArtifact(params, options);
      case "rewrite":
        return this.rewriteArtifact(params, options);
      case "get":
        return this.getArtifact(params);
      case "delete":
        return this.deleteArtifact(params, options);
      case "logs":
        return this.getLogs(params);
    }
  }

  private setArtifact(filename: string, content: string): ArtifactRecord {
    const existing = this.artifacts.get(filename);
    const record: ArtifactRecord = {
      filename,
      content,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    this.artifacts.set(filename, record);
    this.activeFilename = filename;
    return record;
  }

  private resetProjection(): void {
    this.artifacts.clear();
    this.logsByFilename.clear();
    this.toolCallsById.clear();
    this.activeFilename = null;
    this.syncedMessageCount = 0;
  }

  private applyArtifactOperation(params: ArtifactsParams): {
    mutated: boolean;
    needsHtmlRefresh: boolean;
  } {
    const kind = getArtifactKind(params.filename);
    const previous = this.artifacts.get(params.filename);
    const previousContent = previous?.content;
    const now = Date.now();

    switch (params.command) {
      case "create":
      case "rewrite": {
        if (!params.content) {
          return { mutated: false, needsHtmlRefresh: false };
        }

        this.artifacts.set(params.filename, {
          filename: params.filename,
          content: params.content,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        });

        return {
          mutated: true,
          needsHtmlRefresh:
            kind === "html" && (previousContent === undefined || previousContent !== params.content),
        };
      }
      case "update": {
        if (!previous || params.old_str === undefined || params.new_str === undefined) {
          return { mutated: false, needsHtmlRefresh: false };
        }

        const nextContent = previous.content.replace(params.old_str, params.new_str);
        this.artifacts.set(params.filename, {
          ...previous,
          content: nextContent,
          updatedAt: now,
        });

        return {
          mutated: true,
          needsHtmlRefresh: kind === "html" && previousContent !== nextContent,
        };
      }
      case "delete": {
        if (!previous) {
          return { mutated: false, needsHtmlRefresh: false };
        }

        this.artifacts.delete(params.filename);
        this.logsByFilename.delete(params.filename);
        this.activeFilename =
          this.artifacts.size > 0 ? (Array.from(this.artifacts.keys())[0] ?? null) : null;

        return {
          mutated: true,
          needsHtmlRefresh: kind === "html",
        };
      }
      case "get":
      case "logs":
        return { mutated: false, needsHtmlRefresh: false };
    }
  }

  private async createArtifact(params: ArtifactsParams, options: ExecuteOptions): Promise<string> {
    if (!params.content) return "Error: create command requires filename and content.";
    if (this.artifacts.has(params.filename)) {
      return `Error: File ${params.filename} already exists.`;
    }

    this.setArtifact(params.filename, params.content);
    const logs = await this.captureLogsIfNeeded(params.filename, options.skipWait);
    this.queueHtmlRefresh(params.filename);
    if (!options.silent) this.emit();
    return logs ? `Created file ${params.filename}\n${logs}` : `Created file ${params.filename}`;
  }

  private async updateArtifact(params: ArtifactsParams, options: ExecuteOptions): Promise<string> {
    const artifact = this.artifacts.get(params.filename);
    if (!artifact) {
      const available = Array.from(this.artifacts.keys());
      if (available.length === 0)
        return `Error: File ${params.filename} not found. No files have been created yet.`;
      return `Error: File ${params.filename} not found. Available files: ${available.join(", ")}`;
    }
    if (params.old_str === undefined || params.new_str === undefined) {
      return "Error: update command requires old_str and new_str.";
    }
    if (!artifact.content.includes(params.old_str)) {
      return `Error: String not found in file. Here is the full content:\n\n${artifact.content}`;
    }

    this.setArtifact(params.filename, artifact.content.replace(params.old_str, params.new_str));
    const logs = await this.captureLogsIfNeeded(params.filename, options.skipWait);
    this.queueHtmlRefresh(params.filename);
    if (!options.silent) this.emit();
    return logs ? `Updated file ${params.filename}\n${logs}` : `Updated file ${params.filename}`;
  }

  private async rewriteArtifact(params: ArtifactsParams, options: ExecuteOptions): Promise<string> {
    if (!this.artifacts.has(params.filename)) {
      const available = Array.from(this.artifacts.keys());
      if (available.length === 0)
        return `Error: File ${params.filename} not found. No files have been created yet.`;
      return `Error: File ${params.filename} not found. Available files: ${available.join(", ")}`;
    }
    if (!params.content) return "Error: rewrite command requires content.";

    this.setArtifact(params.filename, params.content);
    const logs = await this.captureLogsIfNeeded(params.filename, options.skipWait);
    this.queueHtmlRefresh(params.filename);
    if (!options.silent) this.emit();
    return logs ? `Rewrote file ${params.filename}\n${logs}` : `Rewrote file ${params.filename}`;
  }

  private getArtifact(params: ArtifactsParams): string {
    const artifact = this.artifacts.get(params.filename);
    if (!artifact) {
      const available = Array.from(this.artifacts.keys());
      if (available.length === 0)
        return `Error: File ${params.filename} not found. No files have been created yet.`;
      return `Error: File ${params.filename} not found. Available files: ${available.join(", ")}`;
    }
    return artifact.content;
  }

  private deleteArtifact(params: ArtifactsParams, options: ExecuteOptions): string {
    const artifact = this.artifacts.get(params.filename);
    if (!artifact) {
      const available = Array.from(this.artifacts.keys());
      if (available.length === 0)
        return `Error: File ${params.filename} not found. No files have been created yet.`;
      return `Error: File ${params.filename} not found. Available files: ${available.join(", ")}`;
    }

    this.artifacts.delete(params.filename);
    this.logsByFilename.delete(params.filename);
    this.activeFilename =
      this.artifacts.size > 0 ? (Array.from(this.artifacts.keys())[0] ?? null) : null;
    this.queueHtmlRefresh();
    if (!options.silent) this.emit();
    return `Deleted file ${params.filename}`;
  }

  private getLogs(params: ArtifactsParams): string {
    const artifact = this.artifacts.get(params.filename);
    if (!artifact) {
      const available = Array.from(this.artifacts.keys());
      if (available.length === 0)
        return `Error: File ${params.filename} not found. No files have been created yet.`;
      return `Error: File ${params.filename} not found. Available files: ${available.join(", ")}`;
    }
    if (getArtifactKind(params.filename) !== "html") {
      return `Error: File ${params.filename} is not an HTML file. Logs are only available for HTML files.`;
    }

    return this.logsByFilename.get(params.filename) || "(no logs yet)";
  }

  private async captureLogsIfNeeded(filename: string, skipWait = false): Promise<string> {
    if (getArtifactKind(filename) !== "html") return "";
    if (skipWait) {
      this.logsByFilename.set(filename, "");
      return "";
    }

    const artifact = this.artifacts.get(filename);
    if (!artifact) return "";

    const logs = await this.captureHtmlLogs(filename, artifact.content);
    this.logsByFilename.set(filename, logs);
    return logs;
  }

  private queueHtmlRefresh(excludeFilename?: string): void {
    void this.ensureHtmlLogsRefreshed(excludeFilename);
  }

  private ensureHtmlLogsRefreshed(excludeFilename?: string): Promise<void> {
    if (this.htmlLogsRefreshPromise) {
      return this.htmlLogsRefreshPromise;
    }

    const refreshPromise = this.refreshHtmlArtifacts(excludeFilename).finally(() => {
      if (this.htmlLogsRefreshPromise === refreshPromise) {
        this.htmlLogsRefreshPromise = null;
      }
    });
    this.htmlLogsRefreshPromise = refreshPromise;
    return refreshPromise;
  }

  private async refreshHtmlArtifacts(excludeFilename?: string): Promise<void> {
    const generation = ++this.refreshGeneration;
    const htmlArtifacts = Array.from(this.artifacts.values()).filter(
      (artifact) =>
        getArtifactKind(artifact.filename) === "html" && artifact.filename !== excludeFilename,
    );

    for (const artifact of htmlArtifacts) {
      if (this.disposed || generation !== this.refreshGeneration) return;
      const logs = await this.captureHtmlLogs(artifact.filename, artifact.content);
      if (this.disposed || generation !== this.refreshGeneration) return;
      this.logsByFilename.set(artifact.filename, logs);
    }

    if (generation === this.refreshGeneration) {
      this.emit();
    }
  }

  private buildHtmlDocument(content: string, token?: string): string {
    const snapshot = JSON.stringify(
      Object.fromEntries(
        Array.from(this.artifacts.entries()).map(([filename, artifact]) => [
          filename,
          artifact.content,
        ]),
      ),
    ).replace(/</g, "\\u003c");
    const runtimeScript = `
			<script>
				(() => {
					const artifactSnapshot = ${snapshot};
					const channelToken = ${JSON.stringify(token ?? null)};
					const send = (type, payload) => {
						if (!channelToken) return;
						parent.postMessage({ source: "svvy-artifact", token: channelToken, type, payload }, "*");
					};
					const formatValue = (value) => {
						if (typeof value === "string") return value;
						try {
							return JSON.stringify(value);
						} catch (error) {
							return String(value);
						}
					};
					const writeLog = (level, args) => {
						const entry = \`[\${level}] \${args.map(formatValue).join(" ")}\`;
						window.__svvyLogs = window.__svvyLogs || [];
						window.__svvyLogs.push(entry);
						send("console", { entry });
					};
					window.artifacts = artifactSnapshot;
					window.listArtifacts = async () => Object.keys(artifactSnapshot);
					window.getArtifact = async (filename) => {
						if (!(filename in artifactSnapshot)) {
							throw new Error(\`Artifact not found: \${filename}\`);
						}
						const value = artifactSnapshot[filename];
						if (filename.toLowerCase().endsWith(".json")) {
							try {
								return JSON.parse(value);
							} catch (error) {
								return value;
							}
						}
						return value;
					};
					const consoleMethods = ["log", "info", "warn", "error"];
					for (const method of consoleMethods) {
						const original = console[method] ? console[method].bind(console) : undefined;
						console[method] = (...args) => {
							writeLog(method, args);
							original?.(...args);
						};
					}
					window.addEventListener("error", (event) => {
						writeLog("error", [event.message || "Script error"]);
					});
					window.addEventListener("unhandledrejection", (event) => {
						const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
						writeLog("rejection", [reason]);
					});
					window.__svvyGetLogs = () => (window.__svvyLogs || []).join("\\n");
					send("ready", {});
				})();
			</script>
		`;

    if (/<\/head>/i.test(content)) {
      return content.replace(/<\/head>/i, `${runtimeScript}</head>`);
    }
    if (/<body[^>]*>/i.test(content)) {
      return content.replace(/<body([^>]*)>/i, `<body$1>${runtimeScript}`);
    }

    return `<!doctype html><html><head><meta charset="utf-8">${runtimeScript}</head><body>${content}</body></html>`;
  }

  private async captureHtmlLogs(_filename: string, content: string): Promise<string> {
    if (typeof document === "undefined" || typeof window === "undefined") return "";

    const token = createRuntimeId();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    iframe.style.top = "-9999px";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";

    const logs: string[] = [];

    return await new Promise((resolve) => {
      const finish = () => {
        window.removeEventListener("message", onMessage);
        iframe.remove();
        resolve(logs.join("\n"));
      };

      const timeoutId = window.setTimeout(finish, 1500);

      const onMessage = (event: MessageEvent) => {
        const payload = event.data as
          | { source?: string; token?: string; type?: string; payload?: { entry?: string } }
          | undefined;
        if (!payload || payload.source !== "svvy-artifact" || payload.token !== token) return;
        if (payload.type === "console" && typeof payload.payload?.entry === "string") {
          logs.push(payload.payload.entry);
        }
      };

      window.addEventListener("message", onMessage);
      document.body.appendChild(iframe);
      iframe.addEventListener(
        "load",
        () => {
          window.setTimeout(() => {
            window.clearTimeout(timeoutId);
            finish();
          }, 1200);
        },
        { once: true },
      );
      iframe.srcdoc = this.buildHtmlDocument(content, token);
    });
  }
}

export function buildArtifactsToolCallMap(messages: AgentMessage[]): Map<string, ArtifactsParams> {
  const toolCalls = new Map<string, ArtifactsParams>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall" || block.name !== "artifacts") continue;
      const params = parseArtifactsParams(block.arguments);
      if (params) {
        toolCalls.set(block.id, params);
      }
    }
  }
  return toolCalls;
}

export function buildArtifactResultsMap(messages: AgentMessage[]): Map<string, string> {
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "toolResult" || message.toolName !== "artifacts") continue;
    results.set(
      message.toolCallId,
      getTextResult(message.content as Array<{ type: string }> | undefined),
    );
  }
  return results;
}

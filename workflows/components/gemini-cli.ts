import { BaseCliAgent } from "@smithers-orchestrator/agents";

export class GeminiCliAgent extends BaseCliAgent {
  readonly cliEngine = "gemini-cli";

  createOutputInterpreter() {
    let sessionId: string | undefined;
    let answer = "";
    let completed = false;

    return {
      onStdoutLine: (line: string) => {
        let payload: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
          payload = parsed as Record<string, unknown>;
        } catch {
          return [];
        }

        if (payload.type === "init") {
          sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
          return [{
            type: "started" as const,
            engine: this.cliEngine,
            title: "Gemini CLI",
            resume: sessionId,
            detail: { model: payload.model },
          }];
        }

        if (payload.type === "message" && payload.role === "assistant" && typeof payload.content === "string") {
          answer = payload.delta === true ? answer + payload.content : payload.content;
          return [];
        }

        if (payload.type === "tool_use") {
          const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "tool";
          return [{
            type: "action" as const,
            engine: this.cliEngine,
            phase: "started" as const,
            entryType: "thought" as const,
            action: {
              id: typeof payload.tool_id === "string" ? payload.tool_id : `${this.id}-${Date.now()}`,
              kind: "tool" as const,
              title: toolName,
              detail: { parameters: payload.parameters },
            },
            message: `Running ${toolName}`,
            level: "info" as const,
          }];
        }

        if (payload.type === "tool_result") {
          const ok = payload.status !== "error";
          return [{
            type: "action" as const,
            engine: this.cliEngine,
            phase: "completed" as const,
            entryType: "thought" as const,
            action: {
              id: typeof payload.tool_id === "string" ? payload.tool_id : `${this.id}-${Date.now()}`,
              kind: "tool" as const,
              title: "tool result",
              detail: { status: payload.status },
            },
            message: typeof payload.output === "string" ? payload.output.slice(0, 400) : undefined,
            ok,
            level: ok ? "info" as const : "warning" as const,
          }];
        }

        if (payload.type === "result") {
          completed = true;
          return [{
            type: "completed" as const,
            engine: this.cliEngine,
            ok: payload.status !== "error",
            answer,
            resume: sessionId,
            usage: typeof payload.stats === "object" && payload.stats !== null
              ? payload.stats as Record<string, unknown>
              : undefined,
          }];
        }

        return [];
      },
      onExit: (result: { exitCode: number | null; stderr: string }) => {
        if (completed) return [];
        completed = true;
        return [{
          type: "completed" as const,
          engine: this.cliEngine,
          ok: result.exitCode === 0,
          answer: answer || undefined,
          error: result.exitCode === 0 ? undefined : result.stderr.trim(),
          resume: sessionId,
        }];
      },
    };
  }

  async buildCommand(params: {
    prompt: string;
    systemPrompt?: string;
    cwd: string;
    options?: { resumeSession?: string };
  }) {
    const prompt = `${params.systemPrompt ? `${params.systemPrompt}\n\n` : ""}${params.prompt}${
      params.prompt.includes("REQUIRED OUTPUT")
        ? "\n\nREMINDER: Respond with only the required raw JSON object. The first character must be `{` and the last character must be `}`."
        : ""
    }`;
    const args = [
      "--model", this.model ?? "gemini-2.5-pro",
      "--output-format", "stream-json",
      "--approval-mode", "yolo",
    ];
    if (params.options?.resumeSession) args.push("--resume", params.options.resumeSession);
    args.push("--prompt", prompt);
    return { command: "gemini", args, outputFormat: "stream-json" as const };
  }
}

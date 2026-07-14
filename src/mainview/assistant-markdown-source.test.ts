import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("assistant Markdown renderer source contract", () => {
  it("renders coding-agent Markdown with safe rich output affordances", async () => {
    const source = await readFile(new URL("./AssistantMarkdown.svelte", import.meta.url), "utf8");

    expect(source).toContain('import MarkdownIt from "markdown-it";');
    expect(source).toContain('import { katex } from "@mdit/plugin-katex";');
    expect(source).toContain('import taskLists from "markdown-it-task-lists";');
    expect(source).toContain("html: false");
    expect(source).toContain("renderCodeFrame");
    expect(source).toContain("data-copy-code");
    expect(source).toContain("writeClipboardText");
    expect(source).toContain("createBundledHighlighter");
    expect(source).toContain("createJavaScriptRegexEngine");
    expect(source).toContain("renderMermaidFrame");
    expect(source).toContain("markdown.renderer.rules.fence");
    expect(source).toContain("Copy diagram source");
    expect(source).toContain('securityLevel: "strict"');
    expect(source).toContain("function mermaidColorVariable");
    expect(source).toContain('getContext("2d")');
    expect(source).toContain(".mermaid-rendered");
    expect(source).toContain(".mermaid-fallback");
    expect(source).toContain('block.dataset.renderState = "rendered"');
    expect(source).toContain('block.dataset.renderState = "error"');
    expect(source).toContain("block.dataset.renderError =");
    expect(source).toContain('block.dataset.renderState = "loading"');
    expect(source).toContain('console.error("Failed to load Mermaid renderer:", error)');
    expect(source).toContain('console.error("Failed to render Mermaid diagram:", error)');
    expect(source).toContain("throwOnError: false");
    expect(source).toContain('output: "html"');
    expect(source).toContain(".contains-task-list");
    expect(source).toContain('input[type="checkbox"]');
    expect(source).toContain(".assistant-markdown :global(table)");
    expect(source).toContain(".assistant-markdown :global(th)");
    expect(source).toContain(".assistant-markdown :global(td)");
  });

  it("renders reasoning as collapsed Markdown and persists transcript scroll and turn duration", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );
    const runtimeTestSource = await readFile(
      new URL("./chat-runtime.test.ts", import.meta.url),
      "utf8",
    );
    const timerTestSource = await readFile(
      new URL("./working-timer.test.ts", import.meta.url),
      "utf8",
    );

    expect(transcriptSource).toContain('<details class="thinking-block">');
    expect(transcriptSource).toContain("<summary>Reasoning</summary>");
    expect(transcriptSource).toContain(
      "<AssistantMarkdown content={thinkingDisplayText(block)} isFinished={true} />",
    );
    expect(transcriptSource).toContain(
      "<AssistantMarkdown content={thinkingDisplayText(block)} isFinished={false} />",
    );
    expect(transcriptSource).toContain('anchorTo: "end"');
    expect(transcriptSource).toContain("followOnAppend: transcriptFollowBehavior()");
    expect(transcriptSource).toContain("onScrollStateChange");
    expect(transcriptSource).toContain("initialScroll");
    expect(transcriptSource).toContain("formatTurnDuration(");
    expect(transcriptSource).toContain("formatTurnDurationTooltip(");
    expect(runtimeTestSource).toContain(
      "applies ordered native stream patches across a surface read-model refresh",
    );
    expect(timerTestSource).toContain(
      "formats completed assistant turn durations from persisted timestamps",
    );
  });
});

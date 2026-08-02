const FORBIDDEN_SMITHERS_PROMPT_PATTERNS = [
  /\bGUI\b/i,
  /\bGateway\b/i,
  /\bMCP\b/i,
  /\bHTTP\b/i,
  /\bOpenTelemetry\b/i,
  /\bDevTools\b/i,
  /\bevent-stream(?:ing)?\b/i,
  /\bOpenAPI\b/i,
  /\bEffect\b/i,
  /\bwrapper tools?\b/i,
  /\bnative model-facing tools?\b/i,
  /\bproduct workflow wrappers?\b/i,
  /\bagent skill\b/i,
];

const CORE_SECTION_BOUNDARIES: Array<{ start: string; end: string }> = [
  {
    start: "## Recommended: Install the Workflow Pack",
    end: "## Install the Agent Skill",
  },
  {
    start: "## Quickstart",
    end: "## Starters",
  },
  {
    start: "## JSX API",
    end: "## Setup",
  },
  {
    start: "## The render loop in detail",
    end: "## The `ctx` API",
  },
  {
    start: "## 5. An approval gate",
    end: "## 6. Crash, then resume",
  },
  {
    start: "## Durability & resume",
    end: "## Session snapshots & fork",
  },
  {
    start: "## Common gotchas",
    end: "## Read next",
  },
];

const MEMORY_SECTION_BOUNDARY = {
  start: "## Memory (cross-run state)",
  end: "## Tools & sandboxing",
};

export function generateSmithersCoreInstructions(upstreamFullDocs: string): string {
  const body = CORE_SECTION_BOUNDARIES.map((boundary) =>
    extractMarkdownRange(upstreamFullDocs, boundary.start, boundary.end),
  )
    .map(rewriteSmithersCliExamples)
    .map(removeForbiddenPromptLines)
    .join("\n\n")
    .trim();
  assertGeneratedSmithersPrompt(body, "core");
  return [
    "Generated Smithers core instructions from smthrs@0.22.0 official docs.",
    "",
    "svvy uses official `bunx smthrs ...` commands through Shell. TypeScript workflow source still imports from `smthrs`.",
    "",
    body,
    "",
  ].join("\n");
}

export function generateSmithersMemoryInstructions(upstreamFullDocs: string): string {
  const body = removeForbiddenPromptLines(
    rewriteSmithersCliExamples(
      extractMarkdownRange(
        upstreamFullDocs,
        MEMORY_SECTION_BOUNDARY.start,
        MEMORY_SECTION_BOUNDARY.end,
      ),
    ),
  ).trim();
  assertGeneratedSmithersPrompt(body, "memory");
  return [
    "Generated Smithers memory instructions from smthrs@0.22.0 official docs.",
    "",
    "This fragment is generated and inspectable but bypassed by default in svvy.",
    "",
    body,
    "",
  ].join("\n");
}

function extractMarkdownRange(markdown: string, startHeading: string, endHeading: string): string {
  const start = markdown.indexOf(startHeading);
  if (start < 0) {
    throw new Error(`Smithers upstream docs are missing section: ${startHeading}`);
  }
  const end = markdown.indexOf(endHeading, start + startHeading.length);
  if (end < 0) {
    throw new Error(`Smithers upstream docs are missing section end: ${endHeading}`);
  }
  return markdown.slice(start, end).trim();
}

function rewriteSmithersCliExamples(markdown: string): string {
  return markdown.replace(/\bbunx\s+smithers(?!-orchestrator)\b/g, "bunx smthrs");
}

function removeForbiddenPromptLines(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !FORBIDDEN_SMITHERS_PROMPT_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function assertGeneratedSmithersPrompt(prompt: string, label: string): void {
  if (!prompt.trim()) {
    throw new Error(`Generated Smithers ${label} instructions are empty.`);
  }
  if (/\bsmithers\s+(init|workflow|ps|inspect|logs|up|approve|supervise|starters)\b/.test(prompt)) {
    throw new Error(
      `Generated Smithers ${label} instructions still contain bare smithers commands.`,
    );
  }
  const forbidden = FORBIDDEN_SMITHERS_PROMPT_PATTERNS.find((pattern) => pattern.test(prompt));
  if (forbidden) {
    throw new Error(
      `Generated Smithers ${label} instructions include excluded fragment pattern: ${forbidden}`,
    );
  }
}

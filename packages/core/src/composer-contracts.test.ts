import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  DiscoveredSnippetSourceSchema,
  discoveredHostSnippetId,
  parseSnippetMarkdown,
  SnippetMetadataSchema,
} from "./composer-contracts";

describe("composer snippet contracts", () => {
  it("parses supported host Markdown metadata into the exact core shape", () => {
    expect(
      parseSnippetMarkdown(
        `---\ndescription: "Review a change"\nargument-hint: path\n---\nReview $1`,
      ),
    ).toEqual({
      body: "Review $1",
      metadata: { description: "Review a change", argumentHint: "path" },
    });
    expect(
      Schema.decodeUnknownSync(SnippetMetadataSchema)(
        parseSnippetMarkdown("Plain prompt").metadata,
      ),
    ).toEqual({ description: null, argumentHint: null });
  });

  it("keeps discovered source identity restricted to Claude and pi", () => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(DiscoveredSnippetSourceSchema)("claude"))).toBe(
      true,
    );
    expect(Exit.isFailure(Schema.decodeUnknownExit(DiscoveredSnippetSourceSchema)("svvy"))).toBe(
      true,
    );
    expect(
      discoveredHostSnippetId({
        source: "pi",
        scope: "workspace",
        path: "/workspace/.pi/prompts/review.md" as never,
      }) as string,
    ).toBe("pi:workspace:/workspace/.pi/prompts/review.md");
  });
});

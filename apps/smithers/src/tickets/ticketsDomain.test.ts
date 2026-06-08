import { describe, expect, test } from "bun:test";
import {
  createTicket,
  deleteTicket,
  searchTickets,
  SEEDED_TICKETS,
  ticketSnippet,
  toneForTicketStatus,
  updateTicket,
} from "./tickets";

/**
 * Pure domain tests for the tickets surface: the snippet extractor, search, and
 * the create/update/delete reducers the card and canvas lean on. No DOM, no store.
 */

describe("ticketSnippet", () => {
  test("returns the first content line after a ## Summary heading", () => {
    const content = ["# Title", "", "## Summary", "Port the tickets view.", "More text."].join("\n");
    expect(ticketSnippet(content)).toBe("Port the tickets view.");
  });

  test("matches the heading case-insensitively", () => {
    const content = ["## summary", "lowercase heading wins."].join("\n");
    expect(ticketSnippet(content)).toBe("lowercase heading wins.");
  });

  test("falls back to the first line that is not a heading, rule, or metadata", () => {
    const content = ["# Title", "---", "- owner: will", "Real body line."].join("\n");
    expect(ticketSnippet(content)).toBe("Real body line.");
  });

  test("skips headings after a summary marker and keeps scanning", () => {
    const content = ["## Summary", "", "### Sub", "Actual summary line."].join("\n");
    expect(ticketSnippet(content)).toBe("Actual summary line.");
  });

  test("returns empty string when only headings, rules, and metadata exist", () => {
    const content = ["# Title", "---", "- key: value"].join("\n");
    expect(ticketSnippet(content)).toBe("");
  });

  test("truncates with a single ellipsis when over maxLength", () => {
    const long = "x".repeat(120);
    const snippet = ticketSnippet(long, 10);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBe(10);
    expect(snippet).toBe(`${"x".repeat(9)}…`);
  });

  test("does not truncate a line at or under maxLength", () => {
    expect(ticketSnippet("short line", 92)).toBe("short line");
  });

  test("treats a multi-word key as a body line, not metadata", () => {
    const content = ["- this is a long sentence: with a colon"].join("\n");
    expect(ticketSnippet(content)).toBe("- this is a long sentence: with a colon");
  });
});

describe("searchTickets", () => {
  test("an empty or whitespace query returns every ticket", () => {
    expect(searchTickets(SEEDED_TICKETS, "")).toBe(SEEDED_TICKETS);
    expect(searchTickets(SEEDED_TICKETS, "   ")).toBe(SEEDED_TICKETS);
  });

  test("matches on id", () => {
    const hits = searchTickets(SEEDED_TICKETS, "snippet");
    expect(hits.map((t) => t.id)).toEqual(["fix-snippet-truncation"]);
  });

  test("matches on content", () => {
    const hits = searchTickets(SEEDED_TICKETS, "neovim");
    expect(hits.map((t) => t.id)).toEqual(["docs-markdown-editor"]);
  });

  test("is case-insensitive", () => {
    expect(searchTickets(SEEDED_TICKETS, "ISSUES")).toEqual(
      searchTickets(SEEDED_TICKETS, "issues"),
    );
    expect(searchTickets(SEEDED_TICKETS, "ISSUES").length).toBeGreaterThan(0);
  });
});

describe("toneForTicketStatus", () => {
  test("maps each status to its tone class", () => {
    expect(toneForTicketStatus("todo")).toBe("tone-info");
    expect(toneForTicketStatus("in-progress")).toBe("tone-waiting");
    expect(toneForTicketStatus("done")).toBe("tone-ok");
  });
});

describe("createTicket", () => {
  test("prepends a todo ticket stamped just now and is immutable", () => {
    const { tickets, created } = createTicket(SEEDED_TICKETS, {
      id: "new-one",
      content: "## Summary\nFresh.",
    });
    expect(tickets).not.toBe(SEEDED_TICKETS);
    expect(tickets[0]).toBe(created);
    expect(created.status).toBe("todo");
    expect(created.updated).toBe("just now");
    expect(tickets.length).toBe(SEEDED_TICKETS.length + 1);
  });
});

describe("updateTicket", () => {
  test("sets content and updated just now on the target only, immutably", () => {
    const target = SEEDED_TICKETS[0];
    const next = updateTicket(SEEDED_TICKETS, target.id, "new body");
    expect(next).not.toBe(SEEDED_TICKETS);
    const hit = next.find((t) => t.id === target.id)!;
    expect(hit.content).toBe("new body");
    expect(hit.updated).toBe("just now");
    expect(next[1]).toBe(SEEDED_TICKETS[1]);
  });
});

describe("deleteTicket", () => {
  test("drops the matching ticket immutably", () => {
    const target = SEEDED_TICKETS[0];
    const next = deleteTicket(SEEDED_TICKETS, target.id);
    expect(next).not.toBe(SEEDED_TICKETS);
    expect(next.some((t) => t.id === target.id)).toBe(false);
    expect(next.length).toBe(SEEDED_TICKETS.length - 1);
  });
});

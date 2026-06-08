/**
 * The tickets surface: a list of markdown work items the agent reads and edits.
 * Each ticket is a markdown doc with a status; the canvas is a plain markdown
 * editor over a selected ticket. Seeded with a believable demo set like the
 * other feature cards (apps/smithers has no gateway yet).
 *
 * Everything below the seed data is pure, so the snippet extractor, search, and
 * the create/update/delete reducers are unit-tested without a DOM (see
 * ticketsDomain.test.ts).
 */
export type TicketStatus = "todo" | "in-progress" | "done";

/** One markdown work item. `updated` is a static human string like "2d ago". */
export type Ticket = {
  id: string;
  content: string;
  status: TicketStatus;
  updated: string;
};

export const SEEDED_TICKETS: Ticket[] = [
  {
    id: "feat-issues-card",
    status: "in-progress",
    updated: "2h ago",
    content: [
      "# Issues card",
      "",
      "- owner: will",
      "- area: tickets",
      "",
      "## Summary",
      "Port the tickets view into the PWA as a seeded markdown editor.",
      "",
      "## Description",
      "Mirror the vcs feature: a card lists the first few tickets and the canvas",
      "edits the selected one.",
    ].join("\n"),
  },
  {
    id: "fix-snippet-truncation",
    status: "todo",
    updated: "1d ago",
    content: [
      "# Snippet truncation",
      "",
      "- priority: high",
      "",
      "## Summary",
      "The list snippet should clip long lines with a single ellipsis.",
      "",
      "Port the swift truncateSnippet helper faithfully.",
    ].join("\n"),
  },
  {
    id: "docs-markdown-editor",
    status: "done",
    updated: "3d ago",
    content: [
      "# Markdown editor docs",
      "",
      "---",
      "",
      "## Description",
      "Document the plain markdown-editor path. Drop the neovim machinery.",
    ].join("\n"),
  },
  {
    id: "chore-seed-tickets",
    status: "done",
    updated: "5d ago",
    content: [
      "# Seed demo tickets",
      "",
      "Write six markdown tickets with varied status and metadata lines.",
      "",
      "- effort: small",
    ].join("\n"),
  },
  {
    id: "feat-status-badges",
    status: "in-progress",
    updated: "6h ago",
    content: [
      "# Status badges",
      "",
      "- design: brand",
      "",
      "## Summary",
      "Tone the status badge by ticket status: todo info, in-progress waiting,",
      "done ok.",
    ].join("\n"),
  },
  {
    id: "feat-ticket-search",
    status: "todo",
    updated: "2d ago",
    content: [
      "# Ticket search",
      "",
      "Filter tickets by a case-insensitive substring match on id or content.",
    ].join("\n"),
  },
];

/** Clip `text` to `maxLength`, appending a single ellipsis when it overflows. */
function truncateSnippet(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, Math.max(1, maxLength - 1));
  return `${clipped}…`;
}

/** A `- key: value` line, where the key is a short label (two words or fewer). */
function metadataLine(line: string): boolean {
  if (!line.startsWith("- ")) return false;
  const rest = line.slice(2);
  const colon = rest.indexOf(":");
  if (colon === -1) return false;
  const key = rest.slice(0, colon);
  const keyFields = key.split(" ").filter((part) => part.length > 0);
  return !key.includes(" ") || keyFields.length <= 2;
}

/**
 * The list preview for a ticket. First take the line after a `## Summary` or
 * `## Description` heading; otherwise the first line that is not a heading, a
 * `---` rule, or a metadata line. Truncated to `maxLength`.
 */
export function ticketSnippet(content: string, maxLength = 92): string {
  const effectiveMax = Math.max(4, maxLength);
  const lines = content.split("\n");

  let inSummary = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const lowered = trimmed.toLowerCase();
    if (lowered === "## summary" || lowered === "## description") {
      inSummary = true;
      continue;
    }
    if (inSummary && trimmed.length > 0 && !trimmed.startsWith("#")) {
      return truncateSnippet(trimmed, effectiveMax);
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("---") ||
      metadataLine(trimmed)
    ) {
      continue;
    }
    return truncateSnippet(trimmed, effectiveMax);
  }

  return "";
}

/** Case-insensitive substring match on id or content; empty query returns all. */
export function searchTickets(tickets: Ticket[], query: string): Ticket[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return tickets;
  return tickets.filter(
    (ticket) =>
      ticket.id.toLowerCase().includes(needle) ||
      ticket.content.toLowerCase().includes(needle),
  );
}

/** The tone class that colours a status badge or dot. */
export function toneForTicketStatus(status: TicketStatus): string {
  switch (status) {
    case "todo":
      return "tone-info";
    case "in-progress":
      return "tone-waiting";
    case "done":
      return "tone-ok";
  }
}

/** Prepend a new todo ticket, returning the new list and the created ticket. */
export function createTicket(
  tickets: Ticket[],
  draft: { id: string; content: string },
): { tickets: Ticket[]; created: Ticket } {
  const created: Ticket = {
    id: draft.id,
    content: draft.content,
    status: "todo",
    updated: "just now",
  };
  return { tickets: [created, ...tickets], created };
}

/** Set one ticket's content and stamp it "just now"; immutable. */
export function updateTicket(tickets: Ticket[], id: string, content: string): Ticket[] {
  return tickets.map((ticket) =>
    ticket.id === id ? { ...ticket, content, updated: "just now" } : ticket,
  );
}

/** Drop one ticket by id; immutable. */
export function deleteTicket(tickets: Ticket[], id: string): Ticket[] {
  return tickets.filter((ticket) => ticket.id !== id);
}

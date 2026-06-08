import { describe, expect, test } from "bun:test";
import { parseTicketResponse } from "./websocketTicket";

/**
 * The fetch glue needs a server, so it is covered by integration tests; here we
 * pin the pure validation that decides whether a ticket body is usable.
 */
describe("parseTicketResponse", () => {
  test("returns the trimmed ticket", () => {
    expect(parseTicketResponse({ ticket: "  abc123  " })).toBe("abc123");
    expect(parseTicketResponse({ ticket: "tok" })).toBe("tok");
  });

  test("throws when the ticket is missing, blank, or not a string", () => {
    expect(() => parseTicketResponse(null)).toThrow();
    expect(() => parseTicketResponse({})).toThrow();
    expect(() => parseTicketResponse({ ticket: "   " })).toThrow();
    expect(() => parseTicketResponse({ ticket: 42 })).toThrow();
  });
});

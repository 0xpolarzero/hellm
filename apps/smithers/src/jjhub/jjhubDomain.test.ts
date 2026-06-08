import { describe, expect, test } from "bun:test";
import { parseLinkCursor } from "./parseLinkCursor";
import { normalizePlatformBaseUrl, platformUrl } from "./platformBaseUrl";
import { PlatformError } from "./platformJson";

/**
 * Pure domain tests for the jjhub transport seam: base-url normalization, path
 * resolution, the Link-header cursor parser, and the error shape. No window, no
 * network — the seam's testable surface (see docs/jjhub-backend-seam.md).
 */

describe("normalizePlatformBaseUrl", () => {
  test("canonicalizes a valid origin, dropping trailing slash, query, and hash", () => {
    expect(normalizePlatformBaseUrl("https://api.smithers.sh/")).toBe("https://api.smithers.sh");
    expect(normalizePlatformBaseUrl("https://api.smithers.sh/v1/?x=1#y")).toBe(
      "https://api.smithers.sh/v1",
    );
    expect(normalizePlatformBaseUrl("  http://127.0.0.1:8080  ")).toBe("http://127.0.0.1:8080");
  });

  test("rejects empty, non-http(s), and unparseable values", () => {
    expect(normalizePlatformBaseUrl("")).toBe("");
    expect(normalizePlatformBaseUrl("   ")).toBe("");
    expect(normalizePlatformBaseUrl("ftp://host")).toBe("");
    expect(normalizePlatformBaseUrl("not a url")).toBe("");
  });
});

describe("platformUrl", () => {
  test("resolves same-origin (loopback in tests) when no base is configured", () => {
    // The test env has no window/localStorage and no VITE override, so the base
    // is empty and the helper falls back to the fixed loopback origin.
    expect(platformUrl("/api/user/repos")).toBe("http://127.0.0.1:7331/api/user/repos");
    expect(platformUrl("api/user/repos")).toBe("http://127.0.0.1:7331/api/user/repos");
  });
});

describe("parseLinkCursor", () => {
  test("returns the cursor of the rel=next link", () => {
    const link = '</api/repos/o/r/landings?cursor=abc123&limit=30>; rel="next"';
    expect(parseLinkCursor(link)).toBe("abc123");
  });

  test("handles absolute next URLs and picks next out of several links", () => {
    const link =
      '<https://api.smithers.sh/x?cursor=z9>; rel="next", <https://api.smithers.sh/x>; rel="prev"';
    expect(parseLinkCursor(link)).toBe("z9");
  });

  test("returns null with no header, no next link, or a next link without a cursor", () => {
    expect(parseLinkCursor(null)).toBe(null);
    expect(parseLinkCursor('</x>; rel="prev"')).toBe(null);
    expect(parseLinkCursor('</x?limit=30>; rel="next"')).toBe(null);
    expect(parseLinkCursor("<malformed")).toBe(null);
  });

  test("tolerates unquoted rel values (RFC 8288 permits them)", () => {
    expect(parseLinkCursor("</api/x?cursor=abc>; rel=next")).toBe("abc");
    expect(parseLinkCursor("</api/x?cursor=abc>;rel=next;type=text")).toBe("abc");
    expect(
      parseLinkCursor("</api/x>; rel=prev, </api/x?cursor=def>; rel=next"),
    ).toBe("def");
    // A `rel` whose unquoted value isn't `next` still resolves to null.
    expect(parseLinkCursor("</api/x?cursor=abc>; rel=prev")).toBe(null);
  });
});

describe("PlatformError", () => {
  test("carries status and code and is an Error", () => {
    const error = new PlatformError(404, "not_found", "no such repo");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
    expect(error.message).toBe("no such repo");
  });
});

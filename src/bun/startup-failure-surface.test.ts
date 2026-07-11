import { describe, expect, it } from "bun:test";
import {
  createStartupFailurePresentation,
  normalizeStartupFailure,
  showStartupFailureSurface,
  type StartupFailurePresentation,
} from "./startup-failure-surface";

describe("startup failure surface", () => {
  it("normalizes unknown failures without exposing raw causes or stacks", () => {
    const cause = new Error('<script>send("startup-secret")</script>');
    cause.name = "SensitiveStartupFailure";
    cause.stack = "SensitiveStartupFailure: startup-secret\n    at /private/source.ts:42:3";
    cause.cause = { accessToken: "startup-secret" };

    const error = normalizeStartupFailure(cause);

    expect(error).toEqual({
      operation: "desktop.startup",
      reason: "desktop-shutdown",
      message: "The desktop runtime is unavailable. Close & reopen svvy to retry.",
    });
    expect("cause" in error).toBe(false);
    expect(JSON.stringify(error)).not.toContain("startup-secret");
    expect(JSON.stringify(error)).not.toContain("private/source.ts");
  });

  it("produces plain text and escaped inert HTML without cause content", () => {
    const presentation = createStartupFailurePresentation({
      message: '<img src=x onerror="sendSecret()">',
      stack: "at /private/startup-secret.ts:1:1",
    });

    expect(presentation.text).toBe(
      "svvy couldn't start\n\nThe desktop runtime is unavailable. Close & reopen svvy to retry.",
    );
    expect(presentation.html).toBe(
      '<main role="alert"><h1>svvy couldn&#39;t start</h1><p>The desktop runtime is unavailable. Close &amp; reopen svvy to retry.</p></main>',
    );
    expect(presentation.html).not.toContain("<img");
    expect(presentation.html).not.toContain("sendSecret");
    expect(presentation.html).not.toContain("startup-secret");
  });

  it("hands only normalized presentation data to the injected host", async () => {
    let received: StartupFailurePresentation | undefined;
    const presentation = await showStartupFailureSurface({
      cause: new Error("database password: startup-secret"),
      host: {
        async showStartupFailure(value) {
          received = value;
        },
      },
    });

    expect(received).toBe(presentation);
    expect(Object.keys(presentation).toSorted()).toEqual([
      "error",
      "html",
      "message",
      "text",
      "title",
    ]);
    expect(JSON.stringify(presentation)).not.toContain("startup-secret");
  });

  it("has no Electrobun window or RPC ownership", async () => {
    const source = await Bun.file(new URL("./startup-failure-surface.ts", import.meta.url)).text();

    expect(source).not.toContain("BrowserWindow");
    expect(source).not.toContain("Electrobun");
    expect(source).not.toContain("defineRPC");
    expect(source).not.toMatch(/\brpc\b/i);
  });
});

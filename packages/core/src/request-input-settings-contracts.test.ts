import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownRequestInputSettingsExit,
  decodeUnknownSetRequestInputBlockingTimeoutInputExit,
  decodeUnknownSetRequestInputVariantInputExit,
  encodeRequestInputSettingsExit,
} from "./request-input-settings-contracts";

describe("request-input settings contracts", () => {
  it("round-trips the exact settings shape", () => {
    const decoded = decodeUnknownRequestInputSettingsExit({
      mode: "nonblocking",
      blockingTimeout: { enabled: true, durationMs: 300000 },
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeRequestInputSettingsExit(decoded.value)).toEqual(decoded);
    }
  });

  it("strictly decodes variant settings inputs", () => {
    expect(Exit.isSuccess(decodeUnknownSetRequestInputVariantInputExit({ mode: "blocking" }))).toBe(
      true,
    );
    for (const input of [
      {},
      { mode: undefined },
      { mode: "unsupported" },
      { mode: "blocking", timeout: true },
    ]) {
      expect(Exit.isFailure(decodeUnknownSetRequestInputVariantInputExit(input))).toBe(true);
    }
  });

  it("strictly decodes blocking timeout settings inputs", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownSetRequestInputBlockingTimeoutInputExit({
          enabled: false,
          durationMs: 300000,
        }),
      ),
    ).toBe(true);

    for (const input of [
      {},
      { enabled: undefined, durationMs: 300000 },
      { enabled: true, durationMs: undefined },
      { enabled: true, durationMs: 0 },
      { enabled: true, durationMs: -1 },
      { enabled: true, durationMs: 1.5 },
      { enabled: true, durationMs: Number.POSITIVE_INFINITY },
      { enabled: true, durationMs: Number.NaN },
      { enabled: true, durationMs: 300000, extra: true },
    ]) {
      expect(Exit.isFailure(decodeUnknownSetRequestInputBlockingTimeoutInputExit(input))).toBe(
        true,
      );
    }
  });

  it("rejects incomplete or extended settings results", () => {
    for (const input of [
      { mode: "nonblocking" },
      { mode: "nonblocking", blockingTimeout: undefined },
      {
        mode: "nonblocking",
        blockingTimeout: { enabled: true, durationMs: 300000 },
        rendererOnly: true,
      },
    ]) {
      expect(Exit.isFailure(decodeUnknownRequestInputSettingsExit(input))).toBe(true);
    }
  });
});

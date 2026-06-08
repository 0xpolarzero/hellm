import { describe, expect, test } from "bun:test";
import { getToolContext, getToolIdempotencyKey, nextToolSeq, runWithToolContext } from "../src/index.js";

describe("tool-context", () => {
    test("getToolContext is undefined outside a run scope", () => {
        expect(getToolContext()).toBeUndefined();
    });

    test("runWithToolContext makes the context ambient inside fn, including across awaits", async () => {
        const ctx = { runId: "r", nodeId: "n", iteration: 0 };
        await runWithToolContext(ctx, async () => {
            expect(getToolContext()).toBe(ctx);
            await Promise.resolve();
            expect(getToolContext()).toBe(ctx);
        });
        expect(getToolContext()).toBeUndefined();
    });

    test("idempotency key derives from run/node/iteration, honors an explicit key", () => {
        expect(getToolIdempotencyKey()).toBeNull();
        expect(getToolIdempotencyKey({ runId: "r", nodeId: "n", iteration: 3 })).toBe("smithers:r:n:3");
        expect(getToolIdempotencyKey({ idempotencyKey: "custom" })).toBe("custom");
        expect(getToolIdempotencyKey({ runId: "r" })).toBeNull();
    });

    test("nextToolSeq increments the context's seq", () => {
        const ctx = {};
        expect(nextToolSeq(ctx)).toBe(1);
        expect(nextToolSeq(ctx)).toBe(2);
    });
});

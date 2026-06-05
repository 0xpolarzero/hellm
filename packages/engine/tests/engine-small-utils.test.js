import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AlertRuntime } from "../src/alert-runtime.js";
import { getDefinedToolMetadata } from "../src/getDefinedToolMetadata.js";
import {
    HUMAN_REQUEST_KINDS,
    HUMAN_REQUEST_STATUSES,
    __humanRequestInternals,
    buildHumanRequestId,
    getHumanTaskPrompt,
    isHumanRequestPastTimeout,
    isHumanTaskMeta,
    validateHumanRequestValue,
} from "../src/human-requests.js";
import { isPidAlive, parseRuntimeOwnerPid } from "../src/runtime-owner.js";
import { signalRun } from "../src/signals.js";

function makeSignalAdapter(run = { runId: "run-1" }) {
    return {
        getRun: () => Effect.succeed(run),
        insertSignalWithNextSeq: (row) => Effect.succeed(row.signalName === "event" ? 7 : 9),
        listNodes: () => Effect.succeed([]),
    };
}

describe("engine small utilities", () => {
    test("AlertRuntime stores services and has lifecycle no-ops", () => {
        const policy = { rules: {} };
        const services = { runId: "run-1" };
        const runtime = new AlertRuntime(policy, services);

        expect(runtime.policy).toBe(policy);
        expect(runtime.services).toBe(services);
        expect(runtime.start()).toBeUndefined();
        expect(runtime.stop()).toBeUndefined();
    });

    test("getDefinedToolMetadata reads only object symbol metadata", () => {
        const symbol = Symbol.for("smithers.tool.metadata");
        const metadata = { name: "read", sideEffect: false, idempotent: true };
        const tool = { [symbol]: metadata };

        expect(getDefinedToolMetadata(tool)).toBe(metadata);
        expect(getDefinedToolMetadata({})).toBe(null);
        expect(getDefinedToolMetadata(null)).toBe(null);
        expect(getDefinedToolMetadata("tool")).toBe(null);
    });

    test("runtime owner parsing and liveness handle valid, invalid and EPERM cases", () => {
        expect(parseRuntimeOwnerPid(null)).toBe(null);
        expect(parseRuntimeOwnerPid(" ")).toBe(null);
        expect(parseRuntimeOwnerPid("pid:123:abc")).toBe(123);
        expect(parseRuntimeOwnerPid("456")).toBe(456);
        expect(parseRuntimeOwnerPid("pid:0")).toBe(null);
        expect(parseRuntimeOwnerPid("nope")).toBe(null);

        expect(isPidAlive(0)).toBe(false);
        expect(isPidAlive(process.pid)).toBe(true);

        const originalKill = process.kill;
        try {
            process.kill = () => {
                const error = new Error("denied");
                error.code = "EPERM";
                throw error;
            };
            expect(isPidAlive(12345)).toBe(true);
            process.kill = () => {
                const error = new Error("missing");
                error.code = "ESRCH";
                throw error;
            };
            expect(isPidAlive(12345)).toBe(false);
        }
        finally {
            process.kill = originalKill;
        }
    });

    test("signalRun validates names and payloads, records signals and handles missing runs", async () => {
        expect(() => signalRun(makeSignalAdapter(), "run-1", "   ", {})).toThrow("Signal name must be a non-empty string");

        const circular = {};
        circular.self = circular;
        expect(() => signalRun(makeSignalAdapter(), "run-1", "event", circular)).toThrow("Signal payload must be valid JSON-serializable data");
        expect(() => signalRun(makeSignalAdapter(), "run-1", "event", () => { })).toThrow("Signal payload must be valid JSON-serializable data");

        await expect(Effect.runPromise(signalRun(makeSignalAdapter(null), "missing", "event", {}))).rejects.toThrow("Run not found: missing");

        const delivered = await Effect.runPromise(signalRun(makeSignalAdapter(), "run-1", " event ", { ok: true }, {
            correlationId: "corr-1",
            receivedBy: "tester",
            timestampMs: 123,
        }));
        expect(delivered).toEqual({
            runId: "run-1",
            seq: 7,
            signalName: "event",
            correlationId: "corr-1",
            receivedAtMs: 123,
        });
    });

    test("human request helpers and validation cover success and failure shapes", () => {
        expect(HUMAN_REQUEST_KINDS).toEqual(["ask", "confirm", "select", "json"]);
        expect(HUMAN_REQUEST_STATUSES).toEqual(["pending", "answered", "cancelled", "expired"]);
        expect(buildHumanRequestId("run", "node", 2)).toBe("human:run:node:2");
        expect(isHumanTaskMeta({ humanTask: true })).toBe(true);
        expect(isHumanTaskMeta(null)).toBe(false);
        expect(getHumanTaskPrompt({ prompt: "  hi  " }, "fallback")).toBe("  hi  ");
        expect(getHumanTaskPrompt({ prompt: " " }, "fallback")).toBe("fallback");
        expect(getHumanTaskPrompt(null, "fallback")).toBe("fallback");
        expect(isHumanRequestPastTimeout({ timeoutAtMs: 10 }, 11)).toBe(true);
        expect(isHumanRequestPastTimeout({ timeoutAtMs: 12 }, 11)).toBe(false);
        expect(isHumanRequestPastTimeout({ timeoutAtMs: Number.POSITIVE_INFINITY }, 11)).toBe(false);
        expect(isHumanRequestPastTimeout(null, 11)).toBe(false);
        expect(__humanRequestInternals.formatValidationIssues({ issues: [] })).toBe("unknown validation error");

        expect(validateHumanRequestValue({ requestId: "r1", schemaJson: null }, "anything")).toEqual({ ok: true });
        expect(validateHumanRequestValue({ requestId: "r2", schemaJson: "{" }, {})).toMatchObject({
            ok: false,
            code: "HUMAN_REQUEST_SCHEMA_INVALID",
        });
        expect(validateHumanRequestValue({ requestId: "r3", schemaJson: "[]" }, {})).toEqual({
            ok: false,
            code: "HUMAN_REQUEST_SCHEMA_INVALID",
            message: "Stored schema for r3 is not a JSON object.",
        });
        expect(validateHumanRequestValue({
            requestId: "r4",
            schemaJson: JSON.stringify({
                type: "object",
                properties: { bad: { $ref: "Nope" } },
            }),
        }, {})).toMatchObject({
            ok: false,
            code: "HUMAN_REQUEST_SCHEMA_INVALID",
        });

        const validSchema = {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string", minLength: 2 } },
        };
        expect(validateHumanRequestValue({
            requestId: "r5",
            schemaJson: JSON.stringify(validSchema),
        }, { name: "ok" })).toEqual({ ok: true });
        const invalid = validateHumanRequestValue({
            requestId: "r6",
            schemaJson: JSON.stringify(validSchema),
        }, { name: "x" });
        expect(invalid.ok).toBe(false);
        expect(invalid.message).toContain("name:");
    });
});

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { ArtifactMetadataRecordSchema } from "./artifact-contracts";
import { AppLogWritePort } from "./app-log-contracts";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { ExtensionHandlerResultSchema } from "./extension-contracts";
import { ExtensionStatePort } from "./extension-state-ports";
import { RuntimeEffectRequestSchema } from "./runtime-effect-requests";
import { SourceReconcileRequestSchema } from "./runtime-source-invalidation";
import {
  RunTaskAgentInputSchema,
  RunTaskAgentSourceInputSchema,
} from "./workflow-task-agent-bridge-contracts";

describe("@svvy/core public contract modules", () => {
  it("exposes target module names for split contract groups", () => {
    expect(ArtifactMetadataRecordSchema.ast).toBeDefined();
    expect(ExtensionHandlerResultSchema.ast).toBeDefined();
    expect(RuntimeEffectRequestSchema.ast).toBeDefined();
    expect(SourceReconcileRequestSchema.ast).toBeDefined();
    expect(RunTaskAgentSourceInputSchema.ast).toBeDefined();
    expect(RunTaskAgentInputSchema.ast).toBeDefined();
  });

  it("keeps app-log, parse-option, and extension-state contracts in their target modules", () => {
    expect(AppLogWritePort.key).toBe("@svvy/core/AppLogWritePort");
    expect(strictBoundaryParseOptions).toEqual({
      errors: "all",
      onExcessProperty: "error",
    });
    expect(ExtensionStatePort.key).toBe("@svvy/core/ExtensionStatePort");
    expect(existsSync(join(import.meta.dir, "app-log-ports.ts"))).toBe(false);
  });

  it("keeps strict schema boundary behavior exact and fail-closed", () => {
    const BoundaryInputSchema = Schema.Struct({
      name: Schema.String,
      description: Schema.optionalKey(Schema.String),
    });
    const decodeBoundaryInput = Schema.decodeUnknownSync(
      BoundaryInputSchema,
      strictBoundaryParseOptions,
    );

    expect(decodeBoundaryInput({ name: "default extension" })).toEqual({
      name: "default extension",
    });
    expect(() =>
      decodeBoundaryInput({ name: "default extension", description: undefined }),
    ).toThrow();
    expect(() =>
      decodeBoundaryInput({ name: "default extension", rendererPanelId: "panel_01" }),
    ).toThrow();

    const SecretSchema = Schema.toCodecJson(
      Schema.Redacted(Schema.String, {
        label: "provider-api-key",
        disallowJsonEncode: true,
      }),
    );
    expect(() =>
      Schema.encodeSync(SecretSchema)(Redacted.make("sk-secret", { label: "provider-api-key" })),
    ).toThrow("Cannot serialize Redacted");
  });
});

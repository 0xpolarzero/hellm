import { describe, expect, test } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownAddExtensionInstructionInputExit,
  decodeUnknownConfigureExtensionInstructionResultExit,
  decodeUnknownCreateExtensionSourceInputExit,
  decodeUnknownCreateExtensionSourceResultExit,
  decodeUnknownDuplicateExtensionSourceInputExit,
  decodeUnknownResetExtensionInstructionsInputExit,
  decodeUnknownRuntimeResetExtensionInstructionsResultExit,
  decodeUnknownRenameExtensionInstructionInputExit,
  decodeUnknownReorderExtensionInstructionsInputExit,
  decodeUnknownRevertExtensionSourceMutationInputExit,
  encodeCreateExtensionSourceResultExit,
} from "./extension-source-lifecycle-contracts";

const mutationId = `extension-source-mutation:fixture:${"a".repeat(64)}`;
const attemptId = `extension-build-attempt:fixture:${"b".repeat(64)}`;

describe("extension source lifecycle contracts", () => {
  test("accepts strict instruction and svvyx creation inputs", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownCreateExtensionSourceInputExit({
          id: "fixture",
          title: "Fixture",
          description: "Fixture instructions.",
          interfaceKind: "instructions",
          typescriptApiEnabled: false,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownCreateExtensionSourceInputExit({
          id: "fixture-svvyx",
          title: "Fixture svvyx",
          description: "Fixture commands.",
          interfaceKind: "svvyx",
          typescriptApiEnabled: true,
        }),
      ),
    ).toBe(true);
  });

  test("rejects native tools, invalid ids, whitespace, and excess creation authority", () => {
    const base = {
      id: "fixture",
      title: "Fixture",
      description: "Fixture instructions.",
      interfaceKind: "instructions",
      typescriptApiEnabled: false,
    } as const;
    expect(
      Exit.isFailure(
        decodeUnknownCreateExtensionSourceInputExit({
          ...base,
          interfaceKind: "native_tool",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownCreateExtensionSourceInputExit({
          ...base,
          typescriptApiEnabled: true,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(decodeUnknownCreateExtensionSourceInputExit({ ...base, id: "extensions" })),
    ).toBe(true);
    expect(
      Exit.isFailure(decodeUnknownCreateExtensionSourceInputExit({ ...base, id: "Fixture" })),
    ).toBe(true);
    expect(
      Exit.isFailure(decodeUnknownCreateExtensionSourceInputExit({ ...base, title: " Fixture" })),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownCreateExtensionSourceInputExit({ ...base, workspaceId: "workspace-01" }),
      ),
    ).toBe(true);
  });

  test("keeps duplicate targets strict and source identity explicit", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownDuplicateExtensionSourceInputExit({
          sourceExtensionId: "base-handler",
          targetExtensionId: "my-handler",
          title: "My handler",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownDuplicateExtensionSourceInputExit({
          sourceExtensionId: "base-handler",
          targetExtensionId: "extensions",
          title: "Reserved",
        }),
      ),
    ).toBe(true);
  });

  test("accepts editable MDX basenames but rejects paths, Markdown outputs, and traversal", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownAddExtensionInstructionInputExit({
          extensionId: "fixture",
          name: "guide.mdx",
        }),
      ),
    ).toBe(true);
    for (const name of [
      "010-guide.md",
      "guide.generated.md",
      "instructions/guide.mdx",
      "../guide.mdx",
      "guide.txt",
      ".hidden.mdx",
    ]) {
      expect(
        Exit.isFailure(
          decodeUnknownAddExtensionInstructionInputExit({ extensionId: "fixture", name }),
        ),
      ).toBe(true);
    }
  });

  test("requires the exact reset scope", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownResetExtensionInstructionsInputExit({
          extensionId: "base-handler",
          scope: "instructions",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownResetExtensionInstructionsInputExit({
          extensionId: "base-handler",
          scope: "all",
        }),
      ),
    ).toBe(true);
  });

  test("strictly decodes rename, reorder, and journal revert requests", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownRenameExtensionInstructionInputExit({
          extensionId: "fixture",
          from: "010-old.mdx",
          to: "010-new.mdx",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownReorderExtensionInstructionsInputExit({
          extensionId: "fixture",
          order: ["020-two.mdx", "010-one.mdx"],
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(decodeUnknownRevertExtensionSourceMutationInputExit({ mutationId })),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownRenameExtensionInstructionInputExit({
          extensionId: "fixture",
          from: "old.md",
          to: "new.md",
        }),
      ),
    ).toBe(true);
  });

  test("round-trips exact mutation receipts", () => {
    const decoded = decodeUnknownCreateExtensionSourceResultExit({
      action: "created",
      mutationId,
      extensionId: "fixture",
      changed: true,
    });
    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isFailure(decoded)) return;
    expect(Exit.isSuccess(encodeCreateExtensionSourceResultExit(decoded.value))).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownCreateExtensionSourceResultExit({
          ...decoded.value,
          sourceRoot: "/extensions/sources/user/fixture",
        }),
      ),
    ).toBe(true);
  });

  test("couples no-op mutation ids to changed state", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownConfigureExtensionInstructionResultExit({
          action: "instruction-configured",
          mutationId: null,
          extensionId: "fixture",
          name: "guide.mdx",
          bypassed: true,
          changed: false,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownConfigureExtensionInstructionResultExit({
          action: "instruction-configured",
          mutationId,
          extensionId: "fixture",
          name: "guide.mdx",
          bypassed: true,
          changed: false,
        }),
      ),
    ).toBe(true);
  });

  test("runs an automatic build exactly when reset changes source", () => {
    const changedSource = {
      action: "reset",
      mutationId,
      extensionId: "fixture",
      scope: "instructions",
      changed: true,
    } as const;
    expect(
      Exit.isSuccess(
        decodeUnknownRuntimeResetExtensionInstructionsResultExit({
          source: changedSource,
          automaticBuild: { status: "succeeded", attemptId },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownRuntimeResetExtensionInstructionsResultExit({
          source: changedSource,
          automaticBuild: {
            status: "not-started",
            failureReason: "stale-state",
          },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownRuntimeResetExtensionInstructionsResultExit({
          source: changedSource,
          automaticBuild: {
            status: "failed",
            attemptId,
            failureReason: "process-failed",
          },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownRuntimeResetExtensionInstructionsResultExit({
          source: changedSource,
          automaticBuild: { status: "skipped", reason: "source-unchanged" },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownRuntimeResetExtensionInstructionsResultExit({
          source: { ...changedSource, mutationId: null, changed: false },
          automaticBuild: { status: "succeeded", attemptId },
        }),
      ),
    ).toBe(true);
  });
});

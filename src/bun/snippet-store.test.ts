import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSnippetStore } from "./snippet-store";

describe("managed snippet store", () => {
  it("persists svvy-owned snippets across store instances", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-managed-snippets-"));
    try {
      const firstStore = createSnippetStore({ agentDir: root });
      const created = firstStore.createManaged({
        title: " Review ",
        body: "Review $1",
        description: " Reusable review prompt ",
        argumentHint: " file path ",
      });

      expect(created.source).toBe("svvy");
      expect(created.readOnly).toBe(false);
      expect(created.enabled).toBe(true);
      expect(created.title).toBe("Review");
      expect(created.metadata).toEqual({
        description: "Reusable review prompt",
        argumentHint: "file path",
      });

      const secondStore = createSnippetStore({ agentDir: root });
      expect(secondStore.listManaged()).toEqual([created]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists snippet enablement for managed and external snippets", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-managed-snippets-"));
    try {
      const firstStore = createSnippetStore({ agentDir: root });
      const created = firstStore.createManaged({
        title: "Review",
        body: "Review $1",
      });

      firstStore.setEnabled({ snippetId: created.id, enabled: false });
      firstStore.setEnabled({ snippetId: "claude:user:/tmp/review.md", enabled: false });

      const secondStore = createSnippetStore({ agentDir: root });
      expect(secondStore.listManaged()).toEqual([{ ...created, enabled: false }]);
      expect(secondStore.listDisabledSnippetIds().toSorted()).toEqual(
        ["claude:user:/tmp/review.md", created.id].toSorted(),
      );

      secondStore.setEnabled({ snippetId: created.id, enabled: true });
      expect(secondStore.listManaged()).toEqual([created]);
      expect(secondStore.listDisabledSnippetIds()).toEqual(["claude:user:/tmp/review.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("updates, renames, clears metadata, and deletes only managed snippets", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-managed-snippets-"));
    try {
      const store = createSnippetStore({ agentDir: root });
      const created = store.createManaged({
        title: "Draft",
        body: "Initial $ARGUMENTS",
        description: "Draft prompt",
      });

      const updated = store.updateManaged({
        snippetId: created.id,
        title: "Final",
        body: "Final $@",
        description: null,
        argumentHint: "targets",
      });

      expect(updated).toMatchObject({
        id: created.id,
        source: "svvy",
        title: "Final",
        body: "Final $@",
        metadata: {
          description: null,
          argumentHint: "targets",
        },
        readOnly: false,
      });

      expect(() => store.updateManaged({ snippetId: "claude:user:/tmp/review.md" })).toThrow(
        "Managed snippet not found.",
      );
      expect(() => store.deleteManaged({ snippetId: "pi:user:/tmp/prompt.md" })).toThrow(
        "Managed snippet not found.",
      );

      store.deleteManaged({ snippetId: created.id });
      expect(store.listManaged()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects empty managed snippet titles", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-managed-snippets-"));
    try {
      const store = createSnippetStore({ agentDir: root });
      expect(() => store.createManaged({ title: " ", body: "Body" })).toThrow(
        "Managed snippet title is required.",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { STORE_WORKFLOWS } from "../store/workflows";
import { APPS, activeAppId, appsForWorkflow, getApp, workflowsForApp } from "./appCatalog";

describe("app catalog", () => {
  test("every attached workflow id resolves to a real catalog workflow", () => {
    const known = new Set(STORE_WORKFLOWS.map((workflow) => workflow.id));
    for (const app of APPS) {
      for (const workflowId of app.workflowIds) {
        expect(known.has(workflowId), `${app.id} references unknown workflow ${workflowId}`).toBe(
          true,
        );
      }
    }
  });

  test("app ids are unique", () => {
    const ids = APPS.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("appsForWorkflow is the exact inverse of App.workflowIds", () => {
    for (const app of APPS) {
      for (const workflowId of app.workflowIds) {
        const apps = appsForWorkflow(workflowId).map((found) => found.id);
        expect(apps).toContain(app.id);
      }
    }
  });

  test("the relationship is genuinely many-to-many", () => {
    // review is attached to more than one app, proving a workflow spans apps.
    const reviewApps = appsForWorkflow("review").map((app) => app.id);
    expect(reviewApps.length).toBeGreaterThan(1);
    expect(reviewApps).toContain("git");

    // git launches more than one workflow, proving an app spans workflows.
    expect(workflowsForApp("git").length).toBeGreaterThan(1);
  });

  test("workflowsForApp returns resolved catalog entries", () => {
    const workflows = workflowsForApp("git");
    expect(workflows.length).toBe(getApp("git")!.workflowIds.length);
    for (const workflow of workflows) {
      expect(typeof workflow.name).toBe("string");
    }
  });

  test("getApp resolves known ids and rejects unknown ones", () => {
    expect(getApp("git")?.name).toBe("Git");
    // @ts-expect-error unknown id is not an AppId
    expect(getApp("nope")).toBeUndefined();
  });

  describe("activeAppId", () => {
    test("maps a domain surface to its app", () => {
      expect(activeAppId({ view: "home", surface: { kind: "vcs" } })).toBe("git");
      expect(activeAppId({ view: "home", surface: { kind: "issues" } })).toBe("issues");
    });

    test("maps the store view to the store app", () => {
      expect(activeAppId({ view: "store", surface: null })).toBe("store");
    });

    test("returns null for non-app routes", () => {
      expect(activeAppId({ view: "home", surface: null })).toBeNull();
      expect(activeAppId({ view: "askme", surface: null })).toBeNull();
    });

    test("returns null for transient run surfaces", () => {
      expect(activeAppId({ view: "home", surface: { kind: "inspector", runId: "1" } })).toBeNull();
      expect(
        activeAppId({ view: "home", surface: { kind: "diff", runId: "1", diffId: "d" } }),
      ).toBeNull();
    });
  });
});

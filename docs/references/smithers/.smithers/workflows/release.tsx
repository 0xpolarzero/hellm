// smithers-source: seeded
// smithers-display-name: Release
/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Sequence } from "smithers-orchestrator";
import { z } from "zod/v4";

const inputSchema = z.object({
  bump: z
    .enum(["patch", "minor", "major"])
    .default("patch")
    .describe("Version bump type. major requires explicit approval (pre-1.0 policy)."),
  runPublish: z
    .boolean()
    .default(false)
    .describe("Run `pnpm release` after bumping. Default false — bump only, then publish manually."),
  skipChecks: z
    .boolean()
    .default(false)
    .describe("Forward --skip-checks to `pnpm release` (skip lint/typecheck/test)."),
});

const probeSchema = z.object({
  currentVersion: z.string(),
  nextVersion: z.string(),
  bump: z.enum(["patch", "minor", "major"]),
  changelogPath: z.string(),
});

const changelogSchema = z.object({
  changelogPath: z.string(),
  ok: z.boolean(),
});

const bumpResultSchema = z.object({
  newVersion: z.string(),
});

const publishResultSchema = z.object({
  published: z.boolean(),
  message: z.string(),
});

const majorApprovalSchema = z.object({
  approved: z.boolean(),
  note: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
});

const { Workflow, Task, Approval, smithers, outputs } = createSmithers({
  input: inputSchema,
  probe: probeSchema,
  changelog: changelogSchema,
  majorApproval: majorApprovalSchema,
  bumpResult: bumpResultSchema,
  publishResult: publishResultSchema,
});

export default smithers((ctx) => {
  const isMajor = ctx.input.bump === "major";

  return (
    <Workflow name="release">
      <Sequence>
        <Task id="probe" output={outputs.probe}>
          {async () => {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const root = process.cwd();
            const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
              version: string;
            };
            const parts = pkg.version.split(".").map((s) => Number(s));
            if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
              throw new Error(`Cannot parse version "${pkg.version}" — expected MAJOR.MINOR.PATCH`);
            }
            let [maj, min, pat] = parts as [number, number, number];
            if (ctx.input.bump === "major") {
              maj += 1;
              min = 0;
              pat = 0;
            } else if (ctx.input.bump === "minor") {
              min += 1;
              pat = 0;
            } else {
              pat += 1;
            }
            const next = `${maj}.${min}.${pat}`;
            return {
              currentVersion: pkg.version,
              nextVersion: next,
              bump: ctx.input.bump,
              changelogPath: `docs/changelogs/${next}.mdx`,
            };
          }}
        </Task>

        <Task id="changelog-check" output={outputs.changelog}>
          {async () => {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const probe = ctx.outputMaybe(outputs.probe, { nodeId: "probe" });
            if (!probe) throw new Error("probe did not complete");
            const abs = path.resolve(process.cwd(), probe.changelogPath);
            if (!fs.existsSync(abs)) {
              throw new Error(
                `Missing changelog at ${probe.changelogPath}.\n` +
                  `Write the changelog for v${probe.nextVersion} before releasing, then re-run.`,
              );
            }
            return { changelogPath: probe.changelogPath, ok: true };
          }}
        </Task>

        {isMajor ? (
          <Approval
            id="major-approval"
            output={outputs.majorApproval}
            request={{
              title: `Approve MAJOR version bump`,
              summary:
                "Pre-1.0 policy: major releases require explicit human approval. Approving will run `pnpm version major`.",
            }}
            onDeny="fail"
          />
        ) : null}

        <Task id="bump" output={outputs.bumpResult}>
          {async () => {
            const { execSync } = await import("node:child_process");
            const fs = await import("node:fs");
            const path = await import("node:path");
            const probe = ctx.outputMaybe(outputs.probe, { nodeId: "probe" });
            if (!probe) throw new Error("probe did not complete");
            execSync(`pnpm version ${probe.bump}`, { cwd: process.cwd(), stdio: "inherit" });
            const pkg = JSON.parse(
              fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
            ) as { version: string };
            return { newVersion: pkg.version };
          }}
        </Task>

        <Task id="publish" output={outputs.publishResult}>
          {async () => {
            const bump = ctx.outputMaybe(outputs.bumpResult, { nodeId: "bump" });
            const newVersion = bump?.newVersion ?? "?";
            if (!ctx.input.runPublish) {
              return {
                published: false,
                message:
                  `Bumped to v${newVersion}. Skipped publish (runPublish=false). ` +
                  `Run \`pnpm release\` manually when ready.`,
              };
            }
            const { execSync } = await import("node:child_process");
            const flags = ctx.input.skipChecks ? " -- --skip-checks" : "";
            execSync(`pnpm release${flags}`, { cwd: process.cwd(), stdio: "inherit" });
            return { published: true, message: `Published v${newVersion} via pnpm release.` };
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

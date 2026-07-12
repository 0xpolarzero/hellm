import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const harnessSource = readFileSync(join(import.meta.dir, "..", "..", "e2e", "harness.ts"), "utf8");

describe("e2e harness launch isolation", () => {
  test("rebuilds the OrbStack app when extracted package sources change", async () => {
    const configSource = await Bun.file(`${import.meta.dir}/../../electrobun-e2e.config.ts`).text();

    expect(configSource).toContain('"packages"');
    expect(configSource).toContain('"bun.lock"');
  });

  test("keeps prepared-home state across transient metadata retries", () => {
    const launchStart = harnessSource.indexOf("export async function launchSvvyApp");
    const launchEnd = harnessSource.indexOf("function adoptReadyDriver", launchStart);
    const launchSource = harnessSource.slice(launchStart, launchEnd);
    const optionsCreation = launchSource.indexOf("const launchOptions = createLaunchOptions");
    const retryStart = launchSource.indexOf("return await withLocalLaunchRetries");

    expect(launchStart).toBeGreaterThanOrEqual(0);
    expect(launchEnd).toBeGreaterThan(launchStart);
    expect(optionsCreation).toBeGreaterThanOrEqual(0);
    expect(optionsCreation).toBeLessThan(retryStart);
    expect(launchSource).toContain("launchElectrobunApp(launchOptions)");
    expect(harnessSource).toContain("const preparedHomeDirs = new Set<string>();");
    expect(harnessSource).toContain("await restorePreparedHomeDir(context.homeDir);");
  });
});

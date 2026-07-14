import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("the pinned browser driver selects a single native option before emitting change", async () => {
  const entrypoint = import.meta.resolve("electrobun-browser-tools");
  const driverSource = await readFile(new URL("./chunk-VKPXYR7I.js", entrypoint), "utf8");

  expect(driverSource).toContain("element.value = selectedOption.value");
  expect(driverSource).toContain("emit(element, 'change', Event)");
});

test("the pinned browser driver scrolls pointer targets before checking actionability", async () => {
  const entrypoint = import.meta.resolve("electrobun-browser-tools");
  const driverSource = await readFile(new URL("./chunk-VKPXYR7I.js", entrypoint), "utf8");

  expect(driverSource).toContain("element.scrollIntoView({ block: 'nearest', inline: 'nearest' })");
  expect(driverSource.indexOf("element.scrollIntoView")).toBeLessThan(
    driverSource.indexOf("const blocker = resolveOcclusion(element)"),
  );
});

test("the pinned browser driver waits for late bridge events until the requested deadline", async () => {
  const entrypoint = import.meta.resolve("electrobun-browser-tools");
  const driverSource = await readFile(new URL("./chunk-VKPXYR7I.js", entrypoint), "utf8");

  expect(driverSource).toContain('case "events.wait"');
  expect(driverSource).toContain("const deadline = Date.now() + timeoutMs");
  expect(driverSource).toContain("if (data.matched || Date.now() >= deadline)");
  expect(driverSource).toContain("await sleep3(Math.min(50, deadline - Date.now()))");
});

test("the pinned browser driver reports target and blocker details for occluded actions", async () => {
  const entrypoint = import.meta.resolve("electrobun-browser-tools");
  const driverSource = await readFile(new URL("./chunk-VKPXYR7I.js", entrypoint), "utf8");

  expect(driverSource).toContain("Target: ${target}. Blocker: ${blocker}.");
  expect(driverSource).toContain("testId: result.blocker.testId");
  expect(driverSource).toContain("rect: result.element.rect");
});

test("the pinned browser bridge can trust an injected primary runtime for macOS screenshots", async () => {
  const entrypoint = import.meta.resolve("electrobun-browser-tools");
  const driverSource = await readFile(new URL("./chunk-VKPXYR7I.js", entrypoint), "utf8");
  const declarations = await readFile(new URL("./bridge-gQKFAW83.d.ts", entrypoint), "utf8");

  expect(declarations).toContain("trustedRuntime?: boolean");
  expect(driverSource).toContain(
    "electrobunScreenshotAvailability(runtime, options.trustedRuntime)",
  );
  expect(driverSource).toContain('runtime.source !== "runtime" && !trustedRuntime');
});

test("the pinned browser bridge activates native windows without the deprecated focus API", async () => {
  const entrypoint = import.meta.resolve("electrobun-browser-tools");
  const driverSource = await readFile(new URL("./chunk-VKPXYR7I.js", entrypoint), "utf8");

  expect(driverSource).toContain("window.activate?.bind(window)");
  expect(driverSource).not.toContain("window.focus?.bind(window)");
});

test("the pinned browser tools expose graceful app quit to drivers and the CLI", async () => {
  const entrypoint = import.meta.resolve("electrobun-browser-tools");
  const driverSource = await readFile(new URL("./index.js", entrypoint), "utf8");
  const declarations = await readFile(new URL("./index.d.ts", entrypoint), "utf8");
  const bridgeSource = await readFile(new URL("./chunk-VKPXYR7I.js", entrypoint), "utf8");
  const cliSource = await readFile(new URL("./chunk-JG5G6UCY.js", entrypoint), "utf8");

  expect(driverSource).toContain('this.client.invoke("app.quit")');
  expect(declarations).toContain("requestQuit(): Promise<AppQuitReceipt>");
  expect(bridgeSource).toContain('case "app.quit"');
  expect(bridgeSource).toContain('eventName: "app.quit.requested"');
  expect(bridgeSource).toContain("return createJsonResponse(appQuitReceipt)");
  expect(cliSource).toContain('appCli.command("quit"');
  expect(cliSource).toContain('bridge.invoke("app.quit")');
});

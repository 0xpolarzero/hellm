import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPackagedSandboxHostSupportServices,
  type PackagedSandboxHostSupportServices,
} from "./runtime-service-adapter";

export function createTestSandboxHostSupport(): PackagedSandboxHostSupportServices {
  return createPackagedSandboxHostSupportServices({
    executablePath: join(tmpdir(), "svvy-test-app", "svvy"),
    appSupportRoot: join(tmpdir(), "svvy-test-app-support"),
    tempRoot: tmpdir(),
    platform: "darwin",
    arch: "arm64",
    readFileString: () =>
      JSON.stringify({
        schemaVersion: 1,
        artifact: "svvy-sandbox-helper",
        platform: "darwin",
        arch: "arm64",
        digest: { algorithm: "sha256", hex: "a".repeat(64) },
      }),
  });
}

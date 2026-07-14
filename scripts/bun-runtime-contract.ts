export const APP_BUN_RUNTIME = {
  releaseTag: "canary",
  minimumVersion: "1.4.0",
  requiredFixCommit: "9e6a19ba2e3c43f0782c9c9fa24a608f9824bb06",
} as const;

export function assertAppBunRuntimeVersion(version: string): void {
  const actual = parseVersion(version);
  const minimum = parseVersion(APP_BUN_RUNTIME.minimumVersion);
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index]! > minimum[index]!) return;
    if (actual[index]! < minimum[index]!) {
      throw new Error(
        `Bun ${version} predates the app runtime minimum ${APP_BUN_RUNTIME.minimumVersion}, ` +
          `which carries required threadsafe FFI fix ${APP_BUN_RUNTIME.requiredFixCommit}.`,
      );
    }
  }
}

function parseVersion(version: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`Could not parse Bun version ${JSON.stringify(version)}.`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

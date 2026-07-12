import * as Effect from "effect/Effect";
import {
  ExtensionError,
  decodeUnknownExtensionCliRequirementProbeEvidenceEffect,
  decodeUnknownRefreshExtensionCliRequirementReadinessInputEffect,
  type ExtensionCliDeclaration,
  type ExtensionCliRequirementProbeEvidence,
  type ExtensionCliRequirementProbePlan,
  type ExtensionCliRequirementReadinessEvidence,
  type RefreshExtensionCliRequirementReadinessInput,
  type RefreshExtensionCliRequirementReadinessResult,
} from "@svvy/core";
import {
  ExtensionCliRequirementProbePort,
  type ExtensionCliRequirementProbePortService,
} from "./extension-cli-requirement-probe-port";

const operation = "extensions.dependencies.refreshReadiness";
const packageRunnerBinaries = new Set(["bunx", "npx", "pnpx"]);
const versionPattern = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/;

export function refreshExtensionCliRequirementReadiness(
  input: RefreshExtensionCliRequirementReadinessInput,
): Effect.Effect<
  RefreshExtensionCliRequirementReadinessResult,
  ExtensionError,
  ExtensionCliRequirementProbePort
> {
  return Effect.gen(function* () {
    const decoded = yield* decodeUnknownRefreshExtensionCliRequirementReadinessInputEffect(
      input,
    ).pipe(Effect.mapError((cause) => contractError("Invalid CLI readiness input.", cause)));
    const probePort = yield* ExtensionCliRequirementProbePort;
    const readiness = yield* Effect.forEach(
      decoded.registryObservation.observations,
      (extension) =>
        Effect.forEach(extension.cliDeclarations, (declaration) =>
          probeDeclaration(extension.extensionId, declaration, probePort),
        ),
      { concurrency: 1 },
    );
    return {
      registryAggregateFingerprint: decoded.registryObservation.aggregateFingerprint,
      readiness: readiness.flat(),
    };
  });
}

function probeDeclaration(
  extensionId: RefreshExtensionCliRequirementReadinessInput["registryObservation"]["observations"][number]["extensionId"],
  declaration: ExtensionCliDeclaration,
  probePort: ExtensionCliRequirementProbePortService,
): Effect.Effect<ExtensionCliRequirementReadinessEvidence, ExtensionError> {
  return Effect.gen(function* () {
    const plan = yield* Effect.try({
      try: () => planForDeclaration(extensionId, declaration),
      catch: (cause) =>
        cause instanceof ExtensionError
          ? cause
          : contractError("CLI probe plan construction failed.", cause),
    });
    const evidence = yield* probePort.probe(plan).pipe(
      Effect.flatMap((value) =>
        decodeUnknownExtensionCliRequirementProbeEvidenceEffect(value).pipe(
          Effect.mapError((cause) => contractError("CLI probe returned invalid evidence.", cause)),
        ),
      ),
      Effect.catch(() => Effect.succeed({ status: "failed" as const })),
    );
    return readinessFromEvidence(extensionId, declaration, plan, evidence);
  });
}

export function planForDeclaration(
  extensionId: RefreshExtensionCliRequirementReadinessInput["registryObservation"]["observations"][number]["extensionId"],
  declaration: ExtensionCliDeclaration,
): ExtensionCliRequirementProbePlan {
  const versionWords = declaration.versionCommand
    ? parseDirectCommand(declaration.versionCommand, declaration.id)
    : null;
  const packageRunner =
    packageRunnerBinaries.has(declaration.binary) ||
    ((declaration.binary === "pnpm" || declaration.binary === "yarn") &&
      versionWords?.[1] === "dlx");
  const probeKind = !versionWords || packageRunner ? "resolve-executable" : "execute-version";
  if (versionWords && !packageRunner && versionWords[0] !== declaration.binary) {
    throw contractError(`CLI version command must execute the declared binary: ${declaration.id}`);
  }
  return {
    extensionId,
    requirementId: declaration.id,
    requirementFingerprint: declaration.requirementFingerprint,
    probeKind,
    executable: declaration.binary,
    argv: probeKind === "execute-version" ? versionWords!.slice(1) : [],
    env: {},
    extendEnv: false,
    timeoutMs: 1_000,
    maxStdoutBytes: 16_384,
    maxStderrBytes: 16_384,
  };
}

function readinessFromEvidence(
  extensionId: ExtensionCliRequirementProbePlan["extensionId"],
  declaration: ExtensionCliDeclaration,
  plan: ExtensionCliRequirementProbePlan,
  evidence: ExtensionCliRequirementProbeEvidence,
): ExtensionCliRequirementReadinessEvidence {
  const base = {
    extensionId,
    requirementId: declaration.id,
    requirementFingerprint: declaration.requirementFingerprint,
    expectedVersion: declaration.defaultVersion,
  };
  if (evidence.status === "missing") {
    return { ...base, status: "missing", detectedVersion: null, diagnostics: ["CLI_MISSING"] };
  }
  if (plan.probeKind === "resolve-executable") {
    return evidence.status === "resolved"
      ? { ...base, status: "available", detectedVersion: null, diagnostics: [] }
      : { ...base, status: "unknown", detectedVersion: null, diagnostics: ["CLI_STATUS_UNKNOWN"] };
  }
  if (
    evidence.status !== "completed" ||
    evidence.exitCode !== 0 ||
    evidence.stdoutTruncated ||
    evidence.stderrTruncated
  ) {
    return {
      ...base,
      status: "unknown",
      detectedVersion: null,
      diagnostics: ["CLI_STATUS_UNKNOWN"],
    };
  }
  const detectedVersion =
    `${evidence.stdout}\n${evidence.stderr}`.match(versionPattern)?.[1] ?? null;
  if (!detectedVersion) {
    return {
      ...base,
      status: "unknown",
      detectedVersion: null,
      diagnostics: ["CLI_STATUS_UNKNOWN"],
    };
  }
  if (!declaration.defaultVersion) {
    return { ...base, status: "available", detectedVersion, diagnostics: [] };
  }
  if (detectedVersion === declaration.defaultVersion) {
    return { ...base, status: "ready", detectedVersion, diagnostics: [] };
  }
  if (declaration.installCommand) {
    return {
      ...base,
      status: "update-available",
      detectedVersion,
      diagnostics: ["CLI_UPDATE_AVAILABLE"],
    };
  }
  return {
    ...base,
    status: "version-mismatch",
    detectedVersion,
    diagnostics: ["CLI_VERSION_MISMATCH"],
  };
}

function parseDirectCommand(command: string, requirementId: string): string[] {
  if (/[|&;<>()`$\r\n]/.test(command)) {
    throw contractError(`CLI version command contains shell control syntax: ${requirementId}`);
  }
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of command.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) words.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped || quote) throw contractError(`CLI version command is malformed: ${requirementId}`);
  if (current) words.push(current);
  if (words.length === 0) throw contractError(`CLI version command is empty: ${requirementId}`);
  return words;
}

function contractError(message: string, cause?: unknown): ExtensionError {
  return new ExtensionError({ operation, reason: "invalid-input", message, cause });
}

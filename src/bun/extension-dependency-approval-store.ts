import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ExtensionDependencyApprovalIdentity = {
  kind: "dependency" | "trusted_dependency";
  packageManager: "bun";
  source: "npm";
  name: string;
  version: string;
  integrity: string | null;
  resolution: string | null;
};

export type ExtensionDependencyApprovalRequest = {
  requestId: string;
  status: "pending" | "approved" | "rejected" | "obsolete";
  extensionIds: string[];
  identities: ExtensionDependencyApprovalIdentity[];
  identityKeys: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ExtensionDependencyBlockedOperation = {
  operationId: string;
  requestId: string;
  status: "pending" | "resumed" | "rejected" | "obsolete";
  blockedOperation: "build" | "snapshot_load";
  extensionIds: string[];
  snapshotId: string | null;
  resumeFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type ExtensionDependencyApprovalRecord = {
  identity: ExtensionDependencyApprovalIdentity;
  identityKey: string;
  approvedAt: string;
  requestId: string | null;
};

type ExtensionDependencyApprovalLedger = {
  schemaVersion: 1;
  approvals: ExtensionDependencyApprovalRecord[];
  blockedOperations: ExtensionDependencyBlockedOperation[];
  requests: ExtensionDependencyApprovalRequest[];
};

export class ExtensionDependencyApprovalStore {
  readonly path: string;
  private readonly now: () => Date;
  private readonly createRequestId: () => string;

  constructor(options: {
    extensionsRoot: string;
    path?: string;
    now?: () => Date;
    createRequestId?: () => string;
  }) {
    this.path =
      options.path ?? join(resolve(options.extensionsRoot), "state", "dependency-approvals.json");
    this.now = options.now ?? (() => new Date());
    this.createRequestId = options.createRequestId ?? (() => `depapr_${randomUUID()}`);
  }

  hasApproved(identity: ExtensionDependencyApprovalIdentity): boolean {
    const key = extensionDependencyApprovalIdentityKey(identity);
    return this.read().approvals.some((approval) => approval.identityKey === key);
  }

  findPendingRequestForIdentity(
    identity: ExtensionDependencyApprovalIdentity,
  ): ExtensionDependencyApprovalRequest | null {
    const key = extensionDependencyApprovalIdentityKey(identity);
    return (
      this.read().requests.find(
        (request) => request.status === "pending" && request.identityKeys.includes(key),
      ) ?? null
    );
  }

  obsoletePendingRequestsForExtension(input: {
    extensionId: string;
    activeIdentities: readonly ExtensionDependencyApprovalIdentity[];
  }): void {
    const activeKeys = new Set(input.activeIdentities.map(extensionDependencyApprovalIdentityKey));
    const ledger = this.read();
    let changed = false;
    const now = this.nowIso();
    for (const request of ledger.requests) {
      if (request.status !== "pending" || !request.extensionIds.includes(input.extensionId)) {
        continue;
      }
      if (sameStringSet(request.identityKeys, [...activeKeys])) {
        continue;
      }
      request.extensionIds = request.extensionIds.filter(
        (extensionId) => extensionId !== input.extensionId,
      );
      for (const operation of ledger.blockedOperations) {
        if (operation.requestId !== request.requestId || operation.status !== "pending") {
          continue;
        }
        operation.extensionIds = operation.extensionIds.filter(
          (extensionId) => extensionId !== input.extensionId,
        );
        operation.updatedAt = now;
        if (operation.extensionIds.length === 0) {
          operation.status = "obsolete";
          operation.completedAt = now;
        }
      }
      request.updatedAt = now;
      if (request.extensionIds.length === 0) {
        request.status = "obsolete";
        request.completedAt = now;
      }
      changed = true;
    }
    if (changed) {
      this.write(ledger);
    }
  }

  findOrCreatePendingRequest(input: {
    extensionId: string;
    identities: readonly ExtensionDependencyApprovalIdentity[];
  }): ExtensionDependencyApprovalRequest | null {
    const unresolved = uniqueIdentities(
      input.identities.filter((identity) => !this.hasApproved(identity)),
    );
    if (unresolved.length === 0) {
      return null;
    }
    const identityKeys = unresolved.map(extensionDependencyApprovalIdentityKey).toSorted();
    const ledger = this.read();
    const existing = ledger.requests.find(
      (request) =>
        request.status === "pending" && sameStringSet(request.identityKeys, identityKeys),
    );
    if (existing) {
      if (!existing.extensionIds.includes(input.extensionId)) {
        existing.extensionIds = [...existing.extensionIds, input.extensionId].toSorted();
        existing.updatedAt = this.nowIso();
        this.write(ledger);
      }
      return existing;
    }
    const now = this.nowIso();
    const request: ExtensionDependencyApprovalRequest = {
      requestId: this.createRequestId(),
      status: "pending",
      extensionIds: [input.extensionId],
      identities: unresolved,
      identityKeys,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    ledger.requests.push(request);
    this.write(ledger);
    return request;
  }

  upsertBlockedOperation(input: {
    requestId: string;
    blockedOperation: "build" | "snapshot_load";
    extensionIds: readonly string[];
    resumeFingerprint?: string | null;
    snapshotId?: string | null;
  }): ExtensionDependencyBlockedOperation {
    const ledger = this.read();
    const request = ledger.requests.find((candidate) => candidate.requestId === input.requestId);
    if (!request) {
      throw new Error(`Unknown dependency approval request: ${input.requestId}`);
    }
    if (request.status !== "pending") {
      throw new Error(`Dependency approval request is not pending: ${input.requestId}`);
    }
    const extensionIds = [...new Set(input.extensionIds)].toSorted();
    const snapshotId = input.snapshotId ?? null;
    const existing = ledger.blockedOperations.find(
      (operation) =>
        operation.status === "pending" &&
        operation.requestId === input.requestId &&
        operation.blockedOperation === input.blockedOperation &&
        operation.snapshotId === snapshotId &&
        operation.resumeFingerprint === (input.resumeFingerprint ?? null) &&
        sameStringSet(operation.extensionIds, extensionIds),
    );
    const now = this.nowIso();
    if (existing) {
      existing.updatedAt = now;
      this.write(ledger);
      return existing;
    }
    const operation: ExtensionDependencyBlockedOperation = {
      operationId: `depwork_${randomUUID()}`,
      requestId: input.requestId,
      status: "pending",
      blockedOperation: input.blockedOperation,
      extensionIds,
      snapshotId,
      resumeFingerprint: input.resumeFingerprint ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    ledger.blockedOperations.push(operation);
    this.write(ledger);
    return operation;
  }

  listBlockedOperations(requestId?: string): ExtensionDependencyBlockedOperation[] {
    const operations = this.read().blockedOperations;
    return requestId
      ? operations.filter((operation) => operation.requestId === requestId)
      : operations;
  }

  markBlockedOperation(input: {
    operationId: string;
    status: "resumed" | "rejected" | "obsolete";
  }): ExtensionDependencyBlockedOperation {
    const ledger = this.read();
    const operation = ledger.blockedOperations.find(
      (candidate) => candidate.operationId === input.operationId,
    );
    if (!operation) {
      throw new Error(`Unknown dependency blocked operation: ${input.operationId}`);
    }
    const now = this.nowIso();
    operation.status = input.status;
    operation.updatedAt = now;
    operation.completedAt = now;
    this.write(ledger);
    return operation;
  }

  approveRequest(requestId: string): ExtensionDependencyApprovalRequest {
    const ledger = this.read();
    const request = ledger.requests.find((candidate) => candidate.requestId === requestId);
    if (!request) {
      throw new Error(`Unknown dependency approval request: ${requestId}`);
    }
    if (request.status !== "pending") {
      throw new Error(`Dependency approval request is not pending: ${requestId}`);
    }
    const now = this.nowIso();
    for (const identity of request.identities) {
      const identityKey = extensionDependencyApprovalIdentityKey(identity);
      if (ledger.approvals.some((approval) => approval.identityKey === identityKey)) {
        continue;
      }
      ledger.approvals.push({
        identity,
        identityKey,
        approvedAt: now,
        requestId,
      });
    }
    request.status = "approved";
    request.updatedAt = now;
    request.completedAt = now;
    this.write(ledger);
    return request;
  }

  rejectRequest(requestId: string): ExtensionDependencyApprovalRequest {
    const ledger = this.read();
    const request = ledger.requests.find((candidate) => candidate.requestId === requestId);
    if (!request) {
      throw new Error(`Unknown dependency approval request: ${requestId}`);
    }
    if (request.status !== "pending") {
      throw new Error(`Dependency approval request is not pending: ${requestId}`);
    }
    const now = this.nowIso();
    request.status = "rejected";
    request.updatedAt = now;
    request.completedAt = now;
    for (const operation of ledger.blockedOperations) {
      if (operation.requestId !== requestId || operation.status !== "pending") {
        continue;
      }
      operation.status = "rejected";
      operation.updatedAt = now;
      operation.completedAt = now;
    }
    this.write(ledger);
    return request;
  }

  listRequests(): ExtensionDependencyApprovalRequest[] {
    return this.read().requests;
  }

  private read(): ExtensionDependencyApprovalLedger {
    if (!existsSync(this.path)) {
      return { schemaVersion: 1, approvals: [], blockedOperations: [], requests: [] };
    }
    const raw = JSON.parse(
      readFileSync(this.path, "utf8"),
    ) as Partial<ExtensionDependencyApprovalLedger>;
    if (
      raw.schemaVersion !== 1 ||
      !Array.isArray(raw.approvals) ||
      !Array.isArray(raw.blockedOperations) ||
      !Array.isArray(raw.requests)
    ) {
      throw new Error(`Invalid extension dependency approval ledger: ${this.path}`);
    }
    return {
      schemaVersion: 1,
      approvals: raw.approvals,
      blockedOperations: raw.blockedOperations,
      requests: raw.requests,
    };
  }

  private write(ledger: ExtensionDependencyApprovalLedger): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(ledger, null, 2) + "\n");
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

export function extensionDependencyApprovalIdentityKey(
  identity: ExtensionDependencyApprovalIdentity,
): string {
  return JSON.stringify({
    kind: identity.kind,
    packageManager: identity.packageManager,
    source: identity.source,
    name: identity.name,
    version: identity.version,
    integrity: identity.integrity,
    resolution: identity.resolution,
  });
}

export function extensionDependencyIdentityFromDeclaration(input: {
  kind: "dependency" | "trusted_dependency";
  name: string;
  version: string;
}): ExtensionDependencyApprovalIdentity {
  return {
    kind: input.kind,
    packageManager: "bun",
    source: "npm",
    name: input.name,
    version: input.version,
    integrity: null,
    resolution: null,
  };
}

function uniqueIdentities(
  identities: readonly ExtensionDependencyApprovalIdentity[],
): ExtensionDependencyApprovalIdentity[] {
  const byKey = new Map<string, ExtensionDependencyApprovalIdentity>();
  for (const identity of identities) {
    byKey.set(extensionDependencyApprovalIdentityKey(identity), identity);
  }
  return [...byKey.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, identity]) => identity);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].toSorted();
  const sortedRight = [...right].toSorted();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

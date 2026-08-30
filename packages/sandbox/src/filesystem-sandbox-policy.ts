import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";

export type FileSystemAccessMode = "read" | "write" | "none";

export interface FileSystemSandboxEntry {
  path: string;
  access: FileSystemAccessMode;
  recursive?: boolean;
  source?: string;
  protectedMetadataNames?: readonly string[];
}

export interface FileSystemSandboxPolicy {
  kind: "restricted" | "unrestricted";
  entries: readonly FileSystemSandboxEntry[];
}

export interface ManagedWorkspaceWritePolicyInput {
  cwd: string;
  writableRoots?: readonly string[];
  readOnlyRoots?: readonly string[];
  noneRoots?: readonly string[];
  includeSlashTmp?: boolean;
  tmpdir?: string | null;
}

export interface MacOsSeatbeltProfile {
  profile: string;
  parameters: Record<string, string>;
}

const MACOS_SEATBELT_BASE_POLICY = `(version 1)

; child processes inherit the policy of their parent
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))

(allow file-write-data
  (require-all
    (path "/dev/null")
    (vnode-type CHARACTER-DEVICE)))

(allow sysctl-read
  (sysctl-name "hw.activecpu")
  (sysctl-name "hw.byteorder")
  (sysctl-name "hw.cacheconfig")
  (sysctl-name "hw.cachelinesize_compat")
  (sysctl-name "hw.cpufamily")
  (sysctl-name "hw.cputype")
  (sysctl-name "hw.machine")
  (sysctl-name "hw.model")
  (sysctl-name "hw.memsize")
  (sysctl-name "hw.ncpu")
  (sysctl-name "hw.nperflevels")
  (sysctl-name-prefix "hw.optional.arm.")
  (sysctl-name-prefix "hw.optional.armv8_")
  (sysctl-name "hw.packages")
  (sysctl-name "hw.pagesize")
  (sysctl-name "hw.physicalcpu")
  (sysctl-name "hw.physicalcpu_max")
  (sysctl-name "hw.logicalcpu")
  (sysctl-name "hw.cpufrequency")
  (sysctl-name "hw.vectorunit")
  (sysctl-name "machdep.cpu.brand_string")
  (sysctl-name "kern.argmax")
  (sysctl-name "kern.hostname")
  (sysctl-name "kern.maxfilesperproc")
  (sysctl-name "kern.maxproc")
  (sysctl-name "kern.ostype")
  (sysctl-name "kern.osversion")
  (sysctl-name "kern.version")
  (sysctl-name "vm.loadavg")
  (sysctl-name-prefix "hw.perflevel")
  (sysctl-name-prefix "kern.proc.pgrp.")
  (sysctl-name-prefix "kern.proc.pid.")
  (sysctl-name-prefix "net.routetable."))

(allow sysctl-write
  (sysctl-name "kern.grade_cputype"))

(allow iokit-open
  (iokit-registry-entry-class "RootDomainUserClient"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo"))
(allow ipc-posix-sem)
(allow ipc-posix-shm-read-data
  ipc-posix-shm-write-create
  ipc-posix-shm-write-unlink
  (ipc-posix-name-regex #"^/__KMP_REGISTERED_LIB_[0-9]+$"))
(allow mach-lookup
  (global-name "com.apple.PowerManagement.control"))

(allow ipc-posix-shm-read* (ipc-posix-name-prefix "apple.cfprefs."))
(allow mach-lookup
  (global-name "com.apple.cfprefsd.daemon")
  (global-name "com.apple.cfprefsd.agent")
  (local-name "com.apple.cfprefsd.agent"))
(allow user-preference-read)`;

const MACOS_SEATBELT_NETWORK_POLICY = `(allow system-socket
  (require-all
    (socket-domain AF_SYSTEM)
    (socket-protocol 2)))
(allow mach-lookup
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.networkd")
  (global-name "com.apple.ocspd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.SystemConfiguration.DNSConfiguration")
  (global-name "com.apple.SystemConfiguration.configd"))
(allow sysctl-read
  (sysctl-name-regex #"^net.routetable"))
(allow sysctl-read)
(allow mach-lookup (global-name-prefix "com.apple."))`;

const MACOS_SEATBELT_PLATFORM_DEFAULTS = "";
/*
const MACOS_SEATBELT_PLATFORM_DEFAULTS_DISABLED = `(allow file-read* file-test-existence
  (subpath "/Library/Apple")
  (subpath "/Library/Filesystems/NetFSPlugins")
  (subpath "/Library/Preferences/Logging")
  (subpath "/private/var/db/DarwinDirectory/local/recordStore.data")
  (subpath "/private/var/db/timezone")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/Library/Preferences")
  (subpath "/var/db")
  (subpath "/private/var/db"))
(allow file-read* file-test-existence
  (subpath "/Library/Apple/System/Library/Frameworks")
  (subpath "/Library/Apple/System/Library/PrivateFrameworks")
  (subpath "/Library/Apple/usr/lib")
  (subpath "/System/Library/Frameworks")
  (subpath "/System/Library/PrivateFrameworks")
  (subpath "/System/Library/SubFrameworks")
  (subpath "/System/iOSSupport/System/Library/Frameworks")
  (subpath "/System/iOSSupport/System/Library/PrivateFrameworks")
  (subpath "/System/iOSSupport/System/Library/SubFrameworks")
  (subpath "/usr/lib"))
(allow file-read-metadata file-test-existence
  (literal "/etc") (literal "/tmp") (literal "/var")
  (literal "/private/etc/localtime"))
(allow file-read-metadata file-test-existence
  (path-ancestors "/System/Volumes/Data/private"))
(allow file-read* file-test-existence
  (literal "/") (literal "/dev/autofs_nowait") (literal "/dev/random")
  (literal "/dev/urandom") (literal "/private/etc/master.passwd")
  (literal "/private/etc/passwd") (literal "/private/etc/protocols")
  (literal "/private/etc/services"))
(allow file-read* file-test-existence file-write-data
  (literal "/dev/null") (literal "/dev/zero"))
(allow file-read-data file-test-existence file-write-data
  (subpath "/dev/fd"))
(allow file-read* (subpath "/etc"))
(allow file-read* (subpath "/private/etc"))
(allow file-read* file-test-existence
  (literal "/System/Library/CoreServices")
  (literal "/System/Library/CoreServices/.SystemVersionPlatform.plist")
  (literal "/System/Library/CoreServices/SystemVersion.plist"))
(allow file-read-metadata (subpath "/var"))
(allow file-read-metadata (subpath "/private/var"))
(allow mach-lookup
  (global-name "com.apple.analyticsd")
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.cfprefsd.agent")
  (global-name "com.apple.cfprefsd.daemon")
  (global-name "com.apple.diagnosticd")
  (global-name "com.apple.logd")
  (global-name "com.apple.runningboard")
  (global-name "com.apple.secinitd")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.trustd")
  (global-name "com.apple.trustd.agent"))
(allow file-read* file-test-existence
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/var/tmp")
  (subpath "/private/var/tmp"))
(allow file-read-data (subpath "/bin"))
(allow file-read-metadata (subpath "/bin"))
(allow file-read-data (subpath "/sbin"))
(allow file-read-metadata (subpath "/sbin"))
(allow file-read-data (subpath "/usr/bin"))
(allow file-read-metadata (subpath "/usr/bin"))
(allow file-read-data (subpath "/usr/sbin"))
(allow file-read-metadata (subpath "/usr/sbin"))
(allow file-read-data (subpath "/usr/libexec"))
(allow file-read-metadata (subpath "/usr/libexec"))
(allow file-read* (subpath "/Library/Preferences"))
(allow file-read* (subpath "/opt/homebrew/lib"))
(allow file-read* (subpath "/usr/local/lib"))
(allow file-read* (subpath "/Applications"))
(allow system-mac-syscall (mac-policy-name "vnguard"))
(allow system-mac-syscall
  (require-all (mac-policy-name "Sandbox") (mac-syscall-number 67)))
(allow file-read-metadata file-test-existence
  (literal "/System/Volumes") (literal "/System/Volumes/Data")
  (literal "/System/Volumes/Data/Users"))
(allow file-read* (literal "/private/var/db/eligibilityd/eligibility.plist"))
(allow file-read* file-write-data file-ioctl (literal "/dev/dtracehelper"))
(allow network-outbound (literal "/private/var/run/syslog"))
(allow ipc-posix-shm-read* (ipc-posix-name "apple.shm.notification_center"))
(allow mach-lookup
  (global-name "com.apple.analyticsd.messagetracer")
  (global-name "com.apple.appsleep")
  (global-name "com.apple.diagnosticd")
  (global-name "com.apple.dt.automationmode.reader")
  (global-name "com.apple.espd")
  (global-name "com.apple.logd.events")
  (global-name "com.apple.system.DirectoryService.libinfo_v1")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.xpc.activity.unmanaged"))
(allow mach-lookup
  (global-name "com.apple.audio.audiohald")
  (global-name "com.apple.audio.AudioComponentRegistrar"))
(allow file-read* (regex #"^/dev/fd/(0|1|2)$"))
(allow file-write* (regex #"^/dev/fd/(1|2)$"))
(allow file-read* file-write* (literal "/dev/null"))
(allow file-read* file-write* (literal "/dev/tty"))
(allow file-read-metadata (regex #"^/dev/.*$"))
(allow file-read-metadata (literal "/dev/stdin") (literal "/dev/stdout") (literal "/dev/stderr"))
(allow file-read-metadata (regex #"^/dev/tty[^/]*$"))
(allow file-read-metadata (regex #"^/dev/pty[^/]*$"))
(allow file-read* file-write* (regex #"^/dev/ttys[0-9]+$"))
(allow file-read* file-write* (literal "/dev/ptmx"))
(allow file-ioctl (regex #"^/dev/ttys[0-9]+$"))
(allow file-read* (extension "com.apple.app-sandbox.read"))
(allow file-read* file-write* (extension "com.apple.app-sandbox.read-write"))`;
*/

const PROTECTED_METADATA_NAMES = [".git", ".agents", ".codex"] as const;

const ACCESS_PRECEDENCE: Record<FileSystemAccessMode, number> = {
  read: 1,
  write: 2,
  none: 3,
};

export function buildManagedWorkspaceWriteFileSystemPolicy(
  input: ManagedWorkspaceWritePolicyInput,
): FileSystemSandboxPolicy {
  const entries: FileSystemSandboxEntry[] = [
    { path: resolvePath(sep), access: "read" },
    writableRootEntry(input.cwd),
  ];
  if (input.includeSlashTmp !== false) {
    entries.push(writableRootEntry("/tmp"));
  }
  if (input.tmpdir) {
    entries.push(writableRootEntry(input.tmpdir));
  }
  for (const root of input.writableRoots ?? []) {
    entries.push(writableRootEntry(root));
  }
  for (const root of input.readOnlyRoots ?? []) {
    entries.push({ path: normalizePolicyPath(root), access: "read" });
  }
  for (const root of input.noneRoots ?? []) {
    entries.push({ path: normalizePolicyPath(root), access: "none" });
  }
  return { kind: "restricted", entries };
}

export function unrestrictedFileSystemPolicy(): FileSystemSandboxPolicy {
  return { kind: "unrestricted", entries: [] };
}

export function resolveFileSystemAccess(
  policy: FileSystemSandboxPolicy,
  path: string,
  cwd: string,
): FileSystemAccessMode {
  if (policy.kind === "unrestricted") {
    return "write";
  }
  const target = resolveCandidatePath(path, cwd);
  const match = policy.entries
    .map(normalizeEntry)
    .filter((entry) => entryMatchesPath(entry, target))
    .toSorted((left, right) => {
      const specificity = pathSpecificity(right.path) - pathSpecificity(left.path);
      if (specificity !== 0) return specificity;
      return ACCESS_PRECEDENCE[right.access] - ACCESS_PRECEDENCE[left.access];
    })[0];
  return match?.access ?? "none";
}

export function canReadFileSystemPath(
  policy: FileSystemSandboxPolicy,
  path: string,
  cwd: string,
): boolean {
  return resolveFileSystemAccess(policy, path, cwd) !== "none";
}

export function canWriteFileSystemPath(
  policy: FileSystemSandboxPolicy,
  path: string,
  cwd: string,
): boolean {
  return (
    resolveFileSystemAccess(policy, path, cwd) === "write" &&
    !isProtectedMetadataWriteDenied(policy, path, cwd)
  );
}

export function protectedMetadataNames(): readonly string[] {
  return PROTECTED_METADATA_NAMES;
}

export function buildMacOsSeatbeltProfile(
  policy: FileSystemSandboxPolicy,
  cwd: string,
  input: { networkAccess: boolean },
): MacOsSeatbeltProfile {
  const parameters: Record<string, string> = {};
  const sections = [
    MACOS_SEATBELT_BASE_POLICY,
    // These are the minimum platform reads needed to start ordinary macOS
    // executables. They deliberately contain no broad temporary-directory
    // writes; all writes remain governed by the exact policy below.
    MACOS_SEATBELT_PLATFORM_DEFAULTS,
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow process-info* (target same-sandbox))",
    buildSeatbeltFileReadPolicy(policy, cwd, parameters),
    buildSeatbeltFileWritePolicy(policy, cwd, parameters),
    input.networkAccess
      ? `${MACOS_SEATBELT_NETWORK_POLICY}\n(allow network-outbound)\n(allow network-inbound)`
      : "(deny network*)",
  ].filter((section) => section.length > 0);
  return {
    profile: sections.join("\n"),
    parameters,
  };
}

function writableRootEntry(path: string): FileSystemSandboxEntry {
  return {
    path: normalizePolicyPath(path),
    access: "write",
    protectedMetadataNames: PROTECTED_METADATA_NAMES,
  };
}

function isProtectedMetadataWriteDenied(
  policy: FileSystemSandboxPolicy,
  path: string,
  cwd: string,
): boolean {
  if (policy.kind === "unrestricted") {
    return false;
  }
  const target = resolveCandidatePath(path, cwd);
  for (const entry of policy.entries.map(normalizeEntry)) {
    if (entry.access !== "write" || !entry.protectedMetadataNames?.length) {
      continue;
    }
    if (!entryMatchesPath(entry, target)) {
      continue;
    }
    const root = entry.path;
    for (const metadataName of entry.protectedMetadataNames) {
      const metadataRoot = resolvePath(root, metadataName);
      if (!isPathInside(metadataRoot, target)) {
        continue;
      }
      if (hasExplicitMetadataWrite(policy, root, metadataRoot, target)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function hasExplicitMetadataWrite(
  policy: FileSystemSandboxPolicy,
  broadWritableRoot: string,
  metadataRoot: string,
  target: string,
): boolean {
  return policy.entries.some((entry) => {
    const normalized = normalizeEntry(entry);
    if (normalized.access !== "write") {
      return false;
    }
    const entryPath = normalized.path;
    return (
      entryPath !== broadWritableRoot &&
      isPathInside(metadataRoot, entryPath) &&
      entryMatchesPath(normalized, target)
    );
  });
}

function buildSeatbeltFileReadPolicy(
  policy: FileSystemSandboxPolicy,
  cwd: string,
  parameters: Record<string, string>,
): string {
  if (policy.kind === "unrestricted") {
    return "(allow file-read*)";
  }
  const normalizedEntries = policy.entries.map(normalizeEntry);
  const unreadableRoots = normalizedEntries
    .filter((entry) => entry.access === "none")
    .filter((entry) => resolveFileSystemAccess(policy, entry.path, cwd) === "none");
  const readableRoots = normalizedEntries
    .filter((entry) => entry.access !== "none")
    .filter((entry) => canReadFileSystemPath(policy, entry.path, cwd));
  if (readableRoots.length === 0) {
    return "(deny file-read*)";
  }
  const roots = readableRoots.map((root, index) => {
    const rootParam = `READABLE_ROOT_${index}`;
    parameters[rootParam] = root.path;
    const requirements = root.recursive
      ? [`(subpath (param "${rootParam}"))`]
      : [`(literal (param "${rootParam}"))`];
    for (const [excludedIndex, excluded] of readOnlySubpathsForReadableRoot(
      policy,
      root,
      cwd,
      unreadableRoots,
    ).entries()) {
      const excludedParam = `READABLE_ROOT_${index}_EXCLUDED_${excludedIndex}`;
      parameters[excludedParam] = excluded.path;
      for (const requirement of entrySeatbeltPathRequirements(excludedParam, excluded.recursive)) {
        requirements.push(`(require-not ${requirement})`);
      }
    }
    return `(require-all ${requirements.join(" ")} )`;
  });
  const ancestorMetadataRules = readableRoots
    .filter((root) => root.path !== sep)
    .map(
      (root) =>
        `(allow file-read-metadata file-test-existence (literal "${escapeSeatbeltString(root.path)}") (path-ancestors "${escapeSeatbeltString(root.path)}"))`,
    );
  const denialRules = unreadableRoots.map((root, index) => {
    const deniedParam = `DENIED_READ_ROOT_${index}`;
    parameters[deniedParam] = root.path;
    const requirements = entrySeatbeltPathRequirements(deniedParam, root.recursive);
    for (const [excludedIndex, readableChild] of readableRoots
      .filter((entry) => entryContainsPath(root, entry.path))
      .entries()) {
      const excludedParam = `DENIED_READ_ROOT_${index}_EXCLUDED_${excludedIndex}`;
      parameters[excludedParam] = readableChild.path;
      for (const requirement of entrySeatbeltPathRequirements(
        excludedParam,
        readableChild.recursive,
      )) {
        requirements.push(`(require-not ${requirement})`);
      }
    }
    return `(deny file-read* (require-all ${requirements.join(" ")}))`;
  });
  return [
    ...denialRules,
    `(allow file-read*\n${roots.join(" ")}\n)`,
    ...ancestorMetadataRules,
  ].join("\n");
}

function readOnlySubpathsForReadableRoot(
  policy: FileSystemSandboxPolicy,
  root: NormalizedFileSystemSandboxEntry,
  cwd: string,
  unreadableRoots: readonly NormalizedFileSystemSandboxEntry[],
): NormalizedFileSystemSandboxEntry[] {
  return unreadableRoots
    .filter((entry) => entryContainsPath(root, entry.path))
    .filter((entry) => resolveFileSystemAccess(policy, entry.path, cwd) === "none")
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function buildSeatbeltFileWritePolicy(
  policy: FileSystemSandboxPolicy,
  cwd: string,
  parameters: Record<string, string>,
): string {
  if (policy.kind === "unrestricted") {
    return "(allow file-write*)";
  }
  const writableRoots = policy.entries
    .map(normalizeEntry)
    .filter((entry) => entry.access === "write")
    .filter((entry) => canWriteFileSystemPath(policy, entry.path, cwd));
  if (writableRoots.length === 0) {
    return "(deny file-write*)";
  }
  const roots = writableRoots.map((root, index) => {
    const rootParam = `WRITABLE_ROOT_${index}`;
    parameters[rootParam] = root.path;
    const requirements = root.recursive
      ? [`(subpath (param "${rootParam}"))`]
      : [`(literal (param "${rootParam}"))`];
    for (const [excludedIndex, excluded] of readOnlySubpathsForWritableRoot(
      policy,
      root,
      cwd,
    ).entries()) {
      const excludedParam = `WRITABLE_ROOT_${index}_EXCLUDED_${excludedIndex}`;
      parameters[excludedParam] = excluded.path;
      for (const requirement of entrySeatbeltPathRequirements(excludedParam, excluded.recursive)) {
        requirements.push(`(require-not ${requirement})`);
      }
    }
    for (const metadataName of root.protectedMetadataNames ?? []) {
      requirements.push(
        `(require-not (regex #"${seatbeltProtectedMetadataNameRegex(root.path, metadataName)}"))`,
      );
    }
    return `(require-all ${requirements.join(" ")} )`;
  });
  return ["(deny file-write*)", `(allow file-write*\n${roots.join(" ")}\n)`].join("\n");
}

function readOnlySubpathsForWritableRoot(
  policy: FileSystemSandboxPolicy,
  root: NormalizedFileSystemSandboxEntry,
  cwd: string,
): NormalizedFileSystemSandboxEntry[] {
  return policy.entries
    .map(normalizeEntry)
    .filter((entry) => entry.access !== "write")
    .filter((entry) => entryContainsPath(root, entry.path))
    .filter((entry) => !canWriteFileSystemPath(policy, entry.path, cwd))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

type NormalizedFileSystemSandboxEntry = FileSystemSandboxEntry & {
  path: string;
  recursive: boolean;
};

function normalizeEntry(entry: FileSystemSandboxEntry): NormalizedFileSystemSandboxEntry {
  return {
    ...entry,
    path: normalizePolicyPath(entry.path),
    recursive: entry.recursive !== false,
  };
}

function entryMatchesPath(entry: NormalizedFileSystemSandboxEntry, target: string): boolean {
  return entry.recursive ? isPathInside(entry.path, target) : entry.path === target;
}

function entryContainsPath(entry: NormalizedFileSystemSandboxEntry, path: string): boolean {
  return entry.recursive
    ? isPathInside(entry.path, path)
    : entry.path === normalizePolicyPath(path);
}

function entrySeatbeltPathRequirements(parameterName: string, recursive: boolean): string[] {
  return recursive
    ? [`(subpath (param "${parameterName}"))`]
    : [`(literal (param "${parameterName}"))`];
}

function seatbeltProtectedMetadataNameRegex(root: string, name: string): string {
  let normalizedRoot = normalizePolicyPath(root);
  while (normalizedRoot.length > 1 && normalizedRoot.endsWith(sep)) {
    normalizedRoot = normalizedRoot.slice(0, -1);
  }
  const escapedRoot = escapeRegex(normalizedRoot);
  const escapedName = escapeRegex(name);
  if (normalizedRoot === sep) {
    return escapeSeatbeltString(`^/${escapedName}(/.*)?$`);
  }
  return escapeSeatbeltString(`^${escapedRoot}/${escapedName}(/.*)?$`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeSeatbeltString(value: string): string {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      throw new Error("Seatbelt strings cannot contain control characters.");
    }
  }
  // Seatbelt's #"..." regex literal keeps regex backslashes verbatim; only
  // the delimiter itself needs quoting after the regex has been constructed.
  return value.replace(/"/g, '\\"');
}

function resolveCandidatePath(path: string, cwd: string): string {
  return normalizePolicyPath(isAbsolute(path) ? path : resolvePath(cwd, path));
}

function normalizePolicyPath(path: string): string {
  return resolvePath(path);
}

function pathSpecificity(path: string): number {
  return normalizePolicyPath(path).split(sep).filter(Boolean).length;
}

function isPathInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

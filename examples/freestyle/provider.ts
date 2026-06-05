import type {
	SandboxProvider,
	SandboxProviderRequest,
	SandboxProviderResult,
} from "smithers-orchestrator/sandbox";

type FreestyleFile = {
	content: string;
	encoding?: "utf8" | "base64";
};

type FreestyleCreateOptions = Record<string, unknown> & {
	additionalFiles?: Record<string, FreestyleFile>;
	workdir?: string;
	idleTimeoutSeconds?: number;
};

type FreestyleExecResult =
	| string
	| {
			stdout?: string;
			stderr?: string;
			exitCode?: number;
	  }
	| undefined;

type FreestyleVm = {
	exec(command: string): Promise<FreestyleExecResult>;
	fs: {
		readTextFile(path: string): Promise<string>;
		writeTextFile?(path: string, content: string): Promise<void>;
	};
};

type FreestyleCreateResult = {
	vm: FreestyleVm;
	vmId?: string;
	consoleUrl?: string;
};

export type FreestyleClient = {
	vms: {
		create(options: FreestyleCreateOptions): Promise<FreestyleCreateResult>;
		delete?(args: { vmId: string }): Promise<void>;
	};
};

export type FreestyleSandboxProviderOptions = {
	freestyle: FreestyleClient;
	workdir?: string;
	command?: string;
	idleTimeoutSeconds?: number;
	createOptions?: FreestyleCreateOptions;
	cleanup?: "delete" | "keep";
};

function requestPath(workdir: string) {
	return `${workdir}/smithers-request.json`;
}

function resultPath(workdir: string) {
	return `${workdir}/smithers-result.json`;
}

function keyFor(request: SandboxProviderRequest) {
	return `${request.runId}:${request.sandboxId}`;
}

function stdoutFromExec(result: FreestyleExecResult) {
	if (typeof result === "string") {
		return result;
	}
	return typeof result?.stdout === "string" ? result.stdout : "";
}

function parseResultJson(raw: string): SandboxProviderResult {
	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Freestyle sandbox result must be a JSON object.");
	}
	return parsed as SandboxProviderResult;
}

export function createFreestyleSandboxProvider(
	options: FreestyleSandboxProviderOptions,
): SandboxProvider {
	const workdir = options.workdir ?? "/workspace";
	const command = options.command ?? "node /workspace/run-smithers-sandbox.js";
	const cleanup = options.cleanup ?? "delete";
	const activeVms = new Map<string, string>();

	return {
		id: "freestyle",
		async run(request) {
			const createOptions = options.createOptions ?? {};
			const additionalFiles = {
				...(createOptions.additionalFiles ?? {}),
				[requestPath(workdir)]: {
					content: JSON.stringify({
						runId: request.runId,
						sandboxId: request.sandboxId,
						input: request.input,
					}),
				},
			};
			const { vm, vmId, consoleUrl } = await options.freestyle.vms.create({
				...createOptions,
				additionalFiles,
				workdir,
				idleTimeoutSeconds: options.idleTimeoutSeconds ?? createOptions.idleTimeoutSeconds,
			});
			if (vmId) {
				activeVms.set(keyFor(request), vmId);
			}

			request.heartbeat({
				sandboxId: request.sandboxId,
				stage: "freestyle-vm-created",
				vmId,
				consoleUrl,
			});

			const execResult = await vm.exec(command);
			const stdout = stdoutFromExec(execResult).trim();
			const result = stdout.startsWith("{")
				? parseResultJson(stdout)
				: parseResultJson(await vm.fs.readTextFile(resultPath(workdir)));

			if ("bundlePath" in result) {
				return {
					...result,
					remoteRunId: result.remoteRunId ?? vmId,
					workspaceId: result.workspaceId ?? vmId,
				};
			}
			return {
				...result,
				remoteRunId: result.remoteRunId ?? result.runId ?? vmId,
				workspaceId: result.workspaceId ?? vmId,
			};
		},
		async cleanup(request) {
			if (cleanup !== "delete") {
				return;
			}
			const vmId = activeVms.get(keyFor(request));
			if (!vmId || !options.freestyle.vms.delete) {
				return;
			}
			activeVms.delete(keyFor(request));
			await options.freestyle.vms.delete({ vmId });
		},
	};
}

export function createMockFreestyleClient(
	handler: (args: {
		command: string;
		request: { runId: string; sandboxId: string; input?: unknown };
		files: Map<string, string>;
	}) => Promise<SandboxProviderResult> | SandboxProviderResult,
): FreestyleClient {
	let nextId = 0;
	return {
		vms: {
			async create(options) {
				nextId += 1;
				const vmId = `mock-freestyle-${nextId}`;
				const files = new Map<string, string>();
				for (const [path, file] of Object.entries(options.additionalFiles ?? {})) {
					files.set(path, file.content);
				}
				const workdir = options.workdir ?? "/workspace";
				const vm: FreestyleVm = {
					async exec(command) {
						const request = JSON.parse(files.get(requestPath(workdir)) ?? "{}");
						const result = await handler({ command, request, files });
						files.set(resultPath(workdir), JSON.stringify(result));
						return { exitCode: 0, stdout: "" };
					},
					fs: {
						async readTextFile(path) {
							const value = files.get(path);
							if (value === undefined) {
								throw new Error(`Mock Freestyle file not found: ${path}`);
							}
							return value;
						},
						async writeTextFile(path, content) {
							files.set(path, content);
						},
					},
				};
				return { vm, vmId, consoleUrl: `https://mock.freestyle.local/${vmId}` };
			},
			async delete() {},
		},
	};
}

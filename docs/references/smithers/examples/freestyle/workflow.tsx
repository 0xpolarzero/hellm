/** @jsxImportSource smithers-orchestrator */
import { Sandbox, Workflow } from "smithers-orchestrator";
import { z } from "zod";
import { createExampleSmithers } from "../_example-kit.js";
import {
	createFreestyleSandboxProvider,
	createMockFreestyleClient,
} from "./provider.js";

const { smithers, outputs } = createExampleSmithers({
	sandboxResult: z.object({
		summary: z.string(),
		remoteRunId: z.string(),
	}),
});

const mockFreestyle = createMockFreestyleClient(async ({ request }) => ({
	status: "finished",
	output: {
		summary: `Handled remotely: ${String(
			(request.input as { prompt?: unknown } | undefined)?.prompt ?? "no prompt",
		)}`,
		remoteRunId: `mock:${request.sandboxId}`,
	},
	runId: `mock:${request.sandboxId}`,
}));

const freestyleProvider = createFreestyleSandboxProvider({
	freestyle: mockFreestyle,
	command: "node /workspace/run-smithers-sandbox.js",
	idleTimeoutSeconds: 60,
	createOptions: {
		additionalFiles: {
			"/workspace/run-smithers-sandbox.js": {
				content: [
					"const fs = require('node:fs');",
					"const req = JSON.parse(fs.readFileSync('/workspace/smithers-request.json', 'utf8'));",
					"fs.writeFileSync('/workspace/smithers-result.json', JSON.stringify({",
					"  status: 'finished',",
					"  output: { summary: `Handled remotely: ${req.input?.prompt ?? 'no prompt'}`, remoteRunId: `vm:${req.sandboxId}` },",
					"  runId: `vm:${req.sandboxId}`",
					"}));",
				].join("\n"),
			},
		},
	},
});

const remoteChildWorkflow = {
	build: () => <Workflow name="freestyle-child" />,
	opts: {},
};

export default smithers((ctx) => (
	<Workflow name="freestyle-provider-example">
		<Sandbox
			id="remote-edit"
			provider={freestyleProvider}
			workflow={remoteChildWorkflow}
			input={{
				prompt:
					(ctx.input as { prompt?: unknown } | undefined)?.prompt ??
					"update the project",
			}}
			output={outputs.sandboxResult}
			reviewDiffs={false}
			retries={0}
		/>
	</Workflow>
));

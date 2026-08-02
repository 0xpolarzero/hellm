import type { SmithersWorkflow } from "@smthrs/components/SmithersWorkflow";

export type ChildWorkflowDefinition =
	| SmithersWorkflow<unknown>
	| (() => SmithersWorkflow<unknown> | unknown);

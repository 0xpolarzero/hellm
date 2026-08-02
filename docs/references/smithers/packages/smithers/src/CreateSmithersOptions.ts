import type { SmithersAlertPolicy } from "@smthrs/scheduler/SmithersWorkflowOptions";

export type CreateSmithersOptions = {
	readableName?: string;
	description?: string;
	alertPolicy?: SmithersAlertPolicy;
	dbPath?: string;
	journalMode?: string;
};

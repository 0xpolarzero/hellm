import type { WorkflowSourceType } from "./WorkflowSourceType.ts";

export type DiscoveredWorkflow = {
    id: string;
    metadataVersion: 1;
    displayName: string;
    /** Which pack this workflow was discovered in: a repo's `.smithers` ("local") or the user-level `~/.smithers` ("global"). Local shadows global on id collisions. */
    scope: "local" | "global";
    sourceType: WorkflowSourceType;
    description: string;
    tags: string[];
    aliases: string[];
    entryFile: string;
    path: string;
};

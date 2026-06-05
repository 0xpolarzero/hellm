import { Data } from "effect"; export class WorkflowFailed extends Data.TaggedError("WorkflowFailed") { constructor(args) { super(args); } }

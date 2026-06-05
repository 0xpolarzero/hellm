import { Data } from "effect"; export class TaskAborted extends Data.TaggedError("TaskAborted") { constructor(args) { super(args); } }

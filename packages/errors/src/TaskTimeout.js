import { Data } from "effect"; export class TaskTimeout extends Data.TaggedError("TaskTimeout") { constructor(args) { super(args); } }

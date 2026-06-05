import { Data } from "effect"; export class RunNotFound extends Data.TaggedError("RunNotFound") { constructor(args) { super(args); } }

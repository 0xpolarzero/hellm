import { Data } from "effect"; export class EngineError extends Data.TaggedError("EngineError") { constructor(args) { super(args); } }

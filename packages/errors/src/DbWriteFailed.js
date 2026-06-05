import { Data } from "effect"; export class DbWriteFailed extends Data.TaggedError("DbWriteFailed") { constructor(args) { super(args); } }

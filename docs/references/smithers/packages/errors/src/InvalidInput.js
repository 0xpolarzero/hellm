import { Data } from "effect"; export class InvalidInput extends Data.TaggedError("InvalidInput") { constructor(args) { super(args); } }

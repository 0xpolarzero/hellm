// oxlint-disable-next-line typescript/triple-slash-reference -- Root and package builds both need the text-asset declaration.
/// <reference path="./markdown-assets.d.ts" />

import type { RequestInputVariant } from "@svvy/core";

import blockingInstructions from "./builtin/request-user-input/variants/blocking.md" with { type: "text" };
import nonblockingInstructions from "./builtin/request-user-input/variants/nonblocking.md" with { type: "text" };

export function getRequestUserInputVariantInstructions(variant: RequestInputVariant): string {
  return variant === "blocking" ? blockingInstructions : nonblockingInstructions;
}

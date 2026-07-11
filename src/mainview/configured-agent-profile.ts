import type { ReasoningEffort } from "@svvy/core";
import type { ConfiguredAgentProfileReadModelRecord } from "../shared/workspace-contract";

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export function configuredAgentProfileReasoningEffort(
  profile: Pick<ConfiguredAgentProfileReadModelRecord, "reasoning">,
): ReasoningEffort {
  if (!profile.reasoning || Array.isArray(profile.reasoning)) return "off";
  if (typeof profile.reasoning !== "object") return "off";
  const effort = (profile.reasoning as { readonly effort?: unknown }).effort;
  return typeof effort === "string" && REASONING_EFFORTS.has(effort as ReasoningEffort)
    ? (effort as ReasoningEffort)
    : "off";
}

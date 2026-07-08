import * as Schema from "effect/Schema";

type SourceDomain = "extensions" | "workflows" | "external_instructions" | "host_snippets";
type SourceInvalidationScope =
  | { readonly kind: "app-global" }
  | { readonly kind: "workspace"; readonly workspaceId: string };

type SourceScopeDomainShape = {
  readonly scope: SourceInvalidationScope;
  readonly domain?: SourceDomain | undefined;
  readonly domains?: ReadonlyArray<SourceDomain> | undefined;
  readonly event?:
    | {
        readonly domains?: ReadonlyArray<SourceDomain> | undefined;
      }
    | undefined;
};

const APP_GLOBAL_SOURCE_DOMAINS = ["extensions", "workflows"] as const;
const WORKSPACE_SOURCE_DOMAINS = ["external_instructions", "host_snippets"] as const;

function sourceDomainsForScope(scope: SourceInvalidationScope): readonly SourceDomain[] {
  return scope.kind === "app-global" ? APP_GLOBAL_SOURCE_DOMAINS : WORKSPACE_SOURCE_DOMAINS;
}

export const SourceScopeDomainInvariant = Schema.makeFilter(
  (input: SourceScopeDomainShape) => {
    const allowedDomains = sourceDomainsForScope(input.scope);
    const domains = input.domain ? [input.domain] : (input.domains ?? input.event?.domains ?? []);
    const invalidDomain = domains.find((domain) => !allowedDomains.includes(domain));
    if (invalidDomain) {
      return {
        path: input.domain ? ["domain"] : ["domains"],
        issue: `${input.scope.kind} source invalidation cannot target ${invalidDomain}`,
      };
    }
    return true;
  },
  { expected: "a valid source invalidation scope/domain pair" },
);

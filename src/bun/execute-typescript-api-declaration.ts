import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import type { WebProvider } from "./web-runtime/contracts";
import { createWebProvider } from "./web-runtime/provider-registry";

const DEFAULT_WEB_PROVIDER = createWebProvider({ provider: "local" });

export function buildExecuteTypescriptApiDeclaration(webProvider?: WebProvider): string {
  const provider = webProvider ?? DEFAULT_WEB_PROVIDER;
  return [EXECUTE_TYPESCRIPT_API_DECLARATION.trim(), buildActiveWebDeclaration(provider)].join(
    "\n\n",
  );
}

export function buildActiveWebDeclaration(webProvider: WebProvider): string {
  const contracts = webProvider.getToolContracts();
  return [
    "/** Active web provider contract selected from checked-in provider contracts. */",
    contracts.search.inputTypeDeclaration,
    contracts.search.outputTypeDeclaration,
    contracts.fetch.inputTypeDeclaration,
    contracts.fetch.outputTypeDeclaration,
  ].join("\n");
}

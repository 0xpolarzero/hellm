import type { TestWorkflowDefinition } from "./manager";
import { createHelloWorldTestWorkflow } from "./test-workflows";

export function createBundledWorkflowDefinitions(dbPath: string): TestWorkflowDefinition[] {
  return [createHelloWorldTestWorkflow(dbPath)];
}

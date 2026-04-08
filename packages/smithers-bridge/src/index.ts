export interface SmithersWorkflowBridge {
  readonly enabled: boolean;
  readonly engine: "smithers";
}

export const createSmithersWorkflowBridge = (): SmithersWorkflowBridge => {
  return {
    enabled: false,
    engine: "smithers",
  };
};

export interface PiRuntimeBridge {
  readonly connected: boolean;
  readonly runtime: "pi";
}

export const createPiRuntimeBridge = (): PiRuntimeBridge => {
  return {
    connected: false,
    runtime: "pi",
  };
};

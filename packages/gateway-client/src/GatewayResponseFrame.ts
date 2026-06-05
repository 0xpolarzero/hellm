export type GatewayResponseFrame<Payload = unknown> =
  | {
      type: "res";
      id: string;
      ok: true;
      apiVersion?: "v1";
      payload: Payload;
    }
  | {
      type: "res";
      id: string;
      ok: false;
      apiVersion?: "v1";
      error: {
        version?: "v1";
        code: string;
        message: string;
        requiredScope?: string;
        refresh?: string;
        details?: unknown;
      };
    };

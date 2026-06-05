export type GatewayEventFrame<Payload = unknown> = {
  type: "event";
  event: string;
  payload?: Payload;
  seq: number;
  stateVersion: number;
  apiVersion?: "v1";
};

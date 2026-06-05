export type GatewayRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

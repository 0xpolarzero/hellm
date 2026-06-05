import type { GatewayWebhookConfig } from "./GatewayWebhookConfig.js";
import type { GatewayUiConfig } from "./GatewayUiConfig.js";

export type GatewayRegisterOptions = {
  schedule?: string;
  webhook?: GatewayWebhookConfig;
  ui?: GatewayUiConfig;
};

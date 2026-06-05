import { createElement, useMemo, type ReactNode } from "react";
import { SmithersGatewayClient, type SmithersGatewayClientOptions } from "@smithers-orchestrator/gateway-client";
import { SmithersGatewayContext } from "./SmithersGatewayContext.ts";

export function SmithersGatewayProvider(props: {
  client?: SmithersGatewayClient;
  options?: SmithersGatewayClientOptions;
  children?: ReactNode;
}) {
  const provided = props.client;
  const options = props.options;
  const client = useMemo(
    () => provided ?? new SmithersGatewayClient(options),
    // Memoize on primitive identity so an inline `options` object literal does
    // not re-create the client (and trigger a reconnect storm) every render.
    [provided, options?.baseUrl, options?.token],
  );
  return createElement(SmithersGatewayContext.Provider, { value: client }, props.children);
}

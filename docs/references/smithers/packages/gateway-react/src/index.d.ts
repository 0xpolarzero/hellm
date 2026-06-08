import * as react from 'react';
import { ReactNode, ReactElement } from 'react';
import * as _smithers_orchestrator_gateway_client from '@smithers-orchestrator/gateway-client';
import { SmithersGatewayClient, SmithersGatewayClientOptions, GatewayRpcParams, GatewayRpcPayload, GatewayEventFrame } from '@smithers-orchestrator/gateway-client';
import * as _smithers_orchestrator_gateway_rpc from '@smithers-orchestrator/gateway/rpc';
import { ListApprovalsRequest, GatewayRpcMethod, ListRunsRequest, ListWorkflowsRequest } from '@smithers-orchestrator/gateway/rpc';

declare function createGatewayReactRoot(element: ReactElement, options?: SmithersGatewayClientOptions & {
    rootId?: string;
}): SmithersGatewayClient;

declare const SmithersGatewayContext: react.Context<SmithersGatewayClient | null>;

declare function SmithersGatewayProvider(props: {
    client?: SmithersGatewayClient;
    options?: SmithersGatewayClientOptions;
    children?: ReactNode;
}): react.FunctionComponentElement<react.ProviderProps<SmithersGatewayClient | null>>;

declare function useGatewayActions(): {
    launchRun: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"launchRun">) => Promise<_smithers_orchestrator_gateway_rpc.LaunchRunResponse>;
    resumeRun: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"resumeRun">) => Promise<_smithers_orchestrator_gateway_rpc.ResumeRunResponse>;
    cancelRun: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"cancelRun">) => Promise<_smithers_orchestrator_gateway_rpc.CancelRunResponse>;
    hijackRun: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"hijackRun">) => Promise<_smithers_orchestrator_gateway_rpc.HijackRunResponse>;
    rewindRun: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"rewindRun">) => Promise<Record<string, unknown>>;
    submitApproval: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"submitApproval">) => Promise<_smithers_orchestrator_gateway_rpc.SubmitApprovalResponse>;
    submitSignal: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"submitSignal">) => Promise<Record<string, unknown>>;
    cronCreate: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"cronCreate">) => Promise<Record<string, unknown>>;
    cronDelete: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"cronDelete">) => Promise<Record<string, unknown>>;
    cronRun: (params: _smithers_orchestrator_gateway_client.GatewayRpcParams<"cronRun">) => Promise<_smithers_orchestrator_gateway_rpc.LaunchRunResponse>;
};

type GatewayAsyncState<T> = {
    data: T | undefined;
    error: Error | undefined;
    loading: boolean;
    refetch: () => Promise<void>;
};

declare function useGatewayApprovals(params?: ListApprovalsRequest): GatewayAsyncState<_smithers_orchestrator_gateway_rpc.ListApprovalsResponse>;

declare function useGatewayNodeOutput(params: {
    runId: string | undefined;
    nodeId: string | undefined;
    iteration?: number;
}): GatewayAsyncState<Record<string, unknown>>;

declare function useGatewayRpc<Method extends GatewayRpcMethod>(method: Method, params: GatewayRpcParams<Method>, options?: {
    enabled?: boolean;
    deps?: readonly unknown[];
}): GatewayAsyncState<GatewayRpcPayload<Method>>;

declare function useGatewayRun(runId: string | undefined): GatewayAsyncState<Record<string, unknown>>;

declare function useGatewayRunEvents(runId: string | undefined, options?: {
    afterSeq?: number;
    maxEvents?: number;
}): {
    events: GatewayEventFrame[];
    lastHeartbeat: GatewayEventFrame | undefined;
    error: Error | undefined;
    streaming: boolean;
};

declare function useGatewayRuns(params?: ListRunsRequest): GatewayAsyncState<Record<string, unknown>[]>;

declare function useGatewayWorkflows(params?: ListWorkflowsRequest): GatewayAsyncState<_smithers_orchestrator_gateway_rpc.ListWorkflowsResponse>;

declare function useSmithersGateway(): _smithers_orchestrator_gateway_client.SmithersGatewayClient;

export { type GatewayAsyncState, SmithersGatewayContext, SmithersGatewayProvider, createGatewayReactRoot, useGatewayActions, useGatewayApprovals, useGatewayNodeOutput, useGatewayRpc, useGatewayRun, useGatewayRunEvents, useGatewayRuns, useGatewayWorkflows, useSmithersGateway };

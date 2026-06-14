import { randomUUID } from "node:crypto";

type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type AgentRunId = Brand<string, "AgentRunId">;
export type WorkflowRunId = Brand<string, "WorkflowRunId">;
export type NodeRunId = Brand<string, "NodeRunId">;

export function agentRunIdFrom(value: string): AgentRunId {
  return value as AgentRunId;
}

export function workflowRunIdFrom(value: string): WorkflowRunId {
  return value as WorkflowRunId;
}

export function nodeRunIdFrom(value: string): NodeRunId {
  return value as NodeRunId;
}

export function mintAgentRunId(): AgentRunId {
  return agentRunIdFrom(`agent-${randomUUID()}`);
}

export function mintWorkflowRunId(): WorkflowRunId {
  return workflowRunIdFrom(`workflow-${randomUUID()}`);
}

export function mintNodeRunId(): NodeRunId {
  return nodeRunIdFrom(`node-${randomUUID()}`);
}

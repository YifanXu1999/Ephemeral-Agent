import {
  defineTool,
  type BackgroundTaskOutcome,
  type JsonObject,
  type ToolDefinition,
} from "@ephai/agent-core";
import type { WorkflowOutcome } from "@ephai/agent-core/agentic-workflows";
import { z } from "zod";

import type { AgenticWorkflowToolService } from "../../agentic-workflows/agentic-workflow-tool-service.js";

export function delegateWorkflowTool(
  service: AgenticWorkflowToolService,
  input: {
    agentName: string;
    visibleWorkflows: readonly [string, ...string[]];
  },
): ToolDefinition {
  return defineTool({
    name: "delegate_workflow",
    description: "Delegate one visible workflow as a background task.",
    input: z.object({
      name: z.enum(input.visibleWorkflows),
      args: z.record(z.string(), z.unknown()).default({}),
    }),
    execute: async (args, ctx) => {
      const result = await service.delegateWorkflow({
        caller: { agentName: input.agentName },
        visibleWorkflows: input.visibleWorkflows,
        name: args.name,
        args: args.args as JsonObject,
      });
      ctx.backgroundTaskSupervisor.register({
        tag: { type: "workflow", id: result.workflowRunId },
        title: `workflow ${args.name}: ${result.workflowRunId}`,
        cancel: (reason) => result.handle.interrupt(reason ?? "workflow_cancelled"),
        done: result.handle.outcome().then(toBackgroundTaskOutcome),
        onCompletion: (outcome, { notifier }) => {
          notifier.publish(`workflow ${args.name} ${outcome.status}: ${outcome.outcome}`, {
            key: `workflow:${result.workflowRunId}`,
          });
        },
      });
      return { output: `workflow delegated: ${result.workflowRunId}` };
    },
  });
}

function toBackgroundTaskOutcome(outcome: WorkflowOutcome): BackgroundTaskOutcome {
  if (outcome.status === "success") {
    return { status: "success", outcome: JSON.stringify(outcome.output ?? {}) };
  }
  if (outcome.status === "cancelled") {
    return { status: "cancelled", outcome: outcome.reason };
  }
  return {
    status: "failed",
    outcome: outcome.status === "deadlocked" ? outcome.reason : outcome.reason ?? outcome.status,
  };
}

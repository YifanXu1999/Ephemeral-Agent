import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import type { AgenticWorkflowToolService } from "../../agentic-workflows/agentic-workflow-tool-service.js";

export function listWorkflowContextTool(
  service: AgenticWorkflowToolService,
  input: {
    agentName: string;
  },
): ToolDefinition {
  return defineTool({
    name: "list_workflow_context",
    description: "List context entries for a visible workflow run record.",
    input: z.object({
      workflow_record_id: z.string().min(1),
    }),
    execute: async (args) => {
      const listing = await service.listWorkflowContext({
        caller: { agentName: input.agentName },
        workflowRecordId: args.workflow_record_id,
      });
      return { output: { entries: listing.entries } };
    },
  });
}

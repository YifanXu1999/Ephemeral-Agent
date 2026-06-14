import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import type { AgenticWorkflowToolService } from "../../agentic-workflows/agentic-workflow-tool-service.js";

export function queryWorkflowContextTool(
  service: AgenticWorkflowToolService,
  input: {
    agentName: string;
  },
): ToolDefinition {
  return defineTool({
    name: "query_workflow_context",
    description: "Query context for a visible workflow run record.",
    input: z.object({
      workflow_record_id: z.string().min(1),
      query: z.object({ text: z.string().min(1) }).strict(),
    }),
    execute: async (args) => {
      const result = await service.queryWorkflowContext({
        caller: { agentName: input.agentName },
        workflowRecordId: args.workflow_record_id,
        query: args.query,
      });
      return { output: { results: result.results } };
    },
  });
}

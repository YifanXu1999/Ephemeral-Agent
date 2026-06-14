import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import type { AgenticWorkflowToolService } from "../../agentic-workflows/agentic-workflow-tool-service.js";
import type { ParticipantBindings } from "../../agentic-workflows/participant-binding.js";

export function listAgenticWorkflowDescriptionTool(
  service: AgenticWorkflowToolService,
  input: {
    visibleWorkflows: readonly [string, ...string[]];
  },
): ToolDefinition {
  return defineTool({
    name: "list_workflow_description",
    description: "List visible workflow names, descriptions, and participant targets.",
    input: z.object({
      name: z.enum(input.visibleWorkflows).optional(),
    }),
    execute: (args) => {
      const descriptions = service.listAgenticWorkflowDescription({
          visibleWorkflows: input.visibleWorkflows,
          ...(args.name !== undefined && { name: args.name }),
        });
      return Promise.resolve({
        output: descriptions.map((description) => ({
          name: description.name,
          type: description.type,
          description: description.description,
          participants: participantsOutput(description.participants),
        })),
      });
    },
  });
}

function participantsOutput(participants: ParticipantBindings): Record<string, { kind: "agent" | "workflow"; name: string; description?: string }> {
  return Object.fromEntries(
    Object.entries(participants).map(([role, node]) => [
      role,
      {
        kind: node.kind,
        name: node.name,
        ...(node.description !== undefined && { description: node.description }),
      },
    ]),
  );
}

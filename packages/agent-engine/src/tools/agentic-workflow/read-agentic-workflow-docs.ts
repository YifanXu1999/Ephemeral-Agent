import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import type { AgenticWorkflowToolService } from "../../agentic-workflows/agentic-workflow-tool-service.js";

export interface WorkflowDocsView {
  names(): readonly [string, ...string[]];
  docs(name: string): string;
}

/**
 * The provider-agnostic workflow tool: serves one profile-visible workflow's
 * full manual. Its `name` enum is generated from the view, so an agent cannot
 * request docs for a workflow it cannot use.
 */
export function readWorkflowDocs(view: WorkflowDocsView): ToolDefinition {
  return defineTool({
    name: "read_workflow_docs",
    description: "Read the full manual for one of this agent's available workflows.",
    input: z.object({ name: z.enum(view.names()) }),
    execute: (input) => Promise.resolve({ output: view.docs(input.name) }),
  });
}

export function readWorkflowDocsTool(
  service: AgenticWorkflowToolService,
  input: {
    visibleWorkflows: readonly [string, ...string[]];
  },
): ToolDefinition {
  return defineTool({
    name: "read_workflow_docs",
    description: "Read the full manual for one visible workflow.",
    input: z.object({ name: z.enum(input.visibleWorkflows) }),
    execute: (args) =>
      Promise.resolve({
        output: service.readWorkflowDocs({
          visibleWorkflows: input.visibleWorkflows,
          name: args.name,
        }),
      }),
  });
}

import type { JsonObject } from "@ephai/agent-core";
import type {
  WorkflowDefinition,
  WorkflowImplementation,
  WorkflowStateBase,
} from "@ephai/agent-core/agentic-workflows";
import type { z } from "zod";

export interface AgenticWorkflowModule<
  TArgs extends JsonObject = JsonObject,
  TState extends WorkflowStateBase = WorkflowStateBase,
> {
  type: string;
  argsSchema: z.ZodType<TArgs>;
  createImplementation(input: {
    workflowName: string;
    definition: WorkflowDefinition;
    args: TArgs;
  }): WorkflowImplementation<TState>;
}

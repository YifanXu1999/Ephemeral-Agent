import type { AgenticWorkflowModule } from "./agentic-workflow-module.js";

export {
  AgenticWorkflowFactory,
  type AgenticWorkflow,
  type AgenticWorkflowDescription,
  type AgenticWorkflowStartInput,
  type CreateAgenticWorkflowInput,
  noopAgenticWorkflowContextStore,
  workflowOutput,
  type AgenticWorkflowContextStore,
  type AgenticWorkflowToolCaller,
} from "./agentic-workflow-factory.js";
export {
  AgenticWorkflowToolService,
  allowAllAgenticWorkflowAccess,
  type AgenticWorkflowAccessPolicy,
  type DelegateAgenticWorkflowResult,
} from "./agentic-workflow-tool-service.js";
export type { AgenticWorkflowModule } from "./agentic-workflow-module.js";
export {
  composeAgenticWorkflowContextStores,
  loadAgenticWorkflowModules,
  type LoadedAgenticWorkflowModules,
} from "./agentic-workflow-loader.js";
export type {
  AgenticWorkflowConfig,
  ParticipantBinding,
  ParticipantBindings,
} from "./participant-binding.js";
export type {
  AgenticWorkflowContextListing,
  AgenticWorkflowContextQuery,
  AgenticWorkflowContextResult,
} from "./context-projection.js";
export { defineWorkflowImplementation } from "@ephai/agent-core/agentic-workflows";
export { z } from "zod";

export function defineAgenticWorkflow<T extends AgenticWorkflowModule>(module: T): T {
  return module;
}

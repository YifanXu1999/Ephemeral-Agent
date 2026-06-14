import type { JsonObject } from "@ephai/agent-core";
import type { ToolDefinition } from "@ephai/agent-core";

import { delegateWorkflowTool } from "../tools/agentic-workflow/delegate-agentic-workflow.js";
import { listWorkflowContextTool } from "../tools/agentic-workflow/list-agentic-workflow-context.js";
import { listAgenticWorkflowDescriptionTool } from "../tools/agentic-workflow/list-agentic-workflow-description.js";
import { queryWorkflowContextTool } from "../tools/agentic-workflow/query-agentic-workflow-context.js";
import { readWorkflowDocsTool } from "../tools/agentic-workflow/read-agentic-workflow-docs.js";
import type {
  CodingWorkflowRunHandle,
  AgenticWorkflowFactory,
  AgenticWorkflowContextListing,
  AgenticWorkflowContextQuery,
  AgenticWorkflowContextResult,
  AgenticWorkflowDescription,
  AgenticWorkflowToolCaller,
} from "./agentic-workflow-factory.js";

export interface DelegateAgenticWorkflowResult {
  workflowRunId: string;
  handle: CodingWorkflowRunHandle;
}

export interface AgenticWorkflowAccessPolicy {
  canAccess(input: {
    caller: AgenticWorkflowToolCaller;
    workflowRecordId: string;
  }): boolean | Promise<boolean>;
}

export const allowAllAgenticWorkflowAccess: AgenticWorkflowAccessPolicy = {
  canAccess: () => true,
};

export class AgenticWorkflowToolService {
  readonly #workflowFactory: () => AgenticWorkflowFactory;
  readonly #workflowAccess: AgenticWorkflowAccessPolicy;

  constructor(fields: {
    workflowFactory: () => AgenticWorkflowFactory;
    workflowAccess?: AgenticWorkflowAccessPolicy;
  }) {
    this.#workflowFactory = fields.workflowFactory;
    this.#workflowAccess = fields.workflowAccess ?? allowAllAgenticWorkflowAccess;
  }

  toolsForAgent(input: {
    agentName: string;
    visibleWorkflows: readonly [string, ...string[]];
  }): ToolDefinition[] {
    return [
      delegateWorkflowTool(this, input),
      listAgenticWorkflowDescriptionTool(this, input),
      readWorkflowDocsTool(this, input),
      listWorkflowContextTool(this, input),
      queryWorkflowContextTool(this, input),
    ];
  }

  canStartWorkflow(name: string): boolean {
    try {
      this.#workflowFactory().getWorkflow(name);
      return true;
    } catch {
      return false;
    }
  }

  async delegateWorkflow(input: {
    caller: AgenticWorkflowToolCaller;
    visibleWorkflows: readonly string[];
    name: string;
    args: JsonObject;
  }): Promise<DelegateAgenticWorkflowResult> {
    assertVisible(input.visibleWorkflows, input.name);
    const handle = await this.#workflowFactory()
      .createWorkflow({ workflowName: input.name, args: input.args })
      .start();
    return { workflowRunId: handle.workflowRunId, handle };
  }

  listAgenticWorkflowDescription(input: {
    visibleWorkflows: readonly string[];
    name?: string;
  }): AgenticWorkflowDescription[] {
    if (input.name !== undefined) assertVisible(input.visibleWorkflows, input.name);
    return this.#workflowFactory().description(
      input.name === undefined ? {} : { workflowName: input.name },
    );
  }

  readWorkflowDocs(input: {
    visibleWorkflows: readonly string[];
    name: string;
  }): string {
    assertVisible(input.visibleWorkflows, input.name);
    return this.#workflowFactory().readDocs({ workflowName: input.name });
  }

  async listWorkflowContext(input: {
    caller: AgenticWorkflowToolCaller;
    workflowRecordId: string;
  }): Promise<AgenticWorkflowContextListing> {
    await this.#assertCanAccess(input.caller, input.workflowRecordId);
    return this.#workflowFactory().listContext(input);
  }

  async queryWorkflowContext(input: {
    caller: AgenticWorkflowToolCaller;
    workflowRecordId: string;
    query: AgenticWorkflowContextQuery;
  }): Promise<AgenticWorkflowContextResult> {
    await this.#assertCanAccess(input.caller, input.workflowRecordId);
    return this.#workflowFactory().queryContext(input);
  }

  async #assertCanAccess(
    caller: AgenticWorkflowToolCaller,
    workflowRecordId: string,
  ): Promise<void> {
    if (await this.#workflowAccess.canAccess({ caller, workflowRecordId })) return;
    throw new Error(`workflow record "${workflowRecordId}" is not visible to this caller`);
  }
}

function assertVisible(visibleWorkflows: readonly string[], name: string): void {
  if (!visibleWorkflows.includes(name)) {
    throw new Error(`workflow "${name}" is not visible to this agent`);
  }
}

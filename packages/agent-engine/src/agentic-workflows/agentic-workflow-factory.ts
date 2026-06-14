import type { JsonObject, JsonValue } from "@ephai/agent-core";
import type {
  WorkflowDefinition,
  WorkflowOutcome,
  WorkflowRuntime,
  WorkflowRunEvent,
  WorkflowRunSnapshot,
  WorkflowSteer,
} from "@ephai/agent-core/agentic-workflows";

import type { AgentFactory } from "../agents/agent-factory.js";
import { NodeRunner } from "../nodes/node-runner.js";
import {
  bridgeWorkflowRun,
  type CodingWorkflowRunHandle,
  type NodeRunId,
  type NodeRunStore,
  type WorkflowRunId,
  type WorkflowRunStore,
} from "../runs/index.js";

import type {
  AgenticWorkflowConfig,
  ParticipantBindings,
} from "./participant-binding.js";
import type { AgenticWorkflowModule } from "./agentic-workflow-module.js";

export interface CreateAgenticWorkflowInput {
  workflowName: string;
  args?: JsonObject;
}

export interface AgenticWorkflowStartInput {
  args?: JsonObject;
  parentWorkflowRunId?: WorkflowRunId;
  parentNodeRunId?: NodeRunId;
}

export interface AgenticWorkflow {
  readonly name: string;
  readonly type: string;
  readonly definition: WorkflowDefinition;
  start(input?: AgenticWorkflowStartInput): Promise<CodingWorkflowRunHandle>;
}

export interface RegisteredAgenticWorkflow {
  readonly config: AgenticWorkflowConfig;
  readonly module: AgenticWorkflowModule;
}

export interface AgenticWorkflowDescription {
  name: string;
  type: string;
  description: string;
  participants: ParticipantBindings;
}

export interface AgenticWorkflowContextListing {
  entries: JsonObject[];
}

export interface AgenticWorkflowContextQuery {
  text: string;
}

export interface AgenticWorkflowContextResult {
  results: JsonObject[];
}

export interface AgenticWorkflowToolCaller {
  agentName: string;
  agentRunId?: string;
}

export interface AgenticWorkflowContextStore {
  listContext(input: {
    caller: AgenticWorkflowToolCaller;
    workflowRecordId: string;
  }): Promise<AgenticWorkflowContextListing>;
  queryContext(input: {
    caller: AgenticWorkflowToolCaller;
    workflowRecordId: string;
    query: AgenticWorkflowContextQuery;
  }): Promise<AgenticWorkflowContextResult>;
  projectInitialContext?(input: {
    workflowRunId: WorkflowRunId;
    workflowName: string;
    args: JsonObject;
    handle: CodingWorkflowRunHandle;
  }): Promise<void>;
}

export const noopAgenticWorkflowContextStore: AgenticWorkflowContextStore = {
  listContext: () => Promise.resolve({ entries: [] }),
  queryContext: () => Promise.resolve({ results: [] }),
};

export class AgenticWorkflowFactory {
  readonly #workflowRuntimeFactory: (nodeRunner: NodeRunner) => WorkflowRuntime;
  readonly #workflowRunStore: WorkflowRunStore;
  readonly #nodeRunStore: NodeRunStore;
  readonly #agentFactory: () => AgentFactory;
  readonly #configs: Map<string, AgenticWorkflowConfig>;
  readonly #modules: Map<string, AgenticWorkflowModule>;
  readonly #contextStore: AgenticWorkflowContextStore;

  constructor(fields: {
    workflowRuntimeFactory: (nodeRunner: NodeRunner) => WorkflowRuntime;
    workflowRunStore: WorkflowRunStore;
    nodeRunStore: NodeRunStore;
    agentFactory: () => AgentFactory;
    configs: readonly AgenticWorkflowConfig[];
    modules: readonly AgenticWorkflowModule[];
    contextStore?: AgenticWorkflowContextStore;
  }) {
    this.#workflowRuntimeFactory = fields.workflowRuntimeFactory;
    this.#workflowRunStore = fields.workflowRunStore;
    this.#nodeRunStore = fields.nodeRunStore;
    this.#agentFactory = fields.agentFactory;
    this.#configs = new Map(fields.configs.map((config) => [config.name, config]));
    this.#modules = new Map(fields.modules.map((module) => [module.type, module]));
    this.#contextStore = fields.contextStore ?? noopAgenticWorkflowContextStore;
  }

  createWorkflow(input: CreateAgenticWorkflowInput): AgenticWorkflow {
    const registered = this.getWorkflow(input.workflowName);
    const constructionArgs = mergeJsonObjects(
      configArgs(registered.config),
      input.args ?? {},
    );
    const parsedArgs = parseArgs(registered.module, constructionArgs);
    const definition = buildWorkflowDefinition(registered.config, parsedArgs);
    return {
      name: registered.config.name,
      type: registered.config.type,
      definition,
      start: (startInput = {}) =>
        this.#startWorkflow({
          registered,
          constructionArgs,
          definition,
          input: startInput,
        }),
    };
  }

  getWorkflow(workflowName: string): RegisteredAgenticWorkflow {
    const config = this.#configs.get(workflowName);
    if (config === undefined) {
      throw new Error(`unknown workflow "${workflowName}"`);
    }
    const module = this.#modules.get(config.type);
    if (module === undefined) {
      throw new Error(`workflow "${workflowName}" has no module for type "${config.type}"`);
    }
    return { config, module };
  }

  description(input: { workflowName?: string } = {}): AgenticWorkflowDescription[] {
    const configs =
      input.workflowName === undefined
        ? [...this.#configs.values()]
        : [this.getWorkflow(input.workflowName).config];
    return configs.map((config) => ({
      name: config.name,
      type: config.type,
      description: config.description,
      participants: config.participants,
    }));
  }

  readDocs(input: { workflowName: string }): string {
    return this.getWorkflow(input.workflowName).config.docs;
  }

  listContext(input: {
    caller: AgenticWorkflowToolCaller;
    workflowRecordId: string;
  }): Promise<AgenticWorkflowContextListing> {
    return this.#contextStore.listContext(input);
  }

  queryContext(input: {
    caller: AgenticWorkflowToolCaller;
    workflowRecordId: string;
    query: AgenticWorkflowContextQuery;
  }): Promise<AgenticWorkflowContextResult> {
    return this.#contextStore.queryContext(input);
  }

  async #startWorkflow(input: {
    registered: RegisteredAgenticWorkflow;
    constructionArgs: JsonObject;
    definition: WorkflowDefinition;
    input: AgenticWorkflowStartInput;
  }): Promise<CodingWorkflowRunHandle> {
    const args = mergeJsonObjects(input.constructionArgs, input.input.args ?? {});
    const parsedArgs = parseArgs(input.registered.module, args);
    const definition = buildWorkflowDefinition(input.registered.config, parsedArgs);
    const { workflowRunId } = await this.#workflowRunStore.create({
      workflowName: input.registered.config.name,
      ...(input.input.parentWorkflowRunId !== undefined && {
        parentWorkflowRunId: input.input.parentWorkflowRunId,
      }),
      ...(input.input.parentNodeRunId !== undefined && {
        parentNodeRunId: input.input.parentNodeRunId,
      }),
    });
    try {
      const implementation = input.registered.module.createImplementation({
        workflowName: input.registered.config.name,
        definition,
        args: parsedArgs,
      });
      const nodeRunner = new NodeRunner({
        workflowRunId,
        nodeRunStore: this.#nodeRunStore,
        agentFactory: this.#agentFactory,
        workflowFactory: () => this,
      });
      const runtime = this.#workflowRuntimeFactory(nodeRunner);
      const sdkHandle = await runtime.start({
        definition,
        implementation,
        args: parsedArgs,
      });
      const handle = await bridgeWorkflowRun({
        workflowRunId,
        sdkHandle,
        store: this.#workflowRunStore,
      });
      await this.#contextStore.projectInitialContext?.({
        workflowRunId,
        workflowName: input.registered.config.name,
        args: parsedArgs,
        handle,
      });
      return handle;
    } catch (error) {
      await this.#workflowRunStore.failStart({
        workflowRunId,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export type {
  CodingWorkflowRunHandle,
  WorkflowOutcome,
  WorkflowRunEvent,
  WorkflowRunSnapshot,
  WorkflowSteer,
};

function buildWorkflowDefinition(
  config: AgenticWorkflowConfig,
  args: JsonObject,
): WorkflowDefinition {
  const bindings = config.participants;
  return {
    description: config.description,
    nodes: Object.values(bindings),
    args,
    metadata: {
      workflowName: config.name,
      workflowType: config.type,
      nodeBindings: nodeBindingsToJson(bindings),
    },
  };
}

function configArgs(config: AgenticWorkflowConfig): JsonObject {
  return isJsonObject(config.args) ? config.args : {};
}

function parseArgs<TArgs extends JsonObject>(
  module: AgenticWorkflowModule<TArgs>,
  args: JsonObject,
): TArgs {
  return module.argsSchema.parse(args);
}

function mergeJsonObjects(base: JsonObject, override: JsonObject): JsonObject {
  return { ...base, ...override };
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function workflowOutput(outcome: WorkflowOutcome): JsonValue | undefined {
  return outcome.status === "success" ? outcome.output : undefined;
}

function nodeBindingsToJson(bindings: ParticipantBindings): JsonObject {
  const out: JsonObject = {};
  for (const [role, binding] of Object.entries(bindings)) {
    out[role] = {
      kind: binding.kind,
      name: binding.name,
      ...(binding.description !== undefined && { description: binding.description }),
    };
  }
  return out;
}

import { join } from "node:path";

import { createAgentRuntime } from "@ephai/agent-core";
import { createWorkflowRuntime } from "@ephai/agent-core/agentic-workflows";
import {
  type Agent,
  buildAgentFactory,
  createAgentOutcomeFnWithAdvisory,
  type AgentFactory,
} from "@ephai/agent-engine/agents";
import {
  AgenticWorkflowFactory,
  AgenticWorkflowToolService,
  loadAgenticWorkflowModules,
} from "@ephai/agent-engine/agentic-workflows";
import {
  JsonlAgentRunStore,
  JsonlNodeRunStore,
  JsonlWorkflowRunStore,
} from "@ephai/agent-engine/runs";
import { z } from "zod";

import { loadCodingAgentConfig } from "./config/load.js";
import { ephaiConfigRoot } from "./config/config-root.js";
import { SandboxService } from "./sandbox/service.js";
import { createSandboxTools } from "./tools/sandbox/index.js";

const MainOutcomeSchema = z.object({ summary: z.string().min(1) });
type MainOutcome = z.infer<typeof MainOutcomeSchema>;

const SUBMIT_MAIN_DESCRIPTION =
  "Finish the operator run by submitting its final outcome summary.";
const MAIN_ADVISOR_PROMPT =
  "Review whether the operator's terminal submission faithfully completes the user's goal.";

export interface CodingAgent {
  agents: AgentFactory;
  operator: Agent<MainOutcome>;
  agenticWorkflows: AgenticWorkflowFactory;
  agenticWorkflowTools: AgenticWorkflowToolService;
}

/**
 * The composition root: build each value once and wire only public SDK values.
 * Config parsing lives in the coding-agent package. The engine receives parsed
 * profiles, workflow configs, stores, and the sandbox tools as an injected
 * extra tool bundle.
 */
export async function bootstrap(configRoot: string = ephaiConfigRoot()): Promise<CodingAgent> {
  const cfg = loadCodingAgentConfig(configRoot);

  const agentRuntime = createAgentRuntime({
    llmClients: cfg.llmClients,
    hooks: cfg.hooks,
  });
  const agentRunStore = new JsonlAgentRunStore(cfg.recordsDir);
  const workflowRunStore = new JsonlWorkflowRunStore(join(cfg.recordsDir, "workflows"));
  const nodeRunStore = new JsonlNodeRunStore(join(cfg.recordsDir, "nodes"));
  const loadedWorkflows = await loadAgenticWorkflowModules(cfg.agenticWorkflows, {
    workflowRunStore,
  });

  // One process-level sandbox service owns gateway access and per-run bindings.
  // Bootstrap injects its narrow surfaces into workflow lifecycle and tools.
  const sandbox = new SandboxService();

  const agentFactoryRef: { current?: AgentFactory } = {};
  const workflows = new AgenticWorkflowFactory({
    workflowRuntimeFactory: (nodeRunner) => createWorkflowRuntime({ nodeRunner }),
    workflowRunStore,
    nodeRunStore,
    agentFactory: () => {
      if (agentFactoryRef.current === undefined) {
        throw new Error("agent factory is not initialized");
      }
      return agentFactoryRef.current;
    },
    configs: cfg.agenticWorkflows,
    modules: loadedWorkflows.modules,
    contextStore: loadedWorkflows.contextStore,
  });
  const workflowTools = new AgenticWorkflowToolService({
    workflowFactory: () => workflows,
  });

  const agents = buildAgentFactory({
    agentRuntime,
    profiles: cfg.profiles,
    agentRunStore,
    agentHooks: cfg.agentHooks,
    agenticWorkflowToolService: workflowTools,
    extraTools: ({ agentRunId }) => createSandboxTools(sandbox, agentRunId),
  });
  agentFactoryRef.current = agents;

  const mainOutcomeFn = createAgentOutcomeFnWithAdvisory({
    name: "submit_main_outcome",
    description: SUBMIT_MAIN_DESCRIPTION,
    schema: MainOutcomeSchema,
    advisoryPrompt: MAIN_ADVISOR_PROMPT,
  });

  const operator = agents.create("operator", mainOutcomeFn);
  return {
    agents,
    operator,
    agenticWorkflows: workflows,
    agenticWorkflowTools: workflowTools,
  };
}

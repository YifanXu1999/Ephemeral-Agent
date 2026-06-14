import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentOutcome, JsonObject } from "@ephai/agent-core";
import { createWorkflowRuntime, defineWorkflowImplementation } from "@ephai/agent-core/agentic-workflows";
import type { WorkflowNodeDispatch, WorkflowNodeSettlement } from "@ephai/agent-core/nodes";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Agent, AgentFactory, CreateAgentInput } from "../../src/agents/index.js";
import {
  AgenticWorkflowFactory,
  type AgenticWorkflowConfig,
  type AgenticWorkflowModule,
} from "../../src/agentic-workflows/index.js";
import {
  JsonlNodeRunStore,
  JsonlWorkflowRunStore,
  type AgentRunHandle,
} from "../../src/runs/index.js";

interface DemoState {
  version: number;
  is_workflow_done: boolean;
  workflow_status: "running" | "success" | "failure" | "deadlocked";
  dispatched: boolean;
  summary: string | null;
}

const DemoPayload = z.strictObject({ summary: z.string().min(1) });

const demoModule: AgenticWorkflowModule<{ goal: string }> = {
  type: "demo",
  argsSchema: z.strictObject({ goal: z.string().min(1) }),
  createImplementation: ({ args }) =>
    defineWorkflowImplementation<DemoState, WorkflowNodeSettlement<z.infer<typeof DemoPayload>>>({
      createInitialState: () => ({
        version: 0,
        is_workflow_done: false,
        workflow_status: "running",
        dispatched: false,
        summary: null,
      }),
      dispatch: ({ state }): WorkflowNodeDispatch<z.infer<typeof DemoPayload>>[] => {
        if (state.dispatched) return [];
        return [{
          start: {
            node: { kind: "agent", name: "worker" },
            input: {
              messages: [{
                role: "user",
                content: [{ type: "text", text: args.goal }],
              }],
            },
            outcome: {
              name: "submit_demo_result",
              description: "Submit the demo result.",
              schema: DemoPayload,
            },
          },
          metadata: { role: "worker" },
        }];
      },
      validateNodeSettlement: () => ({ ok: true }),
      applyNodeSettlement: ({ state, settlement }) => {
        if (settlement.status !== "completed") {
          return {
            state: {
              ...state,
              version: state.version + 1,
              is_workflow_done: true,
              workflow_status: "failure",
            },
            transition: { type: "worker_failed" },
          };
        }
        return {
          state: {
            ...state,
            version: state.version + 1,
            dispatched: true,
            summary: settlement.accepted.outcome.summary,
          },
          transition: { type: "worker_completed" },
        };
      },
      evaluateWorkflowProgress: ({ state }) => {
        if (state.summary === null) return { state };
        return {
          state: {
            ...state,
            version: state.version + 1,
            is_workflow_done: true,
            workflow_status: "success",
          },
          transition: { type: "demo_done" },
        };
      },
      deadlock: ({ state }) =>
        state.is_workflow_done ? null : { reason: "waiting for worker" },
      getWorkflowOutcome: (state) =>
        state.workflow_status === "success"
          ? { status: "success", output: { summary: state.summary } }
          : null,
    }),
};

describe("AgenticWorkflowFactory", () => {
  it("starts a configured agentic workflow through the run-scoped NodeRunner", async () => {
    const root = mkdtempSync(join(tmpdir(), "ephai-agentic-workflow-factory-"));
    const workflowFactory = new AgenticWorkflowFactory({
      workflowRuntimeFactory: (nodeRunner) => createWorkflowRuntime({ nodeRunner }),
      workflowRunStore: new JsonlWorkflowRunStore(join(root, "workflows")),
      nodeRunStore: new JsonlNodeRunStore(join(root, "nodes")),
      agentFactory: () => fakeAgentFactory({ summary: "built demo" }),
      configs: [demoConfig()],
      modules: [demoModule],
    });

    const workflow = workflowFactory.createWorkflow({
      workflowName: "demo_flow",
      args: { goal: "ship it" },
    });
    const run = await workflow.start();

    await expect(run.outcome()).resolves.toEqual({
      status: "success",
      output: { summary: "built demo" },
    });
    expect(run.workflowRunId).toMatch(/^workflow-/);
    expect(run.snapshot().definitionMetadata).toMatchObject({
      workflowName: "demo_flow",
      workflowType: "demo",
    });
  });
});

function demoConfig(): AgenticWorkflowConfig {
  return {
    name: "demo_flow",
    type: "demo",
    module: "./workflow.mjs",
    description: "Demo workflow.",
    args: {},
    docs: "Demo docs.",
    participants: {
      worker: { kind: "agent", name: "worker" },
    },
    tools: ["delegate_workflow"],
  };
}

function fakeAgentFactory(output: JsonObject): AgentFactory {
  return {
    createAgent<T = string>(input: CreateAgentInput<T>): Agent<T> {
      return this.create(input.agentName);
    },
    create<T = string>(): Agent<T> {
      return {
        start: () => Promise.resolve(fakeRunHandle(output as T)),
      };
    },
    getAgentProfile: (agentName) => ({
      name: agentName,
      llm_client_id: "test",
      allowed_tools: [],
      agentic_workflows: [],
      subagents: [],
      system_prompt: "test",
      source_path: `${agentName}.md`,
    }),
  };
}

function fakeRunHandle<T>(outcome: T): AgentRunHandle<T> {
  return {
    agentRunId: "agent-test" as AgentRunHandle<T>["agentRunId"],
    steer: () => false,
    interrupt: () => undefined,
    outcome: () => Promise.resolve(completed(outcome)),
    events: () => emptyEvents(),
    backgroundTaskSupervisor: {} as AgentRunHandle<T>["backgroundTaskSupervisor"],
    notifier: { publish: () => undefined },
  };
}

function completed<T>(outcome: T): AgentOutcome<T> {
  return {
    status: "completed",
    outcome,
    turns: 1,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

async function* emptyEvents(): ReturnType<AgentRunHandle["events"]> {
  yield* [];
  await Promise.resolve();
}

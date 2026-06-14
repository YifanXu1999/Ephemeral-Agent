import type { JsonValue } from "@ephai/agent-core";
import type {
  NodeLaunchRequest,
  NodeRunEvent,
  NodeRunHandle,
  NodeSettlement,
} from "@ephai/agent-core/nodes";
import type { WorkflowOutcome, WorkflowRunEvent } from "@ephai/agent-core/agentic-workflows";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AgentFactory } from "../../src/agents/index.js";
import { NodeRunner } from "../../src/nodes/node-runner.js";
import {
  nodeRunIdFrom,
  type CreateNodeRunInput,
  type NodeRunId,
  type NodeRunStore,
  type WorkflowRunId,
  type CodingWorkflowRunHandle,
  workflowRunIdFrom,
} from "../../src/runs/index.js";
import type {
  AgenticWorkflow,
  AgenticWorkflowFactory,
  AgenticWorkflowStartInput,
  CreateAgenticWorkflowInput,
} from "../../src/agentic-workflows/index.js";

const WorkflowResult = z.strictObject({ summary: z.string().min(1) });

describe("NodeRunner", () => {
  it("launches workflow nodes with parent context and records node events", async () => {
    const parentWorkflowRunId = workflowRunIdFrom("workflow-parent");
    const delegatedWorkflowRunId = workflowRunIdFrom("workflow-delegated");
    const store = new RecordingNodeRunStore(nodeRunIdFrom("node-workflow"));
    const starts: AgenticWorkflowStartInput[] = [];
    const creates: CreateAgenticWorkflowInput[] = [];
    const delegatedWorkflowRun = workflowRunHandle({
      workflowRunId: delegatedWorkflowRunId,
      outcome: { status: "success", output: { summary: "done" } },
    });
    const workflowFactory = workflowFactoryFor({
      creates,
      starts,
      run: delegatedWorkflowRun,
    });
    const completionSubmissions: JsonValue[] = [];
    const runner = new NodeRunner({
      workflowRunId: parentWorkflowRunId,
      nodeRunStore: store,
      agentFactory: unusedAgentFactory,
      workflowFactory,
    });

    const handle = await runner.launch({
      start: {
        node: { kind: "workflow", name: "planning_workflow" },
        input: { args: { goal: "ship" } },
        outcome: {
          name: "submit_planning_workflow_result",
          description: "Submit delegated workflow result.",
          schema: WorkflowResult,
        },
      },
      metadata: { role: "planner", attempt: 1 },
      completion: {
        submit: (payload) => {
          completionSubmissions.push(payload);
          return Promise.resolve({
            accept: {
              outcomeName: "submit_planning_workflow_result",
              outcome: payload,
            },
          });
        },
      },
    } satisfies NodeLaunchRequest<z.infer<typeof WorkflowResult>>);

    await expect(handle.settlement()).resolves.toEqual({
      status: "completed",
      outcome: {
        outcomeName: "submit_planning_workflow_result",
        outcome: { summary: "done" },
      },
    });
    expect(creates).toEqual([
      { workflowName: "planning_workflow", args: { goal: "ship" } },
    ]);
    expect(starts).toEqual([
      {
        parentWorkflowRunId,
        parentNodeRunId: nodeRunIdFrom("node-workflow"),
      },
    ]);
    expect(completionSubmissions).toEqual([{ summary: "done" }]);
    expect(store.created).toEqual([
      {
        workflowRunId: parentWorkflowRunId,
        nodeKind: "workflow",
        nodeName: "planning_workflow",
        metadata: { role: "planner", attempt: 1 },
      },
    ]);
    expect(store.registered?.snapshot().metadata).toEqual({ role: "planner", attempt: 1 });
    expect(store.events.map((event) => event.type)).toEqual([
      "node_started",
      "node_outcome_submitted",
      "node_settled",
    ]);
    expect(store.finished).toEqual({
      status: "completed",
      outcome: {
        outcomeName: "submit_planning_workflow_result",
        outcome: { summary: "done" },
      },
    });
  });
});

class RecordingNodeRunStore implements NodeRunStore {
  readonly created: CreateNodeRunInput[] = [];
  readonly events: NodeRunEvent[] = [];
  readonly #nodeRunId: NodeRunId;
  registered?: NodeRunHandle;
  finished?: NodeSettlement;

  constructor(nodeRunId: NodeRunId) {
    this.#nodeRunId = nodeRunId;
  }

  create(input: CreateNodeRunInput): Promise<{ nodeRunId: NodeRunId }> {
    this.created.push(input);
    return Promise.resolve({ nodeRunId: this.#nodeRunId });
  }

  registerHandle(input: { nodeRunId: NodeRunId; handle: NodeRunHandle }): Promise<void> {
    expect(input.nodeRunId).toBe(this.#nodeRunId);
    this.registered = input.handle;
    return Promise.resolve();
  }

  appendEvent(input: { nodeRunId: NodeRunId; event: NodeRunEvent }): Promise<void> {
    expect(input.nodeRunId).toBe(this.#nodeRunId);
    this.events.push(input.event);
    return Promise.resolve();
  }

  finish(input: { nodeRunId: NodeRunId; settlement: NodeSettlement }): Promise<void> {
    expect(input.nodeRunId).toBe(this.#nodeRunId);
    this.finished = input.settlement;
    return Promise.resolve();
  }

  failStart(): Promise<void> {
    throw new Error("start should not fail");
  }

  readEvents(): Promise<{ total: number; lines: string[]; eof: boolean }> {
    return Promise.resolve({ total: this.events.length, lines: [], eof: true });
  }
}

function workflowFactoryFor(input: {
  creates: CreateAgenticWorkflowInput[];
  starts: AgenticWorkflowStartInput[];
  run: CodingWorkflowRunHandle;
}): () => AgenticWorkflowFactory {
  const partial = {
    createWorkflow(createInput: CreateAgenticWorkflowInput): AgenticWorkflow {
      input.creates.push(createInput);
      return {
        name: createInput.workflowName,
        type: "test_workflow",
        definition: {
          description: "test workflow",
          nodes: [{ kind: "workflow", name: createInput.workflowName }],
        },
        start: (startInput = {}) => {
          input.starts.push(startInput);
          return Promise.resolve(input.run);
        },
      };
    },
  };
  // NodeRunner only uses createWorkflow; the real factory carries private state.
  return () => partial as unknown as AgenticWorkflowFactory;
}

function workflowRunHandle(input: {
  workflowRunId: WorkflowRunId;
  outcome: WorkflowOutcome;
}): CodingWorkflowRunHandle {
  return {
    workflowRunId: input.workflowRunId,
    definition: { description: "delegated workflow", nodes: [] },
    outcome: () => Promise.resolve(input.outcome),
    events: () => emptyWorkflowEvents(),
    snapshot: () => ({
      state: {},
      runningNodes: [],
      finishedNodes: [],
      snapshots: [],
      timeline: [],
    }),
    steer: () => ({ accepted: false, reason: "unsupported" }),
    interrupt: () => Promise.resolve(),
  };
}

async function* emptyWorkflowEvents(): AsyncIterable<WorkflowRunEvent> {
  for (const event of [] as WorkflowRunEvent[]) yield event;
  await Promise.resolve();
}

function unusedAgentFactory(): AgentFactory {
  throw new Error("agent factory should not be used by workflow-node launch");
}

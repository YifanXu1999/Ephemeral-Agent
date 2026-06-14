import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonObject } from "@ephai/agent-core";
import { FakeNodeRunner } from "@ephai/agent-core/testkit";
import {
  createWorkflowRuntime,
  type WorkflowDefinition,
  type WorkflowRunHandle,
} from "@ephai/agent-core/agentic-workflows";
import {
  loadAgenticWorkflowModules,
  type AgenticWorkflowConfig,
  type AgenticWorkflowContextStore,
  type AgenticWorkflowModule,
} from "@ephai/agent-engine/agentic-workflows";
import {
  workflowRunIdFrom,
  type CodingWorkflowRunHandle,
  type WorkflowRunId,
} from "@ephai/agent-engine/runs";

const definition: WorkflowDefinition = {
  description: "Pursuit workflow test",
  nodes: [
    { kind: "agent", name: "planner_agent" },
    { kind: "agent", name: "worker_agent" },
  ],
  metadata: {
    workflowName: "pursuit",
    workflowType: "pursuit",
    nodeBindings: {
      planner: { kind: "agent", name: "planner_agent" },
      worker: { kind: "agent", name: "worker_agent" },
    },
  },
};

describe("pursuitModule", () => {
  it("runs planner and dependency-ordered workers to success", async () => {
    const runner = new FakeNodeRunner();
    const run = await createRun(runner, { pursuit_goal: "ship graph", max_attempts: 2 });

    expect(roles(runner)).toEqual(["planner"]);
    await runner.complete("planner_agent", plannerPayload({
      work_items: [workItem("base"), workItem("dependent", ["base"])],
    }));

    expect(roles(runner)).toEqual(["planner", "worker"]);
    expect(runner.launches[1]?.metadata).toMatchObject({
      role: "worker",
      work_item_id: "base",
    });

    await runner.complete("worker_agent", workerPayload({ summary: "base done" }));
    expect(runner.launches[2]?.metadata).toMatchObject({
      role: "worker",
      work_item_id: "dependent",
    });

    await runner.complete("worker_agent", workerPayload({ summary: "dependent done" }));

    await expect(run.outcome()).resolves.toMatchObject({
      status: "success",
      output: { summary: "planned the leg" },
    });
  });

  it("rejects dynamic refocus in predefined leg mode without materializing work", async () => {
    const runner = new FakeNodeRunner();
    await createRun(runner, {
      pursuit_goal: "ship all",
      leg_goals: ["parser", "printer"],
      max_attempts: 2,
    });

    await expect(
      runner.complete("planner_agent", plannerPayload({ leg_goal: "new parser" })),
    ).resolves.toEqual({
      reject: "predefined leg goals cannot be refocused or declare next_leg_goal",
    });
    expect(roles(runner)).toEqual(["planner"]);
  });

  it("keeps local context listing and query backed by the latest snapshot", async () => {
    const runner = new FakeNodeRunner();
    const loaded = await loadPursuitWorkflow();
    const run = await createRunWithModule(
      runner,
      { pursuit_goal: "ship context", max_attempts: 1 },
      loaded.module,
    );
    const store = loaded.contextStore;
    const workflowRunId = workflowRunIdFrom("workflow-pursuit-test");
    await store.projectInitialContext?.({
      workflowRunId,
      workflowName: "pursuit",
      args: { pursuit_goal: "ship context", max_attempts: 1 },
      handle: codingHandle(workflowRunId, run),
    });

    await runner.complete("planner_agent", plannerPayload({
      work_items: [workItem("broken")],
    }));
    await runner.complete("worker_agent", workerPayload({
      is_pass: false,
      summary: "boom",
      outcome: "root failed",
    }));

    const listing = await store.listContext({
      caller: { agentName: "operator" },
      workflowRecordId: workflowRunId,
    });
    expect(
      listing.entries.some((entry) =>
        typeof entry.path === "string" && entry.path.endsWith("/goal.md"),
      ),
    ).toBe(true);

    const query = await store.queryContext({
      caller: { agentName: "operator" },
      workflowRecordId: workflowRunId,
      query: { text: "boom" },
    });
    expect(
      query.results.some((result) =>
        stringField(result, "path").includes("failure_reasons.md") &&
        stringField(result, "snippet").includes("boom"),
      ),
    ).toBe(true);
    expect(
      query.results.some((result) =>
        stringField(result, "path").includes("summary.md") &&
        stringField(result, "snippet").includes("boom"),
      ),
    ).toBe(true);
  });

  it("recovers context from a durable latest snapshot without a live handle", async () => {
    const runner = new FakeNodeRunner();
    const loaded = await loadPursuitWorkflow();
    const run = await createRunWithModule(
      runner,
      { pursuit_goal: "ship recovery", max_attempts: 1 },
      loaded.module,
    );
    await runner.complete("planner_agent", plannerPayload({
      work_items: [workItem("broken")],
    }));
    await runner.complete("worker_agent", workerPayload({
      is_pass: false,
      summary: "persisted boom",
      outcome: "root failed",
    }));

    const workflowRunId = workflowRunIdFrom("workflow-pursuit-recovered");
    const recovered = await loadPursuitWorkflow({
      workflowRunStore: {
        readLatestSnapshot: () => Promise.resolve(run.snapshot()),
      },
    });

    const query = await recovered.contextStore.queryContext({
      caller: { agentName: "operator" },
      workflowRecordId: workflowRunId,
      query: { text: "persisted boom" },
    });
    expect(
      query.results.some((result) =>
        stringField(result, "path").includes("summary.md") &&
        stringField(result, "snippet").includes("persisted boom"),
      ),
    ).toBe(true);
  });
});

async function createRun(runner: FakeNodeRunner, args: PursuitArgs): Promise<WorkflowRunHandle> {
  const loaded = await loadPursuitWorkflow();
  return createRunWithModule(runner, args, loaded.module);
}

async function createRunWithModule(
  runner: FakeNodeRunner,
  args: PursuitArgs,
  module: AgenticWorkflowModule<PursuitArgs>,
): Promise<WorkflowRunHandle> {
  const runtime = createWorkflowRuntime({ nodeRunner: runner });
  return runtime.start({
    definition,
    implementation: module.createImplementation({
      workflowName: "pursuit",
      definition,
      args,
    }),
    args,
  });
}

type PursuitArgs = JsonObject & {
  pursuit_goal: string;
  leg_goals?: [string, ...string[]];
  max_attempts: number;
};

type WorkerOutcomePayload = JsonObject & {
  summary: string;
  is_pass: boolean;
  outcome: string;
};

async function loadPursuitWorkflow(
  options?: Parameters<typeof loadAgenticWorkflowModules>[1],
): Promise<{
  module: AgenticWorkflowModule<PursuitArgs>;
  contextStore: AgenticWorkflowContextStore;
}> {
  const loaded = await loadAgenticWorkflowModules([pursuitConfig()], options);
  const module = loaded.modules[0];
  return {
    module: module as AgenticWorkflowModule<PursuitArgs>,
    contextStore: loaded.contextStore,
  };
}

function pursuitConfig(): AgenticWorkflowConfig {
  return {
    name: "pursuit",
    type: "pursuit",
    module: resolve(".ephai/agentic-workflows/pursuit/workflow.mjs"),
    description: "Delegate a multi-leg coding pursuit.",
    args: { max_attempts: 2 },
    docs: "Pursuit test.",
    participants: {
      planner: { kind: "agent", name: "planner_agent" },
      worker: { kind: "agent", name: "worker_agent" },
    },
    tools: ["delegate_pursuit"],
  };
}

function roles(runner: FakeNodeRunner): unknown[] {
  return runner.launches.map((launch) => launch.metadata?.role);
}

function plannerPayload(
  overrides: Partial<{
    summary: string;
    leg_goal: string;
    next_leg_goal: string;
    work_items: ReturnType<typeof workItem>[];
  }> = {},
) {
  return {
    summary: "planned the leg",
    work_items: [workItem("w1")],
    ...overrides,
  };
}

function workItem(id: string, dependsOn: readonly string[] = []) {
  return {
    id,
    agent_name: "worker",
    title: `item ${id}`,
    spec: `spec ${id}`,
    depends_on: [...dependsOn],
  };
}

function workerPayload(overrides: Partial<WorkerOutcomePayload> = {}): WorkerOutcomePayload {
  return {
    summary: "done",
    is_pass: true,
    outcome: "implemented",
    ...overrides,
  };
}

function codingHandle(
  workflowRunId: WorkflowRunId,
  handle: WorkflowRunHandle,
): CodingWorkflowRunHandle {
  return {
    workflowRunId,
    definition: handle.definition,
    outcome: () => handle.outcome(),
    events: () => handle.events(),
    snapshot: () => handle.snapshot(),
    steer: (input: Parameters<WorkflowRunHandle["steer"]>[0]) => handle.steer(input),
    interrupt: (reason: Parameters<WorkflowRunHandle["interrupt"]>[0]) =>
      handle.interrupt(reason),
  };
}

function stringField(record: JsonObject, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

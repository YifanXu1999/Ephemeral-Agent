import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonObject } from "@ephai/agent-core";
import { FakeNodeRunner } from "@ephai/agent-core/testkit";
import { createWorkflowRuntime, type WorkflowDefinition } from "@ephai/agent-core/agentic-workflows";
import {
  loadAgenticWorkflowModules,
  type AgenticWorkflowConfig,
  type AgenticWorkflowModule,
} from "@ephai/agent-engine/agentic-workflows";

const definition: WorkflowDefinition = {
  description: "Ralph loop test",
  nodes: [{ kind: "agent", name: "general_agent" }],
  metadata: {
    workflowName: "ralph_loop",
    workflowType: "ralph_loop",
    nodeBindings: {
      planner: { kind: "agent", name: "general_agent" },
      reviewer: { kind: "agent", name: "general_agent" },
      critic: { kind: "agent", name: "general_agent" },
    },
  },
};

describe("ralphLoopModule", () => {
  it("runs planner, reviewer, and critic to success", async () => {
    const runner = new FakeNodeRunner();
    const run = await createRun(runner, { max_attempts: 3 });

    expect(roles(runner)).toEqual(["planner"]);
    await runner.complete("general_agent", plannerPayload({ pass: true }));
    expect(roles(runner)).toEqual(["planner", "reviewer"]);

    await runner.complete("general_agent", reviewerPayload({ pass: true }));
    expect(roles(runner)).toEqual(["planner", "reviewer", "critic"]);

    await runner.complete("general_agent", criticPayload({ pass: true }));

    await expect(run.outcome()).resolves.toEqual({
      status: "success",
      output: {
        planner_summary: "planned",
        reviewer_summary: "reviewed",
        critic_summary: "criticized",
      },
    });
  });

  it("retries from planner when a phase returns pass false", async () => {
    const runner = new FakeNodeRunner();
    const run = await createRun(runner, { max_attempts: 2 });

    await runner.complete("general_agent", plannerPayload({ pass: true }));
    await runner.complete("general_agent", reviewerPayload({ pass: false, summary: "not enough" }));

    expect(roles(runner)).toEqual(["planner", "reviewer", "planner"]);
    expect(runner.launches[2]?.metadata).toMatchObject({ role: "planner", attempt: 2 });

    await runner.complete("general_agent", plannerPayload({ pass: true, summary: "planned retry" }));
    await runner.complete("general_agent", reviewerPayload({ pass: true }));
    await runner.complete("general_agent", criticPayload({ pass: true }));

    await expect(run.outcome()).resolves.toMatchObject({ status: "success" });
  });

  it("fails after max attempts", async () => {
    const runner = new FakeNodeRunner();
    const run = await createRun(runner, { max_attempts: 1 });

    await runner.complete("general_agent", plannerPayload({ pass: false, summary: "bad plan" }));

    await expect(run.outcome()).resolves.toEqual({
      status: "failure",
      reason: "ralph failed after 1 attempt(s)",
      output: {
        attempts: 1,
        failures: ["planner failed: bad plan"],
      },
    });
    expect(roles(runner)).toEqual(["planner"]);
  });
});

async function createRun(runner: FakeNodeRunner, args: RalphArgs) {
  const module = await loadRalphLoopModule();
  const runtime = createWorkflowRuntime({ nodeRunner: runner });
  return runtime.start({
    definition,
    implementation: module.createImplementation({
      workflowName: "ralph_loop",
      definition,
      args,
    }),
    args,
  });
}

type RalphArgs = JsonObject & { max_attempts: number };

async function loadRalphLoopModule(): Promise<AgenticWorkflowModule<RalphArgs>> {
  const loaded = await loadAgenticWorkflowModules([ralphConfig()]);
  const module = loaded.modules[0];
  return module as AgenticWorkflowModule<RalphArgs>;
}

function ralphConfig(): AgenticWorkflowConfig {
  return {
    name: "ralph_loop",
    type: "ralph_loop",
    module: resolve(".ephai/agentic-workflows/ralph_loop/workflow.mjs"),
    description: "Sequential planner, reviewer, critic retry loop.",
    args: { max_attempts: 3 },
    docs: "Ralph loop test.",
    participants: {
      planner: { kind: "agent", name: "general_agent" },
      reviewer: { kind: "agent", name: "general_agent" },
      critic: { kind: "agent", name: "general_agent" },
    },
    tools: ["delegate_ralph_loop"],
  };
}

function roles(runner: FakeNodeRunner): unknown[] {
  return runner.launches.map((launch) => launch.metadata?.role);
}

function plannerPayload(overrides: Partial<{ pass: boolean; plan: string; summary: string }> = {}) {
  return {
    pass: true,
    plan: "build it",
    summary: "planned",
    ...overrides,
  };
}

function reviewerPayload(overrides: Partial<{ pass: boolean; review: string; summary: string }> = {}) {
  return {
    pass: true,
    review: "looks sound",
    summary: "reviewed",
    ...overrides,
  };
}

function criticPayload(overrides: Partial<{ pass: boolean; verdict: string; summary: string }> = {}) {
  return {
    pass: true,
    verdict: "ship",
    summary: "criticized",
    ...overrides,
  };
}

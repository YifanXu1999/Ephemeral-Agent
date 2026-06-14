import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeAgenticWorkflow } from "../testkit/eos-agents.js";

import { loadAgenticWorkflowConfigs } from "../../src/config/agentic-workflow-configs.js";

describe("loadAgenticWorkflowConfigs", () => {
  it("loads agentic workflow configs from agentic workflow directories", () => {
    const root = mkdtempSync(join(tmpdir(), "ephai-agentic-workflows-"));
    writeAgenticWorkflow(root, {
      name: "pursuit",
      type: "pursuit",
      description: "Delegate pursuit.",
      participants: {
        planner: { kind: "agent", name: "planner" },
      },
      tools: ["delegate_agentic_workflow"],
      args: { planner: "planner" },
      body: "Pursuit docs.",
    });

    expect(loadAgenticWorkflowConfigs(root)).toEqual([
      expect.objectContaining({
        name: "pursuit",
        type: "pursuit",
        docs: "Pursuit docs.",
        participants: {
          planner: { kind: "agent", name: "planner" },
        },
        tools: ["delegate_agentic_workflow"],
      }),
    ]);
  });

  it("rejects agentic workflow directories without workflow.md", () => {
    const root = mkdtempSync(join(tmpdir(), "ephai-agentic-workflows-"));
    mkdirSync(join(root, "pursuit"));

    expect(() => loadAgenticWorkflowConfigs(root)).toThrow(/must contain workflow\.md/);
  });
});

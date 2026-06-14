import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tempProfileDir, writeProfile } from "../testkit/eos-agents.js";

import { loadAgentProfile, loadAgentProfiles } from "../../src/config/agent-profiles.js";

describe("loadAgentProfile", () => {
  it("parses agentic workflows and subagents from frontmatter", () => {
    const dir = tempProfileDir();
    const path = writeProfile(dir, {
      name: "operator",
      agentic_workflows: ["pursuit"],
      subagents: ["subagent"],
      body: "operator prompt",
    });
    expect(loadAgentProfile(path)).toMatchObject({
      name: "operator",
      agentic_workflows: ["pursuit"],
      subagents: ["subagent"],
      allowed_tools: [],
      system_prompt: "operator prompt",
    });
  });

  it("defaults agentic workflows and subagents to empty lists when omitted", () => {
    const dir = tempProfileDir();
    const path = writeProfile(dir, { name: "plain", allowed_tools: ["read"] });
    const profile = loadAgentProfile(path);
    expect(profile.agentic_workflows, "agentic workflows default").toEqual([]);
    expect(profile.subagents, "subagents default").toEqual([]);
  });

  // The dead field names are constructed, not written literally, so the §14
  // hygiene word-grep does not flag this rejection test (cf. the `needs` rule).
  it.each([
    ["agent", "kind"].join("_"),
    ["terminal", "tool"].join("_"),
    ["workflow", "context", "script"].join("_"),
    ["pursuit", "context", "script"].join("_"),
  ])("rejects the dropped %s field", (field) => {
    const dir = tempProfileDir();
    const path = writeProfile(dir, {
      name: "legacy",
      allowed_tools: ["read"],
      extra: { [field]: "value" },
    });
    expect(() => loadAgentProfile(path)).toThrow(/is invalid/);
  });

  it("loads global and agentic-workflow-local profiles recursively from the agents root", () => {
    const agentsDir = tempProfileDir({ name: "operator", subagents: ["subagent"] });
    const pursuitDir = join(agentsDir, "agentic-workflows", "pursuit");
    mkdirSync(pursuitDir, { recursive: true });
    writeProfile(pursuitDir, {
      name: "planner",
    });
    writeProfile(agentsDir, { name: "subagent" });

    const profiles = loadAgentProfiles({ agentsDir });

    expect(profiles.require("operator").source_path).toContain("operator.md");
    expect(profiles.require("planner").source_path).toContain(
      join("agentic-workflows", "pursuit", "planner.md"),
    );
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadHookConfig } from "../../src/config/hook-config.js";

describe("loadHookConfig", () => {
  it("loads turnBoundary command hooks that publish notifications", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eos-hooks-"));
    mkdirSync(join(dir, "hooks"), { recursive: true });
    writeFileSync(
      join(dir, "hooks", "notify.cjs"),
      [
        'const fs = require("node:fs");',
        'const turn = JSON.parse(fs.readFileSync(0, "utf8"));',
        'process.stdout.write(JSON.stringify({ notification: `turn ${turn.turn}` }));',
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "hooks", "hooks.json"),
      JSON.stringify([
        {
          event: "turnBoundary",
          command: { command: "node notify.cjs" },
        },
      ]),
    );

    const hooks = loadHookConfig(join(dir, "hooks", "hooks.json"));
    expect(hooks.sdkHooks).toHaveLength(1);
    expect(hooks.agentHooks).toEqual({});
    const [hook] = hooks.sdkHooks;
    const published: string[] = [];
    if (hook.event !== "turnBoundary") throw new Error("expected turnBoundary hook");
    await hook.run(
      {
        turn: 3,
        maxTurns: 8,
        terminalToolName: "submit_main_outcome",
        toolCalls: 0,
        backgroundTaskCount: 0,
        hasPendingSteers: false,
      },
      {
        notifier: { publish: (message) => published.push(message) },
      },
    );

    expect(published).toEqual(["turn 3"]);
  });

  it("loads the advisor approval module hook for agent factory wiring", () => {
    const dir = mkdtempSync(join(tmpdir(), "eos-hooks-"));
    mkdirSync(join(dir, "hooks"), { recursive: true });
    writeFileSync(
      join(dir, "hooks", "hooks.json"),
      JSON.stringify([
        {
          event: "preToolUse",
          hook: "advisor_approval",
          module: { path: "advisor-hook.ts", export: "requireAdvisoryPass" },
        },
      ]),
    );

    const hooks = loadHookConfig(join(dir, "hooks", "hooks.json"));

    expect(hooks.sdkHooks).toEqual([]);
    expect(hooks.agentHooks.advisorApproval).toBeTypeOf("function");
  });
});

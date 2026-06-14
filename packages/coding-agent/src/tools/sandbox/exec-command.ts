import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import {
  callContext,
  commandResult,
} from "./shared.js";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

export function execCommandTool(sandbox: SandboxToolRuntime, agentRunId: AgentRunId): ToolDefinition {
  return defineTool({
    name: "exec_command",
    description: "Run a shell command in the sandbox workspace.",
    input: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout_ms: z.number().int().positive().optional(),
    }),
    execute: async (input, ctx) => {
      const { call, callerId } = callContext(sandbox, agentRunId, ctx);
      const cmd = input.cwd ? `cd ${input.cwd} && ${input.command}` : input.command;
      const res = await call("sandbox.command.exec", {
        cmd,
        caller_id: callerId,
        ...(input.timeout_ms !== undefined && { timeout: Math.ceil(input.timeout_ms / 1000) }),
      });
      return commandResult(res);
    },
  });
}

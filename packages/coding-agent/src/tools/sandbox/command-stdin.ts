import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import {
  callContext,
  commandResult,
} from "./shared.js";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

export function commandStdinTool(sandbox: SandboxToolRuntime, agentRunId: AgentRunId): ToolDefinition {
  return defineTool({
    name: "command_stdin",
    description: "Write to the stdin of a running sandbox command.",
    input: z.object({ command_id: z.string().min(1), input: z.string() }),
    execute: async (input, ctx) => {
      const { call, callerId } = callContext(sandbox, agentRunId, ctx);
      const res = await call("sandbox.command.write_stdin", {
        command_id: input.command_id,
        chars: input.input,
        caller_id: callerId,
      });
      return commandResult(res);
    },
  });
}

import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import {
  callContext,
  commandResult,
} from "./shared.js";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

export function readCommandTranscriptTool(sandbox: SandboxToolRuntime, agentRunId: AgentRunId): ToolDefinition {
  return defineTool({
    name: "read_command_transcript",
    description: "Read the transcript of a sandbox command by id.",
    input: z.object({
      command_id: z.string().min(1),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().positive().optional(),
    }),
    execute: async (input, ctx) => {
      const { call, callerId } = callContext(sandbox, agentRunId, ctx);
      const res = await call("sandbox.command.poll", {
        command_id: input.command_id,
        caller_id: callerId,
        ...(input.limit !== undefined && { last_n_lines: input.limit }),
      });
      return commandResult(res);
    },
  });
}

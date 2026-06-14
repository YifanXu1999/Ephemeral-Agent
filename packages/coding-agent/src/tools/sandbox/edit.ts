import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import {
  callContext,
  envelopeResult,
  gatewayOutput,
} from "./shared.js";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

export function editTool(sandbox: SandboxToolRuntime, agentRunId: AgentRunId): ToolDefinition {
  return defineTool({
    name: "edit",
    description: "Replace a string in a sandbox workspace file.",
    input: z.object({
      path: z.string().min(1),
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().default(false),
    }),
    execute: async (input, ctx) => {
      const { call, callerId } = callContext(sandbox, agentRunId, ctx);
      const res = await call("sandbox.file.edit", {
        path: input.path,
        edits: [
          { old_text: input.old_string, new_text: input.new_string, replace_all: input.replace_all },
        ],
        caller_id: callerId,
      });
      const enveloped = envelopeResult(res);
      return "error" in enveloped ? enveloped : { output: gatewayOutput(enveloped.result) };
    },
  });
}

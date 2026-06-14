import { defineTool, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import {
  callContext,
  envelopeResult,
  gatewayOutput,
} from "./shared.js";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

export function writeTool(sandbox: SandboxToolRuntime, agentRunId: AgentRunId): ToolDefinition {
  return defineTool({
    name: "write",
    description: "Write a file in the sandbox workspace.",
    input: z.object({ path: z.string().min(1), content: z.string() }),
    execute: async (input, ctx) => {
      const { call, callerId } = callContext(sandbox, agentRunId, ctx);
      const res = await call("sandbox.file.write", {
        path: input.path,
        content: input.content,
        caller_id: callerId,
      });
      const enveloped = envelopeResult(res);
      return "error" in enveloped ? enveloped : { output: gatewayOutput(enveloped.result) };
    },
  });
}

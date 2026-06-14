import { defineTool, type JsonObject, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import {
  callContext,
  envelopeResult,
  FileReadResult,
  sliceLines,
} from "./shared.js";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

export function readTool(sandbox: SandboxToolRuntime, agentRunId: AgentRunId): ToolDefinition {
  return defineTool({
    name: "read",
    description: "Read a file from the sandbox workspace.",
    input: z.object({
      path: z.string().min(1),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().positive().optional(),
    }),
    execute: async (input, ctx) => {
      const { call, callerId } = callContext(sandbox, agentRunId, ctx);
      const res = await call("sandbox.file.read", { path: input.path, caller_id: callerId });
      const enveloped = envelopeResult(res);
      if ("error" in enveloped) return enveloped;
      const parsed = FileReadResult.safeParse(enveloped.result);
      if (!parsed.success) return { error: "malformed file read result" };
      const content = sliceLines(parsed.data.content ?? "", input.offset, input.limit);
      const output: JsonObject = { content };
      if (parsed.data.exists !== undefined) output.exists = parsed.data.exists;
      return { output };
    },
  });
}

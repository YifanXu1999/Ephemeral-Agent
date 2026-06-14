import { defineTool, type JsonObject, type ToolDefinition } from "@ephai/agent-core";
import { z } from "zod";

import {
  callContext,
  envelopeResult,
  FileReadResult,
} from "./shared.js";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

export function multiReadTool(sandbox: SandboxToolRuntime, agentRunId: AgentRunId): ToolDefinition {
  return defineTool({
    name: "multi_read",
    description: "Read several files from the sandbox workspace.",
    input: z.object({ paths: z.array(z.string().min(1)).min(1) }),
    execute: async (input, ctx) => {
      const { call, callerId } = callContext(sandbox, agentRunId, ctx);
      const files: JsonObject[] = await Promise.all(
        input.paths.map(async (path): Promise<JsonObject> => {
          const res = await call("sandbox.file.read", { path, caller_id: callerId });
          const enveloped = envelopeResult(res);
          if ("error" in enveloped) return { path, error: enveloped.error };
          const parsed = FileReadResult.safeParse(enveloped.result);
          return parsed.success
            ? { path, content: parsed.data.content ?? "" }
            : { path, error: "malformed file read result" };
        }),
      );
      return { output: { files } };
    },
  });
}

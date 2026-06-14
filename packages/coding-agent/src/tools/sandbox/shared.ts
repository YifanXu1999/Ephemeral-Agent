import type {
  JsonValue,
  ToolCallContext,
  ToolResult,
} from "@ephai/agent-core";
import { z } from "zod";

import type { GatewayResponse } from "../../sandbox/gateway-client.js";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

interface CallArgs {
  caller_id: string;
  [key: string]: unknown;
}

export function callContext(
  sandbox: SandboxToolRuntime,
  agentRunId: AgentRunId,
  ctx: ToolCallContext,
): {
  call: (op: string, args: CallArgs) => Promise<GatewayResponse>;
  callerId: string;
} {
  const sandbox_id = sandbox.sandboxId(agentRunId);
  const callerId = agentRunId;
  return {
    callerId,
    call: (op, args) =>
      sandbox.gateway.call(
        { op, sandbox_id, args },
        { invocationId: ctx.toolUseId, signal: ctx.signal },
      ),
  };
}

export function envelopeResult(res: GatewayResponse): { result: JsonValue } | { error: string } {
  switch (res.status) {
    case "ok":
    case "running":
      return { result: res.result ?? null };
    case "rejected":
    case "error":
      return { error: `${res.error.kind}: ${res.error.message}` };
    case "cancelled":
    case "timed_out":
      return { error: `command ${res.status}` };
  }
}

const CommandResult = z.object({
  status: z.enum(["running", "ok", "cancelled", "error", "timed_out"]),
  command_id: z.string().optional(),
  exit_code: z.number().optional(),
  output: z.object({ stdout: z.string().optional(), stderr: z.string().optional() }).partial().optional(),
});

export function commandResult(res: GatewayResponse): ToolResult {
  const enveloped = envelopeResult(res);
  if ("error" in enveloped) return enveloped;
  const parsed = CommandResult.safeParse(enveloped.result);
  if (!parsed.success) return { error: "malformed command result" };
  const cmd = parsed.data;
  const output = { stdout: cmd.output?.stdout ?? "", stderr: cmd.output?.stderr ?? "" };
  switch (cmd.status) {
    case "running":
      return { output: { status: "running", command_id: cmd.command_id ?? null, output } };
    case "ok":
      return { output: { status: "ok", exit_code: cmd.exit_code ?? null, output } };
    case "error":
    case "timed_out":
    case "cancelled":
      return { error: `command ${cmd.status}: ${output.stderr || output.stdout || cmd.status}` };
  }
}

export const FileReadResult = z.object({
  content: z.string().optional(),
  exists: z.boolean().optional(),
}).loose();

export function gatewayOutput(result: unknown): JsonValue {
  return result === undefined ? null : result as JsonValue;
}

export function sliceLines(content: string, offset?: number, limit?: number): string {
  if (offset === undefined && limit === undefined) return content;
  const lines = content.split("\n");
  const start = offset ?? 0;
  const end = limit === undefined ? lines.length : start + limit;
  return lines.slice(start, end).join("\n");
}

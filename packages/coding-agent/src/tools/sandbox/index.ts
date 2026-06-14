import type { ToolDefinition } from "@ephai/agent-core";
import type { SandboxToolRuntime } from "../../sandbox/service.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

import { commandStdinTool } from "./command-stdin.js";
import { editTool } from "./edit.js";
import { execCommandTool } from "./exec-command.js";
import { multiReadTool } from "./multi-read.js";
import { readTool } from "./read.js";
import { readCommandTranscriptTool } from "./read-command-transcript.js";
import { writeTool } from "./write.js";

export function createSandboxTools(
  sandbox: SandboxToolRuntime,
  agentRunId: AgentRunId,
): ToolDefinition[] {
  return [
    readTool(sandbox, agentRunId),
    multiReadTool(sandbox, agentRunId),
    writeTool(sandbox, agentRunId),
    editTool(sandbox, agentRunId),
    execCommandTool(sandbox, agentRunId),
    commandStdinTool(sandbox, agentRunId),
    readCommandTranscriptTool(sandbox, agentRunId),
  ];
}

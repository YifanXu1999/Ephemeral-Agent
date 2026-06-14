import type { HookEntry } from "@ephai/agent-core";

import type { AdvisorPassRegistry } from "@ephai/agent-engine/agents";
import type { AgentRunId } from "@ephai/agent-engine/runs";

/**
 * The terminal gate: a `preToolUse` hook on the bound terminal tool that
 * denies until the advisor has passed this exact submission. It never starts an
 * advisor; a denial reaches the model as a tool error and mutates no state.
 */
export function requireAdvisoryPass(opts: {
  agentRunId: AgentRunId;
  toolName: string;
  passes: AdvisorPassRegistry;
}): HookEntry {
  return {
    event: "preToolUse",
    matcher: { toolName: opts.toolName },
    run: (facts) =>
      opts.passes.hasPass(opts.agentRunId, { tool_name: facts.toolName, payload: facts.input })
        ? { decision: "passthrough" }
        : {
            decision: "deny",
            reason: `advisor has not passed this ${facts.toolName} submission; call ask_advisor with the intended payload first`,
          },
  };
}

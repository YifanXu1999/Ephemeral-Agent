import type { SandboxGatewayClient } from "./gateway-client.js";
import type { RunSandboxRegistry } from "./run-sandbox-registry.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

/**
 * The run-boundary sandbox lifecycle (BR-3), the narrow slice the pursuit
 * service consumes. `acquire` provisions a sandbox and binds it to the run;
 * `end` tears down the run's work (`sandbox.run.end` with `caller_id ==
 * agent_run_id`) and releases the container. Each run owns its own pair, so the
 * pursuit lifecycle never sees gateway vocabulary.
 */
export interface SandboxRunBinding {
  acquire(runId: AgentRunId): Promise<void>;
  end(runId: AgentRunId): Promise<void>;
}

export function sandboxRunBinding(
  client: SandboxGatewayClient,
  registry: RunSandboxRegistry,
): SandboxRunBinding {
  return {
    async acquire(runId) {
      const { sandbox_id } = await client.acquire();
      registry.bind(runId, sandbox_id);
    },
    async end(runId) {
      const sandboxId = registry.release(runId);
      if (sandboxId === undefined) return;
      // run.end groups this run's commands + isolated workspace under caller_id.
      await client.call({ op: "sandbox.run.end", sandbox_id: sandboxId, args: { caller_id: runId } });
      await client.release(sandboxId);
    },
  };
}

/** A no-op binding for runs that do not provision a sandbox (e.g. tests). */
export const noopSandboxRunBinding: SandboxRunBinding = {
  acquire: () => Promise.resolve(),
  end: () => Promise.resolve(),
};

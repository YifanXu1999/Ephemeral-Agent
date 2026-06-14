import type { AgentRunId } from "@ephai/agent-engine/runs";

/**
 * The per-run sandbox binding (BR-2/BR-3). Sandbox tools are process-level
 * `ToolDefinition`s shared across runs, but each agent run owns its own
 * `sandbox_id` (acquired at the pursuit run boundary). This registry is the seam
 * that lets a run-bound tool resolve the sandbox for its executing run while
 * the pursuit lifecycle binds/unbinds it.
 *
 * caller_id granularity: each run owns its own acquire/release pair, so
 * `caller_id == agent_run_id` — the simplest correct choice for
 * multi-run pursuits, where every child run gets an isolated sandbox.
 */
export class RunSandboxRegistry {
  readonly #byRun = new Map<AgentRunId, string>();

  bind(runId: AgentRunId, sandboxId: string): void {
    this.#byRun.set(runId, sandboxId);
  }

  release(runId: AgentRunId): string | undefined {
    const sandboxId = this.#byRun.get(runId);
    this.#byRun.delete(runId);
    return sandboxId;
  }

  /** Resolve the sandbox for an executing run; throws if no run holds one. */
  require(runId: AgentRunId): string {
    const sandboxId = this.#byRun.get(runId);
    if (sandboxId === undefined) {
      throw new Error(`no sandbox bound for run "${runId}"`);
    }
    return sandboxId;
  }
}

import { SandboxGatewayClient } from "./gateway-client.js";
import { sandboxRunBinding, type SandboxRunBinding } from "./run-binding.js";
import { RunSandboxRegistry } from "./run-sandbox-registry.js";
import type { AgentRunId } from "@ephai/agent-engine/runs";

export interface SandboxToolRuntime {
  gateway: Pick<SandboxGatewayClient, "call">;
  sandboxId(runId: AgentRunId): string;
}

export class SandboxService implements SandboxToolRuntime {
  readonly gateway: SandboxGatewayClient;
  readonly runBinding: SandboxRunBinding;
  readonly #registry: RunSandboxRegistry;

  constructor(
    gateway: SandboxGatewayClient = new SandboxGatewayClient(),
    registry: RunSandboxRegistry = new RunSandboxRegistry(),
  ) {
    this.gateway = gateway;
    this.#registry = registry;
    this.runBinding = sandboxRunBinding(this.gateway, this.#registry);
  }

  sandboxId(runId: AgentRunId): string {
    return this.#registry.require(runId);
  }
}

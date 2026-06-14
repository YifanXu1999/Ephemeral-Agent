# eos-coding-agent

Host project for composing `@ephai/agent-core` into the coding-agent product.

The root package is the application. Keep all implementation code under `src/`;
there is no internal `packages/` workspace.

| Location | Owner |
|---|---|
| `src/bootstrap.ts` | composition root over SDK, config, tools, and workflow providers |
| `src/config/` | `.eos-agents` config loader plus config-only diagnostics and entry-file helpers |
| `src/agents/` | `AgentFactory` contract, concrete `buildAgentFactory`, and advisory pass registry |
| `src/tools/` | ordinary model-visible host tools, including the agent tool family under `src/tools/agent/` |
| `src/workflows/core/` | `WorkflowHub`, provider contracts, and generic workflow registry code |
| `src/workflows/pursuit/` | pursuit provider/service, split contracts, flat entity owner modules, lifecycle transition owner, role-named outcome bindings, launch queue, and context read/projection/script wiring |
| `src/scripts/` | subprocess JSON command runner |
| `tests/testkit/` | `.eos-agents` fixture building |

Config layout:

| Location | Loaded As |
|---|---|
| `.eos-agents/agents/**/*.md` | Agent profile configs, including workflow-local profiles such as `agents/workflows/pursuit/planner.md` |
| `.eos-agents/workflows/*/workflow.md` | Workflow configs; workflow-local stores and scripts live beside the owning workflow config |
| `.eos-agents/hooks/hooks.json` | Hook command configs |
| `.eos-agents/llm_clients/llm_clients.json` | LLM client configs |

Run package-manager commands from this directory with `pnpm`.

# Design — `eos-coding-agent` Codebase Explorer

A static, light-theme, IDE-like HTML explorer for the `eos-coding-agent` package —
the host application that composes `@ephai/agent-core` into the coding-agent product.
Same shape as the SDK explorer (`../@ephai/agent-core/design.md`): extraction scripts
emit JSON, a renderer templates static HTML, the code view is a single
file-explorer shell. **The headline addition is a first-class Configuration
surface**: the `.eos-agents/` runtime configs (agents, workflows, hooks, llm
clients) are parsed, cross-linked into a config graph, and joined back to the code
that loads and consumes them.

> Status: design only. The package is a TypeScript app (`0.0.0`, private,
> ESM/`NodeNext`, pnpm). `code_map/` already exists (empty); this spec builds it
> out, mirroring the SDK explorer.

## 0. Key decisions at a glance

| Question | Decision |
|---|---|
| **AST symbols vs LSP references?** | **Both, over one `ts.Program`** — Compiler API + `TypeChecker` for enumeration/visibility, Language Service (`findReferences`/`getDefinitionAtPosition`/`getQuickInfoAtPosition`) for jump/hover. Identical engine choice to the SDK explorer. |
| Extraction home | `code_map/scripts/` with **its own `tsconfig.json`** (the package `tsconfig` includes only `src/**` + `tests/**`, so the tool stays out of `pnpm run check`; eslint-ignored). |
| Data → HTML | Two scripts + JSON between; pages in `code_map/`, entry `code_map_index.html` at the package root; per-file data inlined as `code-data.js` (`file://`-safe). |
| **Config surface (the extra thing)** | A **Configuration tab** with Agents / Workflows / Hooks / LLM Clients pages + a **Config Graph**, parsed from `.eos-agents/**` and cross-linked to each other and to the code that loads/consumes them. |
| Visibility tiers | No `index.ts` barrel here — anchor the public tier on **`src/bootstrap.ts`** (the composition root): `app-surface` (reached from bootstrap) · `module-exported` · `file-local`. |
| Cross-package symbols | `@ephai/agent-core` is a linked dep; SDK symbols (e.g. `HookEntry`, `LlmClientConfig`) resolve into the link. Mark them **external** and optionally deep-link into the SDK explorer. |
| Workflow config format | The user's brief said `workflows/*/workflow.json`; the **actual** format is `workflows/*/workflow.md` (YAML frontmatter + markdown docs) with a sibling `scripts/*.cjs` + `*.sqlite` store. This spec targets the real `.md` format and flags it (§11). |

## 1. Grounding facts that drive the design

```
eos-coding-agent/
├─ src/                       ~64 files, 6 modules + the composition root
│  ├─ bootstrap.ts            COMPOSITION ROOT (wires SDK + config + tools + workflows)
│  ├─ config/                 .eos-agents loaders + Zod schemas + diagnostics   (8 files)
│  ├─ agents/                 AgentFactory contract, buildAgentFactory, advisory-pass registry
│  ├─ tools/  (agent · background · file_system · workflow) host-authored model-visible tools
│  ├─ workflows/core/         WorkflowHub + provider contract + WorkflowConfig
│  ├─ workflows/pursuit/      pursuit provider/service, flat entity owners, lifecycle, context (32 files)
│  ├─ db/  (+migrations)      better-sqlite3 + kysely schema, pursuit rows
│  └─ scripts/                subprocess JSON command runner
├─ tests/                     mirrors src/ (+ tests/testkit/eos-agents.ts fixture builder)
├─ .eos-agents/               RUNTIME CONFIG (the extra surface)
│  ├─ agents/{advisor,operator,subagent}.md
│  ├─ agents/workflows/pursuit/{planner,worker}.md     workflow-local profiles
│  ├─ workflows/pursuit/workflow.md  + scripts/{planner,worker,variable_reference_map}.cjs  + pursuit.sqlite
│  ├─ hooks/hooks.json  + hooks/advisor-hook.ts  + *.cjs
│  └─ llm_clients/llm_clients.json
├─ README.md                  exists (good — owner table for src/ + config layout)
├─ package.json               deps: @ephai/agent-core (link) · better-sqlite3 · kysely · yaml · zod
└─ tsconfig.json              include: src/** + tests/**  (no scripts/ or code_map/)
```

Four properties shape the design:

- **It is an application, not a library.** `bootstrap.ts` is the composition root; there is no public-API barrel. Visibility is anchored on bootstrap reachability.
- **It is config-driven.** Behavior is defined by `.eos-agents/**` — agents, workflows, hooks, llm clients — each with a typed loader in `src/config/`. The configs reference *each other* and the *code*.
- **Mirror symmetry** `src/X` ↔ `tests/X` (config loaders are tested in `tests/config/`).
- **It composes the SDK.** `src/config/*` imports SDK types; tools/hooks compile down to SDK `HookEntry`/`ToolDefinition`/`LlmClientConfig`. SDK symbols are external references.

## 2. Architecture — extract → derive → render

```
 ┌── code-inventory (TS Compiler API + Language Service over ONE Program) ──┐
 src/**.ts ─┐                                                               │
 tests/**   ├─►  code_map/scripts/extract/main.ts                           │
 *.md ──────┘      core/ (Compiler API)  ─► modules · symbols · imports · source
                   ide/  (LanguageService)─► references · hover · definitions
                   config/ (NO TS API)   ─► parse .eos-agents/** → config graph  ◄── the extra layer
                   aux/                   ─► tests · search
 └──────────────────────────────────┬───────────────────────────────────────┘
                                     ▼  code_map/data/*.json  (zod-validated)
                      code_map/scripts/render/main.ts  (tsx, no framework)
                                     ▼
        code_map/  (HTML) + code_map_index.html (root) + assets (theme.css, app.js, code-data.js)
```

Two `package.json` scripts could be added (`code-inventory`, `site`), but per the
SDK explorer the canonical entry is `bash code_map/scripts/refresh.sh`. Output
(`code_map/data`, assets, HTML, root index) is git-ignored.

## 3. The symbol question — what to extract and how

Identical engine to the SDK explorer (see `../@ephai/agent-core/design.md` §3): one
`ts.Program` shared by the Compiler API (enumeration) and the Language Service
(references/hover). Two adaptations for an app:

- **Visibility anchor is `src/bootstrap.ts`.** `app-surface` = a declaration transitively reached from bootstrap's import graph (the symbols actually wired into the running app); `module-exported` = exported (often via a module `index.ts` barrel — `db/`, `tools/`, `scripts/`, `workflows/pursuit/`, `workflows/pursuit/contracts/`) but not reached from bootstrap; `file-local` otherwise.
- **Cross-package boundary.** When `getDefinitionAtPosition` resolves an identifier into the `@ephai/agent-core` link (e.g. `HookEntry`, `defineTool`, `LlmClientConfig`), tag it `external:@ephai/agent-core` rather than stamping a local symbol. Optionally rewrite such links to the SDK explorer (`../@ephai/agent-core/code_map/code/index.html#/…`).

### Symbol taxonomy

Same `kind` + advisory `kindTags` + role bands as the SDK explorer. This codebase
leans on **Zod schemas** (config loaders), **typed IDs + DTOs** (pursuit
contracts), **classes** (provider/service/hub, sqlite-backed owners), and
**functions** (loaders, tool factories). Add two app-specific advisory tags
surfaced from string-literal scans (see §6 config graph):

| tag | detected when |
|---|---|
| `tool-factory` | a `defineTool({ name: "…" })` call — its `name` literal joins the tool-name index |
| `config-schema` | a Zod schema in `src/config/*` (`FrontmatterSchema`, `LlmClientsConfigSchema`, `HookConfigEntrySchema`) — the contract a config file is validated against |

## 4. Symbol ordering & clustering

Unchanged from the SDK explorer (`../@ephai/agent-core/design.md` §4): role bands
**Containers → Types & Contracts → Functions → Helpers → Re-exports**; two
profiles — **File profile** (`roleBand → visibility → source order`; containers
top, helpers bottom, public over private) for outlines, **Surface profile**
(`visibility → roleBand → name`) for module/overview tables; class members nested
(public→private, fields→methods). The source pane stays in true file order; only
outlines/tables reorder. File tree: dirs first, `index.ts` barrels pinned.

## 5. Extraction scripts — `code_map/scripts/`

```
code_map/scripts/
├─ refresh.sh                 # extract → render (single entry)
├─ tsconfig.json              # standalone; strict NodeNext; not in the package gate
├─ extract/
│  ├─ main.ts  program.ts  symbols.ts  graph.ts  source.ts  tests.ts  model.ts
│  └─ config/                 # THE EXTRA LAYER — parse .eos-agents/**, no TS API
│     ├─ agents.ts            # agents/**/*.md → AgentConfig[]  (YAML frontmatter + prompt body)
│     ├─ workflows.ts         # workflows/*/workflow.md → WorkflowConfig[] (+ scripts, store)
│     ├─ hooks.ts             # hooks/hooks.json → HookConfig[]
│     ├─ llm-clients.ts       # llm_clients/llm_clients.json → LlmClientConfig[] (secrets redacted)
│     ├─ tool-index.ts        # scan defineTool({name}) literals → tool-name → symbolId
│     └─ config-graph.ts      # resolve cross-refs → nodes + edges
└─ render/
   ├─ main.ts  layout.ts  order.ts  pages.ts  md.ts  assets.ts
   └─ config-pages.ts         # Agents · Workflows · Hooks · LLM Clients · Config Graph
```

### Artifact set (adds the config artifacts)

| Artifact | Source | Consumed by |
|---|---|---|
| `modules.json` · `symbols.json` · `references.json` · `import-graph.json` · `source.json` · `tests-coverage.json` · `search-index.json` · `manifest.json` | core/ide/aux | Overview, shell, module pages, Coverage (as in the SDK explorer) |
| **`config-graph.json`** | config/ | the Configuration tab |

`config-graph.json` mirrors each loader's typed output so a config page can link to
the **schema symbol** that validates it (e.g. an Agents page → `AgentProfile` /
`FrontmatterSchema` in `src/config/agent-configs.ts`):

```jsonc
{
  "version": 1,
  "agents": [{
    "name": "operator", "file": ".eos-agents/agents/operator.md",
    "llmClientId": "codex_coding_plan",
    "workflows": ["pursuit"], "subagents": ["subagent"],
    "allowedTools": ["run_subagent"], "maxTurns": null,
    "promptChars": 812, "schemaSymbolId": "src/config/agent-configs.ts#interface:AgentProfile@…"
  }],
  "workflows": [{
    "name": "pursuit", "file": ".eos-agents/workflows/pursuit/workflow.md",
    "type": "pursuit", "tools": ["delegate_pursuit"],
    "args": { "planner": "planner", "worker": "worker",
              "store": ".eos-agents/workflows/pursuit/pursuit.sqlite",
              "contextScripts": { "planner": "…/planner.cjs", "worker": "…/worker.cjs" },
              "defaultMaxAttempts": 2 },
    "scripts": ["…/planner.cjs", "…/worker.cjs", "…/variable_reference_map.cjs"]
  }],
  "hooks": [{ "event": "preToolUse", "hook": "advisor_approval" }, "…"],
  "llmClients": [{
    "id": "codex_coding_plan", "provider": "codex_coding_plan", "modelId": "gpt-5.5",
    "reasoningEffort": "medium", "baseUrl": "https://…/codex",
    "auth": { "kind": "codex_cli_auth_file", "path": "‹redacted›" }   // never emit credentials/paths verbatim
  }],
  "toolIndex": { "run_subagent": "src/tools/agent/run-subagent.ts#const:runSubagentTool@…",
                 "delegate_pursuit": "src/tools/workflow/pursuit/delegate-pursuit.ts#…" },
  "edges": [
    { "from": "agent:operator", "to": "client:codex_coding_plan", "kind": "uses-client" },
    { "from": "agent:operator", "to": "workflow:pursuit",        "kind": "uses-workflow" },
    { "from": "agent:operator", "to": "agent:subagent",          "kind": "may-launch" },
    { "from": "agent:operator", "to": "tool:run_subagent",       "kind": "allows-tool" },
    { "from": "workflow:pursuit", "to": "agent:planner",         "kind": "workflow-role" },
    { "from": "workflow:pursuit", "to": "script:planner.cjs",    "kind": "context-script" },
    { "from": "workflow:pursuit", "to": "store:pursuit.sqlite",  "kind": "store" }
  ]
}
```

**Secrets:** `llm-clients.ts` must redact `auth.credential` (inline) and mask
`auth.path` — render `kind` + provider + model only. The credential file is never
read or emitted.

## 6. Site information architecture — pages & layouts

Shared chrome adds a fourth top tab: **Overview · Code Map · Coverage ·
Configuration**.

### Pages

| Route | Page | Notes |
|---|---|---|
| `/code_map_index.html` | **Overview** | README (exists) + stats (modules / symbols / classes / methods / functions / app-surface) + module cards + import graph + **a config summary card** (N agents, N workflows, N hooks, N llm clients → Configuration tab). |
| `/code_map/module/<m>.html` | **Module** | files + symbols in Surface profile. |
| `/code_map/code/index.html` | **Code Map shell** | file-tree → render that file's data; outline (File-profile bands); find-references; SDK identifiers badged `external`. |
| `/code_map/coverage/index.html` | **Coverage** | structural test→src matrix (sub-tabs as in the SDK explorer if a matrix doc exists). |
| `/code_map/config/index.html` | **Configuration** | sub-tabbed: **Agents · Workflows · Hooks · LLM Clients · Graph** (pure-CSS radio tabs). |

### The Configuration tab (the extra surface)

| Sub-tab | Content | Cross-links |
|---|---|---|
| **Agents** | one card per profile: name, `llm_client_id`, `max_turns`, `allowed_tools`, `workflows`, `subagents`, and the rendered system-prompt body. | client → LLM Clients; each tool → its `defineTool` symbol (Code Map); each workflow → Workflows; each subagent → its agent card; the file → source. Header links to the `AgentProfile` schema symbol. |
| **Workflows** | per workflow: `type`, `description`, declared `tools`, `args` (planner/worker/store/scripts/budget), rendered docs body. | planner/worker → agent cards; `tools` → `defineTool` symbols; `scripts/*.cjs` → source view; `store` → file; header → `WorkflowConfig` schema. |
| **Hooks** | the `hooks.json` entries (event, matcher, command); empty-state when `[]`. | `matcher.toolName` → tool symbol; header → `HookConfigEntrySchema`; explains the subprocess `executeJsonCommand` seam. |
| **LLM Clients** | per client: id, provider, model, reasoning effort, base url, auth **kind only**. | provider → the SDK `ProviderConnection` variant (external); "used by" back-edges to agent cards; header → `LlmClientsConfigSchema`. |
| **Graph** | the whole `config-graph.json` as a grouped adjacency view (agents ⇄ clients ⇄ workflows ⇄ tools ⇄ scripts), every node a link. | every edge resolves to a config page or a code symbol. |

### Config graph (what the Graph view renders)

```
 llm_clients.json
   └─ codex_coding_plan ◄───────────────(llm_client_id)────────────────┐
                                                                        │
 agents/                                                                │
   operator ─(workflows)─► workflow:pursuit ─┬─(args.planner)─► agent:planner
     │     └─(subagents)─► agent:subagent     ├─(args.worker)──► agent:worker
     │     └─(allowed_tools)─► tool:run_subagent   ├─(context_scripts)─► scripts/{planner,worker}.cjs
     ├─ advisor                         └─(store)─► pursuit.sqlite
     ├─ planner / worker  (workflow-local, under agents/workflows/pursuit/)
   each agent ─(llm_client_id)─────────────────────────────────────────┘
 hooks.json  ─(command → subprocess; hook module → in-process gate)
```

## 7. Cross-page hyperlink model

Code/symbol links are hash routes into the shell (as in the SDK explorer). The
config layer adds these resolver edges:

| Edge | From | To |
|---|---|---|
| agent → client | Agents card `llm_client_id` | LLM Clients card |
| agent → workflow | Agents card `workflows[]` | Workflows card |
| agent → subagent | Agents card `subagents[]` | Agents card |
| agent → tool | `allowed_tools[]` | `defineTool` symbol via `toolIndex` → `/code/#/<src>~L<line>` |
| workflow → role agent | `args.planner` / `args.worker` | Agents card |
| workflow → script | `args.context_scripts.*` | source view of the `.cjs` |
| config → schema | any config page header | the loader's Zod schema symbol in `src/config/*` |
| code → config | a config loader symbol | its config instances (reverse of the above) |
| symbol → SDK | external identifier | the SDK explorer (optional) |

## 8. Core features
- Everything in the SDK explorer: file-tree navigation, clickable identifiers (go-to-def), find-references, hover cards, banded ordering, search, deterministic builds.
- **Config graph** — agents/workflows/hooks/clients cross-linked and joined to the code that loads (`src/config/*` schemas) and consumes (`defineTool` tools) them.
- **Config↔code round-trip** — `allowed_tools` names resolve to real tool symbols; config pages link to their validating Zod schema; loaders link back to instances.
- **Validation-aware** — surface the loader invariants (unique names; `subagents` must name known profiles; factory-injected tools stay out of `allowed_tools`; workflow dir name == config name) so a misconfig reads as a flagged edge.
- **System-prompt + docs rendering** — agent prompt bodies and workflow docs render as markdown.
- **Secret-safe** — llm-client credentials/paths are never emitted.

## 9. Coverage view
Structural test→src edges from the import graph (always available); `tests/config/`
notably covers the agent/workflow loaders. Optional v8 overlay as in the SDK
explorer. No authored matrix doc exists here, so the E2E sub-tab is omitted unless
one is added.

## 10. README
`eos-coding-agent/README.md` exists and is good (owner table for `src/` + config
layout). The Overview page renders it directly — no fallback needed. The
Configuration tab is the deeper, generated companion to the README's config table.

## 11. Decisions to confirm before building
1. **Workflow config format** — the brief said `workflow.json`; the repo uses `workflow.md` (YAML frontmatter + markdown). This spec targets `.md`. *Confirm we are not migrating to JSON.*
2. **SDK cross-links** — deep-link external SDK symbols into `../@ephai/agent-core/code_map`, or just badge them `external` and stop? *Default: badge; link if the SDK explorer is built alongside.*
3. **DB schema view** — `src/db/schema.ts` + migrations are visible as code; add a dedicated tables/columns view (kysely schema)? *Default: code-only; no separate view.*
4. **`.cjs` context scripts** — render `scripts/*.cjs` in the file viewer (CommonJS, outside the TS program)? *Default: yes, as plain source (no symbol stamping).*
5. **Pursuit `*.sqlite` store** — link as an opaque file; do **not** read its contents. *Default: opaque link only.*
6. **Visibility anchor** — confirm `bootstrap.ts` as the `app-surface` root (vs per-module `index.ts` barrels). *Default: bootstrap.*

## 12. Verification ladder
- `pnpm run typecheck` — unaffected (tool lives outside the package tsconfig).
- `bash code_map/scripts/refresh.sh` — assert `manifest.json` counts (~6 modules / ~64 src files), and config-graph invariants: every agent `llm_client_id` resolves to a client; `operator.workflows` → `pursuit`; `operator.subagents` → `subagent`; every `allowed_tools` name resolves through `toolIndex` (a dangling name is a flagged edge, exactly the loader's own validation).
- Render spot-check: an Agents card's `llm_client_id` links to the LLM Clients card; a tool name links to its `defineTool` source line; the workflow's planner/worker link to the workflow-local agent cards.

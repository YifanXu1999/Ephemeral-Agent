// Parse .eos-agents/** into a config graph and join it to the code that loads
// (src/config/* loaders) and consumes (defineTool sites) each config. No TS API;
// pure file parsing. Secrets (credentials/auth paths) are never emitted.

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  AgentCfg,
  CodeRef,
  ConfigGraph,
  HookCfg,
  LlmClientCfg,
  SymbolRec,
  WorkflowCfg,
} from "../model.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*|)$/;

function rel(repoRoot: string, abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join("/");
}

function readFrontmatter(file: string): { data: Record<string, unknown>; body: string } | null {
  const raw = fs.readFileSync(file, "utf8");
  const m = FRONTMATTER.exec(raw);
  if (!m) return null;
  const data = (parseYaml(m[1]) ?? {}) as Record<string, unknown>;
  return { data, body: m[2].trim() };
}

function mdFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".")) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return mdFilesRecursive(p);
    return e.isFile() && e.name.endsWith(".md") ? [p] : [];
  });
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function flattenArgs(args: unknown, repoRoot: string): { key: string; value: string }[] {
  if (args === null || typeof args !== "object") return [];
  const out: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v !== null && typeof v === "object") {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        out.push({ key: `${k}.${k2}`, value: String(v2) });
      }
    } else {
      out.push({ key: k, value: String(v) });
    }
  }
  return out;
}

export function parseConfigs(repoRoot: string): {
  agents: AgentCfg[];
  workflows: WorkflowCfg[];
  hooks: HookCfg[];
  llmClients: LlmClientCfg[];
} {
  const EOS = path.join(repoRoot, ".eos-agents");

  // Agents
  const agents: AgentCfg[] = [];
  for (const file of mdFilesRecursive(path.join(EOS, "agents")).sort()) {
    const fm = readFrontmatter(file);
    if (!fm) continue;
    const d = fm.data;
    const relPath = rel(repoRoot, file);
    agents.push({
      name: String(d.name ?? path.basename(file, ".md")),
      file: relPath,
      llmClientId: String(d.llm_client_id ?? ""),
      description: d.description ? String(d.description) : undefined,
      maxTurns: typeof d.max_turns === "number" ? d.max_turns : undefined,
      allowedTools: asStrArray(d.allowed_tools),
      workflows: asStrArray(d.workflows),
      subagents: asStrArray(d.subagents),
      promptChars: fm.body.length,
      promptBody: fm.body,
      workflowLocal: relPath.includes("/agents/workflows/"),
    });
  }

  // Workflows: .eos-agents/workflows/<name>/workflow.md
  const workflows: WorkflowCfg[] = [];
  const wfRoot = path.join(EOS, "workflows");
  if (fs.existsSync(wfRoot)) {
    for (const dir of fs.readdirSync(wfRoot, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
      const cfgPath = path.join(wfRoot, dir.name, "workflow.md");
      if (!fs.existsSync(cfgPath)) continue;
      const fm = readFrontmatter(cfgPath);
      if (!fm) continue;
      const d = fm.data;
      const argEntries = flattenArgs(d.args, repoRoot);
      const scriptsDir = path.join(wfRoot, dir.name, "scripts");
      const scripts = fs.existsSync(scriptsDir)
        ? fs.readdirSync(scriptsDir).filter((f) => !f.startsWith(".")).sort().map((f) => rel(repoRoot, path.join(scriptsDir, f)))
        : [];
      const args = (d.args ?? {}) as Record<string, unknown>;
      const roleAgents = ["planner", "worker"]
        .map((r) => args[r])
        .filter((v): v is string => typeof v === "string");
      workflows.push({
        name: String(d.name ?? dir.name),
        file: rel(repoRoot, cfgPath),
        type: String(d.type ?? ""),
        description: String(d.description ?? ""),
        tools: asStrArray(d.tools),
        argEntries,
        docs: fm.body,
        scripts,
        store: typeof args.store === "string" ? args.store : undefined,
        roleAgents,
      });
    }
  }

  // Hooks
  const hooks: HookCfg[] = [];
  const hooksPath = path.join(EOS, "hooks/hooks.json");
  if (fs.existsSync(hooksPath)) {
    const arr = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as unknown;
    if (Array.isArray(arr)) {
      for (const e of arr as Record<string, unknown>[]) {
        const matcher = e.matcher as { toolName?: string } | undefined;
        const command = e.command as { command?: string } | undefined;
        hooks.push({
          event: String(e.event ?? ""),
          toolName: matcher?.toolName,
          command: command?.command ?? "",
        });
      }
    }
  }

  // LLM clients (auth redacted)
  const llmClients: LlmClientCfg[] = [];
  const clientsPath = path.join(EOS, "llm_clients/llm_clients.json");
  if (fs.existsSync(clientsPath)) {
    const json = JSON.parse(fs.readFileSync(clientsPath, "utf8")) as { clients?: Record<string, unknown>[] };
    for (const c of json.clients ?? []) {
      const auth = c.auth as { kind?: string } | undefined;
      llmClients.push({
        id: String(c.id ?? ""),
        provider: String(c.provider ?? ""),
        modelId: String(c.model_id ?? ""),
        reasoningEffort: c.reasoning_effort ? String(c.reasoning_effort) : undefined,
        baseUrl: c.base_url ? String(c.base_url) : undefined,
        authKind: auth?.kind ?? "unknown",
      });
    }
  }

  return { agents, workflows, hooks, llmClients };
}

/** Find each tool name's `name: "<tool>"` definition site by scanning src. */
function buildToolIndex(repoRoot: string, toolNames: Set<string>): Record<string, CodeRef> {
  const index: Record<string, CodeRef> = {};
  const srcFiles: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".ts")) srcFiles.push(p);
    }
  };
  // Prefer src/tools, then the rest of src.
  walk(path.join(repoRoot, "src/tools"));
  walk(path.join(repoRoot, "src"));
  for (const abs of srcFiles) {
    const text = fs.readFileSync(abs, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /\bname:\s*["']([a-z][a-z0-9_]*)["']/.exec(lines[i]);
      if (m && toolNames.has(m[1]) && !(m[1] in index)) {
        index[m[1]] = { file: rel(repoRoot, abs), line: i + 1 };
      }
    }
  }
  return index;
}

export function buildConfigGraph(
  repoRoot: string,
  parsed: ReturnType<typeof parseConfigs>,
  symbols: SymbolRec[],
): ConfigGraph {
  const toolNames = new Set<string>();
  for (const a of parsed.agents) {
    for (const t of a.allowedTools) toolNames.add(t);
  }
  for (const w of parsed.workflows) for (const t of w.tools) toolNames.add(t);

  const toolIndex = buildToolIndex(repoRoot, toolNames);

  const loaderRef = (name: string): CodeRef | undefined => {
    const s = symbols.find((x) => x.name === name && !x.container);
    return s ? { file: s.file, line: s.decl.line } : undefined;
  };
  const loaders: Record<string, CodeRef> = {};
  for (const [kind, fn] of [
    ["agents", "loadAgentProfiles"],
    ["workflows", "loadWorkflowConfigs"],
    ["hooks", "loadHookConfig"],
    ["llmClients", "loadLlmClients"],
  ] as const) {
    const ref = loaderRef(fn);
    if (ref) loaders[kind] = ref;
  }

  const usedBy: Record<string, string[]> = {};
  for (const a of parsed.agents) {
    (usedBy[a.llmClientId] ??= []).push(a.name);
  }

  return { ...parsed, toolIndex, loaders, usedBy };
}

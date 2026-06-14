// The Configuration tab: Agents · Workflows · Hooks · LLM Clients · Graph.
// Multi-page with anchors so config nodes cross-link (agent→client, agent→
// workflow, agent→subagent) and join to code (tool name → defineTool site,
// page header → its loader function).

import type {
  AgentCfg,
  CodeRef,
  ConfigGraph,
  LlmClientCfg,
  WorkflowCfg,
} from "../extract/model.js";
import { esc, links, OUT, page } from "./layout.js";
import { renderMarkdown } from "./md.js";

type L = ReturnType<typeof links>;

function subnav(l: L, active: string): string {
  const item = (id: string, label: string, href: string): string =>
    `<a class="subnav-i${active === id ? " on" : ""}" href="${href}">${label}</a>`;
  return `<div class="subnav">${item("graph", "Graph", l.cfg.index)}${item("agents", "Agents", l.cfg.agents())}${item("workflows", "Workflows", l.cfg.workflows())}${item("hooks", "Hooks", l.cfg.hooks())}${item("clients", "LLM Clients", l.cfg.clients())}</div>`;
}

function loaderLink(l: L, ref: CodeRef | undefined, label: string): string {
  if (!ref) return "";
  return `<a class="loader" href="${l.file(ref.file, ref.line)}">parsed by <code>${esc(label)}</code> →</a>`;
}

function toolLink(l: L, g: ConfigGraph, name: string): string {
  const ref = g.toolIndex[name];
  return ref
    ? `<a class="tag tool" href="${l.file(ref.file, ref.line)}" title="${esc(ref.file)}:${String(ref.line)}">${esc(name)}</a>`
    : `<span class="tag tool miss" title="no defineTool site found">${esc(name)}</span>`;
}

const cfgPage = (from: string, active: string, title: string, body: string): string =>
  page({ from, title: `Config · ${title}`, tab: "config", body: `<div class="page">${subnav(links(from), active)}${body}</div>` });

// ── Agents ──────────────────────────────────────────────────────────────────
function agentCard(l: L, g: ConfigGraph, a: AgentCfg): string {
  const tools = a.allowedTools.length
    ? a.allowedTools.map((t) => toolLink(l, g, t)).join(" ")
    : '<span class="dim">none</span>';
  const wfs = a.workflows.length
    ? a.workflows.map((w) => `<a class="tag" href="${l.cfg.workflows(w)}">${esc(w)}</a>`).join(" ")
    : '<span class="dim">—</span>';
  const subs = a.subagents.length
    ? a.subagents.map((s) => `<a class="tag" href="${l.cfg.agents(s)}">${esc(s)}</a>`).join(" ")
    : '<span class="dim">—</span>';
  return `<article class="cfg-card" id="agent-${esc(a.name)}">
  <h3>${esc(a.name)}${a.workflowLocal ? ' <span class="pill">workflow-local</span>' : ""}</h3>
  <p class="dim">${esc(a.description ?? "")}</p>
  <dl class="cfg-kv">
    <dt>llm client</dt><dd><a class="tag" href="${l.cfg.clients(a.llmClientId)}">${esc(a.llmClientId)}</a></dd>
    <dt>max turns</dt><dd>${a.maxTurns ? String(a.maxTurns) : '<span class="dim">SDK default</span>'}</dd>
    <dt>workflows</dt><dd>${wfs}</dd>
    <dt>subagents</dt><dd>${subs}</dd>
    <dt>allowed tools</dt><dd class="tags">${tools}</dd>
    <dt>config</dt><dd><a href="${l.raw(a.file)}"><code>${esc(a.file)}</code></a></dd>
  </dl>
  <details><summary>system prompt · ${String(a.promptChars)} chars</summary><pre class="md-code">${esc(a.promptBody)}</pre></details>
</article>`;
}

export function configAgentsPage(g: ConfigGraph): { path: string; html: string } {
  const l = links(OUT.configAgents);
  const global = g.agents.filter((a) => !a.workflowLocal);
  const local = g.agents.filter((a) => a.workflowLocal);
  const section = (title: string, list: AgentCfg[]): string =>
    list.length ? `<h2>${title} <span class="dim">${String(list.length)}</span></h2>${list.map((a) => agentCard(l, g, a)).join("")}` : "";
  const body = `<h1>Agents <span class="dim">${String(g.agents.length)}</span></h1>
  <p class="meta">${loaderLink(l, g.loaders.agents, "loadAgentProfiles")}</p>
  ${section("Global profiles", global)}
  ${section("Workflow-local profiles", local)}`;
  return { path: OUT.configAgents, html: cfgPage(OUT.configAgents, "agents", "Agents", body) };
}

// ── Workflows ───────────────────────────────────────────────────────────────
function workflowCard(l: L, g: ConfigGraph, w: WorkflowCfg): string {
  const tools = w.tools.map((t) => toolLink(l, g, t)).join(" ");
  const roles = w.roleAgents.map((r) => `<a class="tag" href="${l.cfg.agents(r)}">${esc(r)}</a>`).join(" ");
  const args = w.argEntries
    .map((e) => `<tr><td><code>${esc(e.key)}</code></td><td><code>${esc(e.value)}</code></td></tr>`)
    .join("");
  const scripts = w.scripts.length
    ? w.scripts.map((s) => `<a href="${l.raw(s)}"><code>${esc(s.split("/").pop()!)}</code></a>`).join(" · ")
    : '<span class="dim">none</span>';
  return `<article class="cfg-card" id="wf-${esc(w.name)}">
  <h3>${esc(w.name)} <span class="pill">${esc(w.type)}</span></h3>
  <p class="dim">${esc(w.description)}</p>
  <dl class="cfg-kv">
    <dt>tools</dt><dd class="tags">${tools}</dd>
    <dt>role agents</dt><dd>${roles || '<span class="dim">—</span>'}</dd>
    <dt>scripts</dt><dd>${scripts}</dd>
    <dt>store</dt><dd>${w.store ? `<a href="${l.raw(w.store)}"><code>${esc(w.store)}</code></a>` : '<span class="dim">—</span>'}</dd>
    <dt>config</dt><dd><a href="${l.raw(w.file)}"><code>${esc(w.file)}</code></a></dd>
  </dl>
  ${args ? `<table class="cfg-args"><thead><tr><th>arg</th><th>value</th></tr></thead><tbody>${args}</tbody></table>` : ""}
  <details><summary>docs</summary><div class="prose small">${renderMarkdown(w.docs)}</div></details>
</article>`;
}

export function configWorkflowsPage(g: ConfigGraph): { path: string; html: string } {
  const l = links(OUT.configWorkflows);
  const body = `<h1>Workflows <span class="dim">${String(g.workflows.length)}</span></h1>
  <p class="meta">${loaderLink(l, g.loaders.workflows, "loadWorkflowConfigs")}</p>
  ${g.workflows.map((w) => workflowCard(l, g, w)).join("")}`;
  return { path: OUT.configWorkflows, html: cfgPage(OUT.configWorkflows, "workflows", "Workflows", body) };
}

// ── Hooks ───────────────────────────────────────────────────────────────────
export function configHooksPage(g: ConfigGraph): { path: string; html: string } {
  const l = links(OUT.configHooks);
  const rows = g.hooks
    .map(
      (h, i) => `<tr id="hook-${String(i)}"><td><span class="pill">${esc(h.event)}</span></td><td>${h.toolName ? toolLink(l, g, h.toolName) : '<span class="dim">all tools</span>'}</td><td><code>${esc(h.command)}</code></td></tr>`,
    )
    .join("");
  const body = `<h1>Hooks <span class="dim">${String(g.hooks.length)}</span></h1>
  <p class="meta">${loaderLink(l, g.loaders.hooks, "loadHookConfig")}</p>
  <p class="dim">Subprocess command hooks on the SDK's three events, compiled to callbacks via <code>executeJsonCommand</code> — facts JSON on stdin, a verdict/notification on stdout.</p>
  ${g.hooks.length
    ? `<table class="sym"><thead><tr><th>event</th><th>tool matcher</th><th>command</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="note"><code>.eos-agents/hooks/hooks.json</code> is currently empty (<code>[]</code>). No host hooks configured.</div>`}`;
  return { path: OUT.configHooks, html: cfgPage(OUT.configHooks, "hooks", "Hooks", body) };
}

// ── LLM Clients ─────────────────────────────────────────────────────────────
function clientCard(l: L, g: ConfigGraph, c: LlmClientCfg): string {
  const users = (g.usedBy[c.id] ?? []).map((a) => `<a class="tag" href="${l.cfg.agents(a)}">${esc(a)}</a>`).join(" ");
  return `<article class="cfg-card" id="client-${esc(c.id)}">
  <h3>${esc(c.id)}</h3>
  <dl class="cfg-kv">
    <dt>provider</dt><dd><code>${esc(c.provider)}</code></dd>
    <dt>model</dt><dd><code>${esc(c.modelId)}</code></dd>
    <dt>reasoning</dt><dd>${c.reasoningEffort ? `<code>${esc(c.reasoningEffort)}</code>` : '<span class="dim">—</span>'}</dd>
    <dt>base url</dt><dd>${c.baseUrl ? `<code>${esc(c.baseUrl)}</code>` : '<span class="dim">default</span>'}</dd>
    <dt>auth</dt><dd><span class="pill">${esc(c.authKind)}</span> <span class="dim">(credential redacted)</span></dd>
    <dt>used by</dt><dd>${users || '<span class="dim">no agents</span>'}</dd>
  </dl>
</article>`;
}

export function configClientsPage(g: ConfigGraph): { path: string; html: string } {
  const l = links(OUT.configClients);
  const body = `<h1>LLM Clients <span class="dim">${String(g.llmClients.length)}</span></h1>
  <p class="meta">${loaderLink(l, g.loaders.llmClients, "loadLlmClients")} · credentials and auth paths are never emitted</p>
  ${g.llmClients.map((c) => clientCard(l, g, c)).join("")}`;
  return { path: OUT.configClients, html: cfgPage(OUT.configClients, "clients", "LLM Clients", body) };
}

// ── Graph (config landing) ──────────────────────────────────────────────────
export function configIndexPage(g: ConfigGraph): { path: string; html: string } {
  const l = links(OUT.configIndex);
  const edge = (label: string, html: string): string => `<div class="edge"><span class="ek">${label}</span>${html}</div>`;
  const agentNode = (a: AgentCfg): string => `<div class="gnode" id="agent-${esc(a.name)}">
    <a class="gn-h" href="${l.cfg.agents(a.name)}">${esc(a.name)}</a>
    ${edge("client", `<a class="tag" href="${l.cfg.clients(a.llmClientId)}">${esc(a.llmClientId)}</a>`)}
    ${a.workflows.length ? edge("workflows", a.workflows.map((w) => `<a class="tag" href="${l.cfg.workflows(w)}">${esc(w)}</a>`).join(" ")) : ""}
    ${a.subagents.length ? edge("subagents", a.subagents.map((s) => `<a class="tag" href="${l.cfg.agents(s)}">${esc(s)}</a>`).join(" ")) : ""}
  </div>`;
  const wfNode = (w: WorkflowCfg): string => `<div class="gnode" id="wf-${esc(w.name)}">
    <a class="gn-h" href="${l.cfg.workflows(w.name)}">${esc(w.name)} <span class="pill">${esc(w.type)}</span></a>
    ${edge("tools", w.tools.map((t) => toolLink(l, g, t)).join(" "))}
    ${w.roleAgents.length ? edge("roles", w.roleAgents.map((r) => `<a class="tag" href="${l.cfg.agents(r)}">${esc(r)}</a>`).join(" ")) : ""}
    ${w.scripts.length ? edge("scripts", w.scripts.map((s) => `<a class="tag" href="${l.raw(s)}">${esc(s.split("/").pop()!)}</a>`).join(" ")) : ""}
  </div>`;
  const body = `<h1>Configuration graph</h1>
  <p class="dim">The <code>.eos-agents/</code> runtime config, cross-linked. Every node links to its page; tool names link to their <code>defineTool</code> site.</p>
  <div class="stats">
    <div class="stat"><b>${String(g.agents.length)}</b><span>agents</span></div>
    <div class="stat"><b>${String(g.workflows.length)}</b><span>workflows</span></div>
    <div class="stat"><b>${String(g.hooks.length)}</b><span>hooks</span></div>
    <div class="stat"><b>${String(g.llmClients.length)}</b><span>llm clients</span></div>
    <div class="stat"><b>${String(Object.keys(g.toolIndex).length)}</b><span>tools wired</span></div>
  </div>
  <h2>Agents → wiring</h2><div class="gcols">${g.agents.map(agentNode).join("")}</div>
  <h2>Workflows → wiring</h2><div class="gcols">${g.workflows.map(wfNode).join("")}</div>`;
  return { path: OUT.configIndex, html: cfgPage(OUT.configIndex, "graph", "Graph", body) };
}

/** A compact summary card for the Overview page. */
export function configSummaryCard(g: ConfigGraph, l: L): string {
  return `<a class="mod-card cfg-summary" href="${l.cfg.index}">
    <h3>Configuration</h3>
    <div class="meta">${String(g.agents.length)} agents · ${String(g.workflows.length)} workflows · ${String(g.hooks.length)} hooks · ${String(g.llmClients.length)} llm clients</div>
    <code class="dim">.eos-agents/</code>
  </a>`;
}

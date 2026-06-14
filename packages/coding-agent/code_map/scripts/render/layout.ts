// Page chrome + cross-page link helpers. Every output path is repo-relative so
// links are plain relative hrefs that work from file:// too.

import path from "node:path";

export const OUT = {
  index: "code_map_index.html",
  shell: "code_map/code/index.html",
  coverage: "code_map/coverage/index.html",
  configIndex: "code_map/config/index.html",
  configAgents: "code_map/config/agents.html",
  configWorkflows: "code_map/config/workflows.html",
  configHooks: "code_map/config/hooks.html",
  configClients: "code_map/config/llm-clients.html",
  css: "code_map/assets/theme.css",
  appJs: "code_map/assets/app.js",
  dataJs: "code_map/assets/code-data.js",
  searchData: "code_map/assets/search-data.js",
  navJs: "code_map/assets/nav.js",
  module: (slug: string): string => `code_map/module/${slug}.html`,
};

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rel(from: string, to: string): string {
  return path.posix.relative(path.posix.dirname(from), to) || to.split("/").pop()!;
}

/** Hrefs from a given output page to the rest of the site. */
export function links(from: string): {
  css: string;
  index: string;
  shell: string;
  coverage: string;
  module: (slug: string) => string;
  file: (file: string, line?: number) => string;
  raw: (repoPath: string) => string;
  cfg: {
    index: string;
    agents: (anchor?: string) => string;
    workflows: (anchor?: string) => string;
    hooks: () => string;
    clients: (anchor?: string) => string;
  };
} {
  const shell = rel(from, OUT.shell);
  return {
    css: rel(from, OUT.css),
    index: rel(from, OUT.index),
    shell,
    coverage: rel(from, OUT.coverage),
    module: (slug) => rel(from, OUT.module(slug)),
    file: (file, line) => `${shell}#/${file}${line ? `~L${String(line)}` : ""}`,
    raw: (repoPath) => rel(from, repoPath),
    cfg: {
      index: rel(from, OUT.configIndex),
      agents: (a) => rel(from, OUT.configAgents) + (a ? `#agent-${a}` : ""),
      workflows: (w) => rel(from, OUT.configWorkflows) + (w ? `#wf-${w}` : ""),
      hooks: () => rel(from, OUT.configHooks),
      clients: (c) => rel(from, OUT.configClients) + (c ? `#client-${c}` : ""),
    },
  };
}

export interface PageOpts {
  from: string;
  title: string;
  tab: "overview" | "code" | "coverage" | "config";
  crumbs?: { label: string; href?: string }[];
  body: string;
  /** Extra <script> srcs (relative to this page). */
  scripts?: string[];
  bodyClass?: string;
}

export function page(o: PageOpts): string {
  const l = links(o.from);
  const tab = (id: string, label: string, href: string): string =>
    `<a class="tab${o.tab === id ? " on" : ""}" href="${href}">${label}</a>`;
  const crumbs = (o.crumbs ?? [])
    .map((c) => (c.href ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`))
    .join('<span class="sep">/</span>');
  const base = [
    `<script src="${rel(o.from, OUT.searchData)}"></script>`,
    `<script src="${rel(o.from, OUT.navJs)}" defer></script>`,
  ].join("");
  const scripts = base + (o.scripts ?? []).map((s) => `<script src="${s}"></script>`).join("");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)} · eos-coding-agent</title>
<link rel="stylesheet" href="${l.css}">
</head><body class="${o.bodyClass ?? ""}">
<header class="topbar">
  <a class="brand" href="${l.index}">eos-coding-agent<span>explorer</span></a>
  <input id="q" class="search" type="search" placeholder="Search symbols, files…  ( / )" autocomplete="off" data-shell="${l.shell}">
  <nav class="tabs">${tab("overview", "Overview", l.index)}${tab("code", "Code Map", l.shell)}${tab("coverage", "Coverage", l.coverage)}${tab("config", "Configuration", l.cfg.index)}</nav>
</header>
${crumbs ? `<div class="crumbs">${crumbs}</div>` : ""}
<main>${o.body}</main>
<footer class="foot">generated from <code>code_map/data</code> · static, no build server</footer>
<div id="results" class="results" hidden></div>
${scripts}
</body></html>`;
}

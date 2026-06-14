// Server-rendered pages: Overview (index), per-module, Coverage, and the Code
// Map shell. Symbol lists use the §4 ordering profiles.

import type {
  ImportEdge,
  Manifest,
  ModuleRec,
  ReferenceRec,
  SourceFileRec,
  SymbolRec,
  TestFileRec,
} from "../extract/model.js";
import { BAND_META, groupByBand, surfaceOrder, VIS_META } from "./order.js";
import { esc, links, OUT, page } from "./layout.js";

export interface Data {
  pkg: { name: string; version: string; description?: string };
  readme: string | null;
  modules: ModuleRec[];
  symbols: SymbolRec[];
  references: Record<string, ReferenceRec>;
  imports: { edges: ImportEdge[]; moduleEdges: { from: string; to: string; weight: number }[] };
  source: Record<string, SourceFileRec>;
  tests: { testFiles: TestFileRec[]; e2eMatrixMarkdown: string };
  manifest: Manifest;
}

function badge(s: SymbolRec): string {
  return `<span class="kb" title="${esc(s.kind)}">${esc(s.kindTags[0] ?? s.kind)}</span>`;
}
function vis(s: SymbolRec): string {
  const m = VIS_META[s.visibility];
  return `<span class="vis ${m.cls}">${m.label}</span>`;
}

function symbolRow(s: SymbolRec, fileHref: (f: string, l?: number) => string, refs: number): string {
  return `<tr>
  <td>${badge(s)}</td>
  <td><a class="sy" href="${fileHref(s.file, s.decl.line)}">${esc(s.name)}</a></td>
  <td>${vis(s)}</td>
  <td class="sig"><code>${esc(s.signature)}</code></td>
  <td class="num">${refs ? String(refs) : ""}</td>
</tr>`;
}

// ── Overview ────────────────────────────────────────────────────────────────
export function overviewPage(d: Data, readmeHtml: string | null): string {
  const from = OUT.index;
  const l = links(from);
  const tops = d.symbols.filter((s) => !s.container);

  const publicByModule = new Map<string, SymbolRec[]>();
  for (const s of tops.filter((x) => x.visibility === "public-api").sort(surfaceOrder)) {
    (publicByModule.get(s.module) ?? publicByModule.set(s.module, []).get(s.module)!).push(s);
  }
  const apiCard = [...publicByModule.entries()]
    .map(
      ([m, list]) =>
        `<div class="api-grp"><h4>${esc(m)}</h4>${list
          .map((s) => `<a class="chip" href="${l.file(s.file, s.decl.line)}">${badge(s)}${esc(s.name)}</a>`)
          .join("")}</div>`,
    )
    .join("");

  const cards = d.modules
    .map(
      (m) => `<a class="mod-card" href="${l.module(slugOfModule(d, m.id))}">
    <h3>${esc(m.id)}</h3>
    <div class="meta">${String(m.files.length)} files · ${String(m.symbolCount)} symbols · <span class="v-pub">${String(m.publicCount)} public</span></div>
    <code class="dim">${esc(m.dir)}</code>
  </a>`,
    )
    .join("");

  const edges = d.imports.moduleEdges
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((e) => `<li><code>${esc(e.from)}</code> <span class="arrow">→</span> <code>${esc(e.to)}</code> <span class="num">${String(e.weight)}</span></li>`)
    .join("");

  const readmeBlock = readmeHtml
    ? `<section class="prose">${readmeHtml}</section>`
    : `<section class="note">No <code>README.md</code> in this package. This overview is synthesized from <code>package.json</code> and the <code>src/index.ts</code> public-API barrel.</section>`;

  const all = d.symbols;
  const count = (p: (s: SymbolRec) => boolean): number => all.filter(p).length;
  const stats: { n: number; l: string }[] = [
    { n: d.modules.length, l: "modules" },
    { n: count((s) => !s.container && s.kind !== "barrel-reexport"), l: "symbols" },
    { n: count((s) => s.kind === "class"), l: "classes" },
    { n: count((s) => s.kind === "method"), l: "methods" },
    { n: count((s) => s.kind === "function"), l: "functions" },
    { n: count((s) => !s.container && s.visibility === "public-api"), l: "public API" },
  ];
  const statsHtml = `<div class="stats">${stats
    .map((s) => `<div class="stat"><b>${String(s.n)}</b><span>${s.l}</span></div>`)
    .join("")}</div>`;

  const body = `
<div class="cols">
  <div class="col-main">
    <h1>${esc(d.pkg.name)} <span class="dim">v${esc(d.pkg.version)}</span></h1>
    ${statsHtml}
    <h2>Modules <span class="dim">${String(d.modules.length)}</span></h2>
    <div class="mod-grid">${cards}</div>
    ${readmeBlock}
    <h2>Public API surface <span class="dim">(${String([...publicByModule.values()].reduce((n, a) => n + a.length, 0))})</span></h2>
    <div class="api-card">${apiCard}</div>
  </div>
  <aside class="col-rail">
    <h3>Imported modules</h3>
    <ul class="edges">${edges}</ul>
    <h3>Build</h3>
    <ul class="kv">
      <li>symbols <b>${String(d.manifest.counts.symbols)}</b></li>
      <li>references <b>${String(d.manifest.counts.references)}</b></li>
      <li>src files <b>${String(d.manifest.counts.srcFiles)}</b></li>
      <li>test files <b>${String(d.manifest.counts.testFiles)}</b></li>
      <li>TS <b>${esc(d.manifest.tsVersion)}</b></li>
    </ul>
  </aside>
</div>`;
  return page({ from, title: "Overview", tab: "overview", body });
}

function slugOfModule(d: Data, moduleId: string): string {
  // A module page is keyed by module id (sanitized) — independent of symbol slugs.
  return moduleId.replace(/[^a-z0-9._-]/gi, "-");
}

// ── Module page ─────────────────────────────────────────────────────────────
export function modulePage(d: Data, m: ModuleRec): { path: string; html: string } {
  const path = OUT.module(slugOfModule(d, m.id));
  const l = links(path);
  const tops = d.symbols.filter((s) => s.module === m.id && !s.container);

  const fileList = m.files
    .map((f) => `<li><a href="${l.file(f.path)}"><code>${esc(f.path)}</code></a> <span class="dim">${String(f.loc)} loc</span></li>`)
    .join("");

  const sections = (["public-api", "module-exported", "file-local"] as const)
    .map((v) => {
      const list = tops.filter((s) => s.visibility === v).sort(surfaceOrder);
      if (!list.length) return "";
      const rows = list.map((s) => symbolRow(s, l.file, d.references[s.symbolId]?.refCount ?? 0)).join("");
      return `<h3 class="vis-h ${VIS_META[v].cls}">${VIS_META[v].label} <span class="dim">${String(list.length)}</span></h3>
      <table class="sym"><thead><tr><th></th><th>name</th><th>vis</th><th>signature</th><th class="num">refs</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join("");

  const body = `
<div class="cols">
  <div class="col-main">
    <h1>module <code>${esc(m.id)}</code></h1>
    <p class="dim">${esc(m.dir)} · ${String(m.files.length)} files · ${String(m.symbolCount)} symbols</p>
    ${sections}
  </div>
  <aside class="col-rail">
    <h3>Files</h3>
    <ul class="files">${fileList}</ul>
  </aside>
</div>`;
  return {
    path,
    html: page({
      from: path,
      title: `module ${m.id}`,
      tab: "overview",
      crumbs: [{ label: "Overview", href: l.index }, { label: m.id }],
      body,
    }),
  };
}

// ── Coverage ────────────────────────────────────────────────────────────────
export function coveragePage(d: Data, e2eHtml: string): string {
  const from = OUT.coverage;
  const l = links(from);

  const rows = d.modules
    .map((m) => {
      const unit = d.tests.testFiles.filter((t) => t.kind === "unit" && t.coversModules.includes(m.id));
      const e2e = d.tests.testFiles.filter((t) => t.kind === "e2e" && t.coversModules.includes(m.id));
      const cell = (list: TestFileRec[]): string =>
        list.length
          ? list.map((t) => `<a href="${l.file(t.path)}" title="${esc(t.path)}">${esc(t.path.split("/").pop()!)}</a>`).join("<br>")
          : '<span class="miss">—</span>';
      return `<tr><td><code>${esc(m.id)}</code></td><td>${cell(unit)}</td><td>${cell(e2e)}</td></tr>`;
    })
    .join("");

  const testList = d.tests.testFiles
    .map(
      (t) =>
        `<li><a href="${l.file(t.path)}"><code>${esc(t.path)}</code></a> <span class="pill ${t.kind}">${t.kind}</span> <span class="dim">${String(t.describes.length)} describe · ${String(t.itCount)} it</span></li>`,
    )
    .join("");

  const unitN = d.tests.testFiles.filter((t) => t.kind === "unit").length;
  const e2eN = d.tests.testFiles.filter((t) => t.kind === "e2e").length;
  const body = `
<div class="page">
  <h1>Tests <span class="dim">${String(d.tests.testFiles.length)} files · ${String(unitN)} unit · ${String(e2eN)} e2e</span></h1>
  <div class="subtabs">
    <input type="radio" name="covtab" id="ct-cov" checked>
    <input type="radio" name="covtab" id="ct-e2e">
    <label for="ct-cov">Test coverage</label>
    <label for="ct-e2e">E2E runtime matrix</label>
    <section class="covpanel" id="p-cov">
      <p class="dim">Structural: which test files import each module's source. Counts are file-level, not line-level.</p>
      <table class="cov"><thead><tr><th>module</th><th>unit (<code>tests/</code>)</th><th>e2e (<code>e2e/</code>)</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Test files <span class="dim">${String(d.tests.testFiles.length)}</span></h2>
      <ul class="files">${testList}</ul>
    </section>
    <section class="covpanel" id="p-e2e">
      <div class="prose">${e2eHtml || '<p class="dim">No markdown found under e2e/runtime/.</p>'}</div>
    </section>
  </div>
</div>`;
  return page({ from, title: "Coverage", tab: "coverage", body });
}

// ── Code Map shell ──────────────────────────────────────────────────────────
interface TreeNode { dirs: Map<string, TreeNode>; files: string[] }

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i])!;
    }
    node.files.push(f);
  }
  return root;
}

function pinIndex(a: string, b: string): number {
  const ai = /\/index\.[tj]s$/.test(a) ? 0 : 1;
  const bi = /\/index\.[tj]s$/.test(b) ? 0 : 1;
  return ai - bi || a.localeCompare(b);
}

function renderTree(node: TreeNode, name: string, open: boolean): string {
  const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const dirHtml = dirs.map(([n, child]) => renderTree(child, n, false)).join("");
  const fileHtml = node.files
    .sort(pinIndex)
    .map((f) => `<a class="tf" data-path="${esc(f)}" href="#/${esc(f)}">${esc(f.split("/").pop()!)}</a>`)
    .join("");
  if (name === "") return dirHtml + fileHtml;
  return `<details${open ? " open" : ""}><summary>${esc(name)}</summary><div class="tree-children">${dirHtml}${fileHtml}</div></details>`;
}

export function shellPage(d: Data): string {
  const from = OUT.shell;
  const tree = renderTree(buildTree(Object.keys(d.source)), "", true);
  const body = `
<div class="ide">
  <nav class="sidebar"><div class="side-h">Files</div><div class="tree">${tree}</div></nav>
  <section class="viewer" id="viewer"><div class="empty">Select a file from the tree to view its source.</div></section>
  <aside class="rail" id="rail"><div class="side-h">Outline</div><div id="outline"></div><div class="side-h">References</div><div id="refs" class="dim">Select a symbol.</div></aside>
</div>`;
  return page({
    from,
    title: "Code Map",
    tab: "code",
    body,
    bodyClass: "full",
    scripts: ["../assets/code-data.js", "../assets/app.js"],
  });
}

// Render entry: read the JSON artifacts and emit the static site. Pages go under
// code_map/; the entry code_map_index.html sits at the package root.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_JS, buildCodeData, buildSearchData, NAV_JS, THEME_CSS } from "./assets.js";
import { OUT } from "./layout.js";
import { renderMarkdown } from "./md.js";
import { coveragePage, type Data, modulePage, overviewPage, shellPage } from "./pages.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA = path.join(PKG_ROOT, "code_map/data");

function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")) as T;
}
function write(rel: string, content: string): void {
  const abs = path.join(PKG_ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function main(): void {
  if (!fs.existsSync(path.join(DATA, "manifest.json"))) {
    process.stderr.write("[render] no data — run the extractor first\n");
    process.exit(1);
  }
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
    name: string;
    version: string;
    description?: string;
  };
  const readmePath = path.join(PKG_ROOT, "README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : null;

  const d: Data = {
    pkg: { name: pkgJson.name, version: pkgJson.version, description: pkgJson.description },
    readme,
    modules: readJson("modules.json"),
    symbols: readJson("symbols.json"),
    references: readJson("references.json"),
    imports: readJson("import-graph.json"),
    source: readJson("source.json"),
    tests: readJson("tests.json"),
    manifest: readJson("manifest.json"),
  };

  const readmeHtml = d.readme ? renderMarkdown(d.readme) : null;
  const e2eHtml = renderMarkdown(d.tests.e2eMatrixMarkdown);

  // Pages
  write(OUT.index, overviewPage(d, readmeHtml));
  for (const m of d.modules) {
    const { path: p, html } = modulePage(d, m);
    write(p, html);
  }
  write(OUT.coverage, coveragePage(d, e2eHtml));
  write(OUT.shell, shellPage(d));

  // Assets
  write(OUT.css, THEME_CSS);
  write(OUT.navJs, NAV_JS);
  write(OUT.appJs, APP_JS);
  write(OUT.searchData, buildSearchData(d.symbols));
  write(OUT.dataJs, buildCodeData(d.symbols, d.references, d.source));

  const pages = 1 + d.modules.length + 2;
  process.stdout.write(`[render] ${String(pages)} pages + 5 assets → code_map/ (entry: code_map_index.html)\n`);
}

main();

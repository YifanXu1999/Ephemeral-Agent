// Extraction entry: build one Program, run every extractor, write JSON artifacts
// under code_map/data/. Pure data — the renderer turns these into HTML.

import fs from "node:fs";
import path from "node:path";
import type { Manifest, ModuleRec, SymbolRec } from "./model.js";
import { buildContext, moduleOf, PKG_ROOT } from "./program.js";
import { buildSymbols } from "./symbols.js";
import { buildImportGraph, buildReferences } from "./graph.js";
import { buildSource } from "./source.js";
import { buildTests } from "./tests.js";

const DATA = path.join(PKG_ROOT, "code_map/data");

function writeJson(name: string, value: unknown): void {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(value));
}

function buildModules(ctx: ReturnType<typeof buildContext>, symbols: SymbolRec[]): ModuleRec[] {
  const byModule = new Map<string, ModuleRec>();
  for (const sf of ctx.srcFiles) {
    const file = ctx.rel(sf.fileName);
    const id = moduleOf(file);
    if (!byModule.has(id)) {
      byModule.set(id, { id, dir: `src/${id === "index" ? "" : id}`.replace(/\/$/, ""), doc: "", files: [], symbolCount: 0, publicCount: 0 });
    }
    byModule.get(id)!.files.push({ path: file, loc: sf.getLineAndCharacterOfPosition(sf.getEnd()).line + 1, doc: "" });
  }
  for (const s of symbols) {
    if (s.container) continue;
    const m = byModule.get(s.module);
    if (!m) continue;
    m.symbolCount++;
    if (s.visibility === "public-api") m.publicCount++;
  }
  for (const m of byModule.values()) m.files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return [...byModule.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

function main(): void {
  fs.mkdirSync(DATA, { recursive: true });
  const t0 = Date.now();
  const ctx = buildContext();
  process.stdout.write(`[extract] ${String(ctx.srcFiles.length)} src files, ${String(ctx.targetFiles.length)} total target files\n`);

  const { symbols, nameIndex } = buildSymbols(ctx);
  process.stdout.write(`[extract] ${String(symbols.length)} symbols\n`);

  const references = buildReferences(ctx, symbols);
  const imports = buildImportGraph(ctx);
  const source = buildSource(ctx, symbols, nameIndex);
  const tests = buildTests(ctx);
  const modules = buildModules(ctx, symbols);

  const searchIndex = symbols
    .filter((s) => !s.container && s.kind !== "barrel-reexport")
    .map((s) => ({
      name: s.name,
      kind: s.kind,
      module: s.module,
      file: s.file,
      line: s.decl.line,
      visibility: s.visibility,
      signature: s.signature,
      haystack: `${s.name} ${s.kind} ${s.module}`.toLowerCase(),
    }));

  const manifest: Manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tsVersion: ctx.ts.version,
    counts: {
      modules: modules.length,
      srcFiles: ctx.srcFiles.length,
      targetFiles: ctx.targetFiles.length,
      symbols: symbols.length,
      references: Object.values(references).reduce((n, r) => n + r.refCount, 0),
      testFiles: tests.testFiles.length,
    },
  };

  writeJson("modules.json", modules);
  writeJson("symbols.json", symbols);
  writeJson("references.json", references);
  writeJson("import-graph.json", imports);
  writeJson("source.json", source);
  writeJson("tests.json", tests);
  writeJson("search-index.json", searchIndex);
  writeJson("manifest.json", manifest);

  process.stdout.write(`[extract] done in ${String(Date.now() - t0)}ms → ${path.relative(PKG_ROOT, DATA)}/\n`);
}

main();

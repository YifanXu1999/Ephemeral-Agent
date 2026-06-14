// Aux layer: structural test→src coverage (from imports) + describe/it scrape,
// plus ingest of the authored e2e/runtime/index.md matrix as raw markdown.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { TestFileRec } from "./model.js";
import { type Ctx, moduleOf } from "./program.js";

export interface TestsOutput {
  testFiles: TestFileRec[];
  e2eMatrixMarkdown: string;
}

export function buildTests(ctx: Ctx): TestsOutput {
  const testFiles: TestFileRec[] = [];

  for (const sf of ctx.targetFiles) {
    const file = ctx.rel(sf.fileName);
    const isUnit = file.startsWith("tests/");
    const isE2e = file.includes(".e2e.");
    if (!isUnit && !isE2e) continue;

    const describes: string[] = [];
    let itCount = 0;
    const coversFiles = new Set<string>();

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const fn = node.expression.text;
        const first = node.arguments[0];
        if (fn === "describe" && first && ts.isStringLiteralLike(first)) {
          describes.push(first.text);
        } else if (fn === "it" || fn === "test") {
          itCount++;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    for (const st of sf.statements) {
      if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        const resolved = ts.resolveModuleName(
          st.moduleSpecifier.text,
          sf.fileName,
          ctx.program.getCompilerOptions(),
          ts.sys,
        ).resolvedModule?.resolvedFileName;
        if (!resolved) continue;
        const rel = ctx.rel(resolved);
        if (rel.startsWith("src/")) coversFiles.add(rel);
      }
    }

    const covered = [...coversFiles];
    testFiles.push({
      path: file,
      kind: isUnit ? "unit" : "e2e",
      describes,
      itCount,
      coversFiles: covered,
      coversModules: [...new Set(covered.map(moduleOf))],
    });
  }

  testFiles.sort((a, b) => (a.path < b.path ? -1 : 1));

  // Ingest the authored matrix doc(s) directly under e2e/runtime (the file has
  // been called index.md and readme.md across refactors) — non-recursive, so
  // fixtures/*.md are excluded.
  let e2eMatrixMarkdown = "";
  const runtimeDir = path.join(ctx.repoRoot, "e2e/runtime");
  if (fs.existsSync(runtimeDir)) {
    const mds = fs
      .readdirSync(runtimeDir)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .sort();
    e2eMatrixMarkdown = mds
      .map((f) => fs.readFileSync(path.join(runtimeDir, f), "utf8"))
      .join("\n\n");
  }

  return { testFiles, e2eMatrixMarkdown };
}

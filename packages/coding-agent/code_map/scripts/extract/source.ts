// Source-with-spans: scan every target file into per-line styled segments and
// stamp each identifier that resolves to a known src declaration with a jump
// target (path + line + symbolId). This is what makes the viewer clickable.

import ts from "typescript";
import type { SourceFileRec, SourceSegment, SymbolRec } from "./model.js";
import type { Ctx } from "./program.js";

function classOf(kind: ts.SyntaxKind): string {
  if (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword) return "k";
  switch (kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateHead:
    case ts.SyntaxKind.TemplateMiddle:
    case ts.SyntaxKind.TemplateTail:
      return "s";
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
      return "n";
    case ts.SyntaxKind.SingleLineCommentTrivia:
    case ts.SyntaxKind.MultiLineCommentTrivia:
      return "c";
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier:
      return "i";
    case ts.SyntaxKind.RegularExpressionLiteral:
      return "r";
    case ts.SyntaxKind.WhitespaceTrivia:
    case ts.SyntaxKind.NewLineTrivia:
      return "w";
    default:
      return "p";
  }
}

export function buildSource(
  ctx: Ctx,
  symbols: SymbolRec[],
  nameIndex: Map<string, string>,
): Record<string, SourceFileRec> {
  const byId = new Map(symbols.map((s) => [s.symbolId, s]));
  const out: Record<string, SourceFileRec> = {};

  for (const sf of ctx.targetFiles) {
    const file = ctx.rel(sf.fileName);
    const isTest = file.startsWith("tests/") || file.includes(".e2e.");
    const text = sf.getFullText();
    const lines: SourceSegment[][] = [[]];
    let cur = lines[0];

    const pushSeg = (raw: string, c: string, extra?: Partial<SourceSegment>): void => {
      const parts = raw.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          cur = [];
          lines.push(cur);
        }
        if (parts[i].length > 0) cur.push({ t: parts[i], c, ...extra });
      }
    };

    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      /*skipTrivia*/ false,
      ts.LanguageVariant.Standard,
      text,
    );
    let kind = scanner.scan();
    while (kind !== ts.SyntaxKind.EndOfFileToken) {
      const start = scanner.getTokenStart();
      const end = scanner.getTokenEnd();
      const raw = text.slice(start, end);
      const c = classOf(kind);
      if (c === "i") {
        const stamped = stampIdentifier(ctx, sf, start, nameIndex, byId);
        pushSeg(raw, "i", stamped);
      } else {
        pushSeg(raw, c);
      }
      kind = scanner.scan();
    }

    out[file] = { path: file, loc: lines.length, isTest, lines };
  }
  return out;
}

function stampIdentifier(
  ctx: Ctx,
  sf: ts.SourceFile,
  pos: number,
  nameIndex: Map<string, string>,
  byId: Map<string, SymbolRec>,
): Partial<SourceSegment> | undefined {
  let defs: readonly ts.DefinitionInfo[] | undefined;
  try {
    defs = ctx.service.getDefinitionAtPosition(sf.fileName, pos);
  } catch {
    return undefined;
  }
  for (const d of defs ?? []) {
    const id = nameIndex.get(`${d.fileName}:${String(d.textSpan.start)}`);
    if (id) {
      const rec = byId.get(id);
      if (rec) return { target: rec.file, line: rec.decl.line, sym: id };
    }
  }
  return undefined;
}

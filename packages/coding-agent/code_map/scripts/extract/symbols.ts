// Core layer: enumerate src declarations with kind, visibility (public-API
// alias-walk from src/index.ts), role band, signatures, docs, and members.

import ts from "typescript";
import type { RoleBand, SymbolRec, Visibility } from "./model.js";
import { type Ctx, makeSlug, moduleOf, symbolId } from "./program.js";

const TYPE_KINDS = new Set(["interface", "type-alias", "enum"]);

function bandOf(kind: string, tags: string[], vis: Visibility): RoleBand {
  if (kind === "class") return "container";
  if (kind === "barrel-reexport") return "reexport";
  if (
    TYPE_KINDS.has(kind) ||
    tags.includes("zod-schema") ||
    tags.includes("typed-id") ||
    tags.includes("dto") ||
    tags.includes("discriminated-union")
  ) {
    return "type";
  }
  if (kind === "function" || kind === "const" || kind === "let") {
    return vis === "file-local" ? "helper" : "function";
  }
  return "type";
}

const BAND_RANK: Record<RoleBand, number> = {
  container: 0,
  type: 1,
  function: 2,
  helper: 3,
  reexport: 4,
};
const VIS_RANK: Record<Visibility, number> = {
  "public-api": 0,
  "module-exported": 1,
  "file-local": 2,
};

/**
 * App-surface anchor: this is an application, not a library — there is no
 * `src/index.ts` barrel. The "public" tier is what the composition root
 * (`src/bootstrap.ts`) actually wires: its own exports plus every symbol it
 * imports, resolved through barrels to the original declaration.
 */
function publicSurface(ctx: Ctx): {
  decls: Set<ts.Declaration>;
  typeOnly: Map<string, boolean>;
} {
  const decls = new Set<ts.Declaration>();
  const typeOnly = new Map<string, boolean>();
  const boot = ctx.program
    .getSourceFiles()
    .find((sf) => ctx.rel(sf.fileName) === "src/bootstrap.ts");
  if (!boot) return { decls, typeOnly };

  const resolve = (sym: ts.Symbol): void => {
    let s = sym;
    const guard = new Set<ts.Symbol>();
    while (s.flags & ts.SymbolFlags.Alias && !guard.has(s)) {
      guard.add(s);
      s = ctx.checker.getAliasedSymbol(s);
    }
    for (const d of s.declarations ?? []) decls.add(d);
  };

  // bootstrap's own exports (bootstrap, CodingAgent, …)
  const bootSym = ctx.checker.getSymbolAtLocation(boot);
  if (bootSym) for (const exp of ctx.checker.getExportsOfModule(bootSym)) resolve(exp);

  // everything bootstrap imports by name, resolved to its original declaration
  for (const st of boot.statements) {
    if (
      ts.isImportDeclaration(st) &&
      st.importClause?.namedBindings &&
      ts.isNamedImports(st.importClause.namedBindings)
    ) {
      for (const el of st.importClause.namedBindings.elements) {
        const s = ctx.checker.getSymbolAtLocation(el.name);
        if (s) resolve(s);
      }
    }
  }
  return { decls, typeOnly };
}

function docOf(ctx: Ctx, sym: ts.Symbol | undefined): string {
  if (!sym) return "";
  return ts.displayPartsToString(sym.getDocumentationComment(ctx.checker)).trim();
}

function signatureOf(ctx: Ctx, sym: ts.Symbol | undefined, decl: ts.Node): { sig: string; typeStr: string } {
  if (!sym) return { sig: "", typeStr: "" };
  try {
    const type = ctx.checker.getTypeOfSymbolAtLocation(sym, decl);
    const calls = type.getCallSignatures();
    const typeStr = ctx.checker.typeToString(type).slice(0, 240);
    if (calls.length > 0) {
      return { sig: ctx.checker.signatureToString(calls[0]).slice(0, 240), typeStr };
    }
    return { sig: typeStr, typeStr };
  } catch {
    return { sig: "", typeStr: "" };
  }
}

function memberRanks(decl: ts.Node): { visRank: number; kindRank: number } {
  const flags = ts.getCombinedModifierFlags(decl as ts.Declaration);
  const visRank = flags & ts.ModifierFlags.Private ? 2 : flags & ts.ModifierFlags.Protected ? 1 : 0;
  const kindRank = ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl) ? 1 : 0;
  return { visRank, kindRank };
}

export interface SymbolOutput {
  symbols: SymbolRec[];
  /** `${fileName}:${nameStart}` → symbolId, for source-token stamping. */
  nameIndex: Map<string, string>;
}

export function buildSymbols(ctx: Ctx): SymbolOutput {
  const { decls: publicDecls, typeOnly } = publicSurface(ctx);
  const symbols: SymbolRec[] = [];
  const nameIndex = new Map<string, string>();

  const push = (rec: SymbolRec, nameNode: ts.Node): void => {
    symbols.push(rec);
    nameIndex.set(`${nameNode.getSourceFile().fileName}:${String(nameNode.getStart())}`, rec.symbolId);
  };

  const classify = (
    decl: ts.NamedDeclaration,
    kind: string,
    tags: string[],
    file: string,
    module: string,
    sf: ts.SourceFile,
  ): SymbolRec | null => {
    const nameNode = decl.name;
    if (!nameNode || !ts.isIdentifier(nameNode)) return null;
    const name = nameNode.text;
    const sym = ctx.checker.getSymbolAtLocation(nameNode);

    const isPublic = publicDecls.has(decl);
    const exported = (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export) !== 0;
    const visibility: Visibility = isPublic ? "public-api" : exported ? "module-exported" : "file-local";

    const band = bandOf(kind, tags, visibility);
    const start = decl.getStart();
    const id = symbolId(file, kind, name, start);
    const { sig, typeStr } = signatureOf(ctx, sym, decl);

    const rec: SymbolRec = {
      symbolId: id,
      slug: makeSlug(module, file, name),
      name,
      kind,
      kindTags: tags,
      visibility,
      typeOnlyPublic: isPublic ? typeOnly.get(name) ?? false : false,
      module,
      file,
      roleBand: band,
      bandRank: BAND_RANK[band],
      visRank: VIS_RANK[visibility],
      memberVisRank: 0,
      memberKindRank: 0,
      container: null,
      members: [],
      decl: { start, end: decl.getEnd(), line: ctx.lineOf(sf, start) },
      nameStart: nameNode.getStart(),
      signature: sig,
      typeString: typeStr,
      doc: docOf(ctx, sym),
      refCount: 0,
      reexportChainToPublic: isPublic ? ["src/index.ts"] : null,
    };
    push(rec, nameNode);
    return rec;
  };

  const addMembers = (
    parent: SymbolRec,
    members: ts.NodeArray<ts.ClassElement | ts.TypeElement>,
    file: string,
    module: string,
    sf: ts.SourceFile,
  ): void => {
    for (const m of members) {
      if (!m.name || !ts.isIdentifier(m.name)) continue;
      const mkind = ts.isMethodDeclaration(m) || ts.isMethodSignature(m) ? "method" : "property";
      const start = m.getStart();
      const name = m.name.text;
      const sym = ctx.checker.getSymbolAtLocation(m.name);
      const { sig, typeStr } = signatureOf(ctx, sym, m);
      const { visRank, kindRank } = memberRanks(m);
      const id = symbolId(file, mkind, `${parent.name}.${name}`, start);
      const rec: SymbolRec = {
        symbolId: id,
        slug: makeSlug(module, file, `${parent.name}.${name}`),
        name,
        kind: mkind,
        kindTags: [],
        visibility: parent.visibility,
        typeOnlyPublic: false,
        module,
        file,
        roleBand: "container",
        bandRank: BAND_RANK.container,
        visRank: parent.visRank,
        memberVisRank: visRank,
        memberKindRank: kindRank,
        container: parent.symbolId,
        members: [],
        decl: { start, end: m.getEnd(), line: ctx.lineOf(sf, start) },
        nameStart: m.name.getStart(),
        signature: sig,
        typeString: typeStr,
        doc: docOf(ctx, sym),
        refCount: 0,
        reexportChainToPublic: null,
      };
      symbols.push(rec);
      nameIndex.set(`${sf.fileName}:${m.name.getStart()}`, id);
      parent.members.push(id);
    }
    parent.members.sort((a, b) => {
      const ra = symbols.find((s) => s.symbolId === a)!;
      const rb = symbols.find((s) => s.symbolId === b)!;
      return ra.memberVisRank - rb.memberVisRank || ra.memberKindRank - rb.memberKindRank || ra.decl.start - rb.decl.start;
    });
  };

  const zodTag = (init: ts.Expression | undefined): string[] => {
    if (!init) return [];
    const txt = init.getText();
    const tags: string[] = [];
    if (/^z\./.test(txt) || /\bz\.(object|string|number|union|discriminatedUnion|record|array|enum|lazy)\b/.test(txt)) {
      tags.push("zod-schema");
    }
    if (/discriminatedUnion\s*\(/.test(txt)) tags.push("discriminated-union");
    return tags;
  };

  for (const sf of ctx.srcFiles) {
    const file = ctx.rel(sf.fileName);
    const module = moduleOf(file);
    for (const st of sf.statements) {
      if (ts.isClassDeclaration(st) && st.name) {
        const rec = classify(st, "class", [], file, module, sf);
        if (rec) addMembers(rec, st.members, file, module, sf);
      } else if (ts.isInterfaceDeclaration(st)) {
        const rec = classify(st, "interface", [], file, module, sf);
        if (rec) addMembers(rec, st.members, file, module, sf);
      } else if (ts.isTypeAliasDeclaration(st)) {
        const tags: string[] = [];
        const tstr = signatureOf(ctx, ctx.checker.getSymbolAtLocation(st.name), st).typeStr;
        const body = st.type.getText();
        const branded = /\$brand|brand</.test(tstr) || /brand</.test(body);
        if (branded || (/\bz\.infer\b/.test(body) && st.name.text.endsWith("Id"))) {
          tags.push("typed-id");
        } else if (/\bz\.infer\b/.test(body)) {
          tags.push("dto");
        }
        classify(st, "type-alias", tags, file, module, sf);
      } else if (ts.isEnumDeclaration(st)) {
        classify(st, "enum", [], file, module, sf);
      } else if (ts.isFunctionDeclaration(st) && st.name) {
        classify(st, "function", [], file, module, sf);
      } else if (ts.isVariableStatement(st)) {
        const isLet = (st.declarationList.flags & ts.NodeFlags.Const) === 0;
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const tags = zodTag(d.initializer);
          classify(d, isLet ? "let" : "const", tags, file, module, sf);
        }
      } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        // Barrel re-export: one synthetic symbol naming the specifier.
        const spec = st.moduleSpecifier.text;
        const start = st.getStart();
        const id = symbolId(file, "barrel-reexport", spec, start);
        symbols.push({
          symbolId: id,
          slug: makeSlug(module, file, spec.replace(/[^a-z0-9]/gi, "-")),
          name: spec,
          kind: "barrel-reexport",
          kindTags: [],
          visibility: "module-exported",
          typeOnlyPublic: st.isTypeOnly,
          module,
          file,
          roleBand: "reexport",
          bandRank: BAND_RANK.reexport,
          visRank: VIS_RANK["module-exported"],
          memberVisRank: 0,
          memberKindRank: 0,
          container: null,
          members: [],
          decl: { start, end: st.getEnd(), line: ctx.lineOf(sf, start) },
          nameStart: start,
          signature: `export … from "${spec}"`,
          typeString: "",
          doc: "",
          refCount: 0,
          reexportChainToPublic: null,
        });
      }
    }
  }

  return { symbols, nameIndex };
}

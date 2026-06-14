// Shared TypeScript foundation: one Program + TypeChecker + LanguageService over
// the package tsconfig, plus identity/position helpers used by every extractor.

import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface Ctx {
  ts: typeof ts;
  program: ts.Program;
  checker: ts.TypeChecker;
  service: ts.LanguageService;
  repoRoot: string;
  /** Source files we care about (src/tests/e2e, excluding coding-agent + d.ts). */
  targetFiles: ts.SourceFile[];
  srcFiles: ts.SourceFile[];
  rel(fileName: string): string;
  lineOf(sf: ts.SourceFile, pos: number): number;
}

// code_map/scripts/extract/program.ts → up 3 to the package root.
export const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function isTarget(rel: string): boolean {
  if (rel.endsWith(".d.ts")) return false;
  if (rel.startsWith("e2e/coding-agent/")) return false;
  return (
    rel.startsWith("src/") || rel.startsWith("tests/") || rel.startsWith("e2e/")
  );
}

export function buildContext(): Ctx {
  const configPath = path.join(PKG_ROOT, "tsconfig.json");
  const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, PKG_ROOT);

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  const texts = new Map<string, string>();
  const readText = (f: string): string | undefined => {
    if (texts.has(f)) return texts.get(f);
    const t = ts.sys.readFile(f);
    if (t !== undefined) texts.set(f, t);
    return t;
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      const t = readText(f);
      return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
    },
    getCurrentDirectory: () => PKG_ROOT,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  const rel = (fileName: string): string =>
    path.relative(PKG_ROOT, fileName).split(path.sep).join("/");

  const targetFiles = program
    .getSourceFiles()
    .filter((sf) => isTarget(rel(sf.fileName)));
  const srcFiles = targetFiles.filter((sf) => rel(sf.fileName).startsWith("src/"));

  const lineOf = (sf: ts.SourceFile, pos: number): number =>
    sf.getLineAndCharacterOfPosition(pos).line + 1;

  return {
    ts,
    program,
    checker,
    service,
    repoRoot: PKG_ROOT,
    targetFiles,
    srcFiles,
    rel,
    lineOf,
  };
}

/** First path segment under src/ is the module; bare src/index.ts → "index". */
export function moduleOf(rel: string): string {
  const parts = rel.split("/");
  if (parts[0] !== "src") return parts[0];
  return parts.length > 2 ? parts[1] : "index";
}

export function symbolId(
  rel: string,
  kind: string,
  name: string,
  start: number,
): string {
  return `${rel}#${kind}:${name}@${String(start)}`;
}

const slugSeen = new Map<string, number>();
export function makeSlug(module: string, rel: string, name: string): string {
  const base = rel.split("/").pop()?.replace(/\.[tj]sx?$/, "") ?? rel;
  const raw = `${module}.${base}.${name}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-");
  const n = slugSeen.get(raw) ?? 0;
  slugSeen.set(raw, n + 1);
  return n === 0 ? raw : `${raw}~${String(n + 1)}`;
}

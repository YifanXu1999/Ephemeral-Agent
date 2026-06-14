// Artifact shapes shared across the extraction pipeline. These are the JSON
// contracts the renderer consumes; keep them denormalized and path-keyed.

export type Visibility = "public-api" | "module-exported" | "file-local";
export type RoleBand = "container" | "type" | "function" | "helper" | "reexport";

export interface Pos {
  start: number;
  end: number;
  line: number; // 1-based
}

export interface SymbolRec {
  symbolId: string;
  slug: string;
  name: string;
  kind: string;
  kindTags: string[];
  visibility: Visibility;
  typeOnlyPublic: boolean;
  module: string;
  file: string; // repo-relative POSIX
  roleBand: RoleBand;
  bandRank: number;
  visRank: number;
  memberVisRank: number; // public 0 / protected 1 / private 2 (top-level = 0)
  memberKindRank: number; // property 0 / method 1 (top-level = 0)
  container: string | null; // parent symbolId for members
  members: string[]; // ordered child symbolIds
  decl: Pos;
  nameStart: number;
  signature: string;
  typeString: string;
  doc: string;
  refCount: number;
  reexportChainToPublic: string[] | null;
}

export interface ReferenceEntry {
  file: string;
  start: number;
  line: number;
  isWrite: boolean;
  crossModule: boolean;
}

export interface ReferenceRec {
  definition: { file: string; start: number; line: number };
  references: ReferenceEntry[];
  refCount: number;
  crossModule: boolean;
}

export interface ModuleRec {
  id: string;
  dir: string;
  doc: string;
  files: { path: string; loc: number; doc: string }[];
  symbolCount: number;
  publicCount: number;
}

export interface ImportEdge {
  from: string;
  to: string;
  specifier: string;
  typeOnly: boolean;
}

export interface SourceSegment {
  t: string; // text
  c: string; // class: k/s/n/c/i/r/w/p
  target?: string; // repo-rel path to jump to (identifier resolves to a known decl)
  line?: number; // 1-based line in target file
  sym?: string; // symbolId of the resolved declaration
}

export interface SourceFileRec {
  path: string;
  loc: number;
  isTest: boolean;
  lines: SourceSegment[][];
}

export interface TestFileRec {
  path: string;
  kind: "unit" | "e2e";
  describes: string[];
  itCount: number;
  coversFiles: string[];
  coversModules: string[];
}

export interface Manifest {
  version: number;
  generatedAt: string;
  tsVersion: string;
  counts: Record<string, number>;
}

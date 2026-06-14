// Banded symbol ordering (the §4 model) shared by every server-rendered list.

import type { RoleBand, SymbolRec, Visibility } from "../extract/model.js";

export const BAND_META: Record<RoleBand, { label: string; badge: string }> = {
  container: { label: "Containers", badge: "C" },
  type: { label: "Types & Contracts", badge: "T" },
  function: { label: "Functions & Values", badge: "ƒ" },
  helper: { label: "Helpers", badge: "·" },
  reexport: { label: "Re-exports", badge: "↪" },
};
export const BAND_ORDER: RoleBand[] = ["container", "type", "function", "helper", "reexport"];

export const VIS_META: Record<Visibility, { label: string; cls: string }> = {
  "public-api": { label: "app", cls: "v-pub" },
  "module-exported": { label: "module", cls: "v-mod" },
  "file-local": { label: "local", cls: "v-loc" },
};

/** File profile: Containers → Types → Functions → Helpers; public over private. */
export function fileOrder(a: SymbolRec, b: SymbolRec): number {
  return (
    a.bandRank - b.bandRank ||
    a.visRank - b.visRank ||
    a.decl.start - b.decl.start ||
    a.name.localeCompare(b.name)
  );
}

/** Surface profile: public-api first, then band, then name. */
export function surfaceOrder(a: SymbolRec, b: SymbolRec): number {
  return (
    a.visRank - b.visRank ||
    a.bandRank - b.bandRank ||
    a.name.localeCompare(b.name)
  );
}

/** Group symbols by role band in canonical band order (drops empty bands). */
export function groupByBand(symbols: SymbolRec[]): { band: RoleBand; items: SymbolRec[] }[] {
  return BAND_ORDER.map((band) => ({
    band,
    items: symbols.filter((s) => s.roleBand === band).sort(fileOrder),
  })).filter((g) => g.items.length > 0);
}

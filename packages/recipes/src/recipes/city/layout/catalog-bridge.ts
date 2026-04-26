/**
 * Catalog bridge: map catalog entries to seed buildings and filter by category.
 * Supports both CatalogLike (from recipe params) and raw objects with id/url/dimensions.
 */

export type SeedBuildingEntry = {
  id: string;
  name: string;
  url: string;
  width?: number;
  depth?: number;
  height?: number;
};

/** Minimal catalog entry shape used by city recipe (id required; rest optional). */
export type CatalogLike = {
  id: string;
  name?: string;
  url?: string;
  category?: string;
  assetType?: string;
  width?: number | null;
  depth?: number | null;
  height?: number | null;
};

const FALLBACK = { width: 5, depth: 3, height: 5 } as const;
const DEFAULT_BUILDING_CATEGORY_HINTS = ["building", "buildings"];

export const CATEGORY_VEHICLES = "Vehicles";

const HAS_GLB_URL = /\.glb(\?|$)/i;

function mergeDims(id: string, partial: Partial<SeedBuildingEntry>): SeedBuildingEntry {
  return {
    id,
    name: partial.name ?? id,
    url: partial.url ?? "",
    width: partial.width != null ? partial.width : FALLBACK.width,
    depth: partial.depth != null ? partial.depth : FALLBACK.depth,
    height: partial.height != null ? partial.height : FALLBACK.height,
  };
}

function hasValidIdAndUrl(e: CatalogLike, requireUrl: boolean): boolean {
  const id = (e.id || "").trim();
  if (!id) return false;
  if (requireUrl && !(e.url && String(e.url).trim())) return false;
  return true;
}

function isBillboardLike(e: CatalogLike): boolean {
  const cat = (e.category || "").toLowerCase();
  const assetType = (e.assetType || "").toLowerCase();
  return cat.includes("billboard") || assetType.includes("billboard");
}

function isBuildingLike(e: CatalogLike, hints: string[]): boolean {
  if (isBillboardLike(e)) return false;
  const cat = (e.category || "").toLowerCase();
  const assetType = (e.assetType || "").toLowerCase();
  const categoryMatch = hints.some((h) => cat.includes(h) || assetType.includes(h));
  const vehicleLike = cat.includes("vehicle") || cat.includes("car") || assetType.includes("vehicle");
  return categoryMatch && !vehicleLike;
}

function hasGlbUrl(e: CatalogLike): boolean {
  return Boolean(e.url && HAS_GLB_URL.test(e.url));
}

/**
 * Convert catalog entries to seed buildings: filter by building-like category (or fallback to any .glb), dedupe by id, apply fallback dimensions.
 */
export function catalogEntriesToSeedBuildings(
  entries: CatalogLike[],
  options?: { categoryHints?: string[]; requireUrl?: boolean }
): SeedBuildingEntry[] {
  const hints = (options?.categoryHints ?? DEFAULT_BUILDING_CATEGORY_HINTS).map((h) => h.toLowerCase());
  const requireUrl = options?.requireUrl ?? true;
  const out: SeedBuildingEntry[] = [];
  const seen = new Set<string>();

  const pushEntry = (e: CatalogLike) => {
    const id = (e.id || "").trim();
    if (!id || seen.has(id) || !hasValidIdAndUrl(e, requireUrl)) return;
    seen.add(id);
    out.push(mergeDims(id, { name: e.name, url: e.url, width: e.width ?? undefined, depth: e.depth ?? undefined, height: e.height ?? undefined }));
  };

  for (const e of entries) {
    if (!hasValidIdAndUrl(e, requireUrl)) continue;
    if (isBuildingLike(e, hints)) pushEntry(e);
  }
  if (out.length === 0) {
    seen.clear();
    for (const e of entries) {
      if (!hasValidIdAndUrl(e, requireUrl) || isBillboardLike(e)) continue;
      if (hasGlbUrl(e)) pushEntry(e);
    }
  }
  return out;
}

/**
 * Collect unique catalog ids for entries that have a .glb url and pass the predicate.
 */
function collectCatalogIds(
  entries: CatalogLike[],
  predicate: (e: CatalogLike) => boolean
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const id = (e.id ?? "").trim();
    if (!id || seen.has(id) || !hasGlbUrl(e) || !predicate(e)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Return catalog ids whose category includes the given string (e.g. "Vehicles"), with .glb url. */
export function getCatalogIdsByCategory(entries: CatalogLike[], category: string): string[] {
  const want = category.trim().toLowerCase();
  if (!want) return [];
  return collectCatalogIds(entries, (e) => (e.category ?? "").toLowerCase().includes(want));
}

/** Return catalog ids for traffic-light props (category contains "prop", id/name contain "traffic"), with .glb url. */
export function getTrafficLightCatalogIds(entries: CatalogLike[]): string[] {
  const traffic = "traffic";
  return collectCatalogIds(entries, (e) => {
    const cat = (e.category ?? "").toLowerCase();
    const name = (e.name ?? "").toLowerCase();
    const id = (e.id ?? "").toLowerCase();
    return cat.includes("prop") && (id.includes(traffic) || name.includes(traffic));
  });
}

/** Catalog ids for billboard assets (category/assetType/id/name contains "billboard"), with .glb url. */
export function getBillboardCatalogIds(entries: CatalogLike[]): string[] {
  return collectCatalogIds(entries, (e) => {
    if (isBillboardLike(e)) return true;
    const id = (e.id ?? "").toLowerCase();
    const name = (e.name ?? "").toLowerCase();
    return id.includes("billboard") || name.includes("billboard");
  });
}

/** Parse raw params.buildings (array of { id, name?, url?, width?, depth?, height? }) into SeedBuildingEntry[]. */
export function normalizeBuildingsParam(raw: unknown): SeedBuildingEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SeedBuildingEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) continue;
    out.push(
      mergeDims(id, {
        name: typeof o.name === "string" ? o.name : undefined,
        url: typeof o.url === "string" ? o.url : undefined,
        width: typeof o.width === "number" ? o.width : undefined,
        depth: typeof o.depth === "number" ? o.depth : undefined,
        height: typeof o.height === "number" ? o.height : undefined,
      }),
    );
  }
  return out.length > 0 ? out : null;
}

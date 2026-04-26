export type CityGenConfig = {
  gridRows: number;
  gridCols: number;
  blockSize: number;
  streetWidth: number;
  buildingSetback: number;
  seed: number;
  pyramidRow?: number;
  pyramidCol?: number;
  /** When true, no pyramid is emitted and the center block is kept empty (no buildings). */
  noPyramid?: boolean;
};

export const DEFAULT_CITY_CONFIG: CityGenConfig = {
  gridRows: 5,
  gridCols: 5,
  blockSize: 30,
  streetWidth: 6,
  buildingSetback: 0.5,
  seed: 42,
  pyramidRow: 1,
  pyramidCol: 1,
};

export function clampCityConfig(
  c: Partial<CityGenConfig> & { noPyramid?: boolean }
): CityGenConfig {
  const n = (v: number | undefined, d: number, min: number, max: number) => {
    if (v == null || Number.isNaN(v)) return d;
    return Math.max(min, Math.min(max, Math.floor(v)));
  };
  const base: CityGenConfig = {
    gridRows: n(c.gridRows, DEFAULT_CITY_CONFIG.gridRows, 2, 20),
    gridCols: n(c.gridCols, DEFAULT_CITY_CONFIG.gridCols, 2, 20),
    blockSize: n(c.blockSize, DEFAULT_CITY_CONFIG.blockSize, 8, 200),
    streetWidth: n(c.streetWidth, DEFAULT_CITY_CONFIG.streetWidth, 2, 30),
    buildingSetback: Math.max(0, Math.min(20, c.buildingSetback ?? DEFAULT_CITY_CONFIG.buildingSetback)),
    seed: n(c.seed, DEFAULT_CITY_CONFIG.seed, 0, 2 ** 31 - 1),
  };
  if (c.pyramidRow != null && c.pyramidCol != null &&
      Number.isFinite(c.pyramidRow) && Number.isFinite(c.pyramidCol)) {
    base.pyramidRow = Math.max(0, Math.min(base.gridRows - 2, Math.floor(c.pyramidRow)));
    base.pyramidCol = Math.max(0, Math.min(base.gridCols - 2, Math.floor(c.pyramidCol)));
  } else if (
    !c.noPyramid &&
    DEFAULT_CITY_CONFIG.pyramidRow != null &&
    DEFAULT_CITY_CONFIG.pyramidCol != null
  ) {
    base.pyramidRow = Math.max(0, Math.min(base.gridRows - 2, DEFAULT_CITY_CONFIG.pyramidRow));
    base.pyramidCol = Math.max(0, Math.min(base.gridCols - 2, DEFAULT_CITY_CONFIG.pyramidCol));
  }
  return { ...base, noPyramid: !!c.noPyramid };
}

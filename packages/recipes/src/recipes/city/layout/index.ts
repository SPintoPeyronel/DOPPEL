/**
 * City layout: constants, layout generation, and catalog→seed building mapping.
 * Re-exports from constants, city-layout, and catalog-bridge for the city recipe.
 */
export { BLOCK_SIZE_M } from "./constants.js";
export { generateCityLayout } from "./city-layout.js";
export type { BuildingPlacement, CityLayoutConfig, CityLayoutResult, StreetSegment } from "./city-layout.js";
export type { SeedBuildingEntry } from "./catalog-bridge.js";
export {
  catalogEntriesToSeedBuildings,
  CATEGORY_VEHICLES,
  getBillboardCatalogIds,
  getCatalogIdsByCategory,
  getTrafficLightCatalogIds,
  normalizeBuildingsParam,
  type CatalogLike,
} from "./catalog-bridge.js";

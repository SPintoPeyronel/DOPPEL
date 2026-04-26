/**
 * Recipe city MML: streets, buildings, pyramid, lights, vehicles.
 * Uses layout for grid + packing; emits MML for models, cubes, grass, etc.
 */
import {
  BLOCK_SIZE_M,
  generateCityLayout,
  type BuildingPlacement,
  type StreetSegment,
  type SeedBuildingEntry,
} from "./layout/index.js";
import { mulberry32, r2, deg } from "./prng.js";
import type { CityGenConfig } from "./config.js";
import { clampCityConfig } from "./config.js";

// --- Helpers -----------------------------------------------------------------

/** Pick a random element from a readonly array using the given PRNG. */
function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// --- Building attachments (windows, antennas) --------------------------------

/** Building catalog IDs that receive window cubes (only these get emitWindows when no antenna). */
const BUILDING_CATALOG_IDS_WITH_WINDOWS = new Set<string>(["Building2"]);

const ANTENNA_HEIGHT_THRESHOLD = 8;
const ANTENNA_CHANCE = 0.4;
const ANTENNA_COLORS = [
  "#ff0040", "#00ff88", "#00aaff", "#ff6600",
  "#cc00ff", "#ffdd00", "#ff0088", "#00ffcc",
];
const WINDOW_COLORS = ["#ff0040", "#00ff88", "#00aaff", "#ff6600", "#cc00ff"];
const WINS_PER_FACE_MIN = 2;
const WINS_PER_FACE_MAX = 4;

const WIN_W = 0.35;
const WIN_H = 0.45;
/** Emissive strength for window cubes; higher than generic props so small faces read on mobile (DPR cap, bloom). */
const WIN_INTENSITY = 7.0;

// --- Pyramid -----------------------------------------------------------------

const STONE_VARIANTS = ["#8a8578", "#6e6960", "#9e978a"];
/** Pyramid corner emissive palette (mixed hues). */
const GLOW_COLORS = [
  "#ff0040", "#00ff88", "#00aaff", "#ff6600",
  "#cc00ff", "#ffdd00", "#ff0088", "#00ffcc",
  "#00ff66", "#ff3366", "#66aaff", "#ffaa00",
];
const DOOR_HEIGHT_LAYERS = 3;
const PYRAMID_BLOCK_SIZE = 1;
const PYRAMID_LAYERS = 20;
const PYRAMID_DOOR_WIDTH_BLKS = 3;
/** Max centre offset from cell middle as fraction of cell size (keeps pyramid inside cell). */
const PYRAMID_JITTER_FRAC = 0.22;

type PyramidBlock = {
  x: number; y: number; z: number; size: number;
  color: string; emission?: string;
  layer: number; isCorner: boolean;
  pulseDim?: number;
  pulseBright?: number;
};

type PyramidGrassPatch = { dx: number; dz: number; count: number; spread: number; h: number };

type CellBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

// --- Cell / pyramid helpers --------------------------------------------------

/** Returns a function that gives the world bounds of a grid cell by (row, col). */
function getCellBounds(cfg: {
  gridRows: number; gridCols: number; blockSize: number; streetWidth: number; centerX: number; centerZ: number;
}): (row: number, col: number) => CellBounds | null {
  const totalW = (cfg.gridCols - 1) * cfg.blockSize;
  const totalD = (cfg.gridRows - 1) * cfg.blockSize;
  const ox = cfg.centerX - totalW / 2;
  const oz = cfg.centerZ - totalD / 2;
  const hw = cfg.streetWidth / 2;
  return (row: number, col: number) => {
    if (row < 0 || row >= cfg.gridRows - 1 || col < 0 || col >= cfg.gridCols - 1) return null;
    return {
      minX: ox + col * cfg.blockSize + hw,
      maxX: ox + (col + 1) * cfg.blockSize - hw,
      minZ: oz + row * cfg.blockSize + hw,
      maxZ: oz + (row + 1) * cfg.blockSize - hw,
    };
  };
}

function buildingInCell(b: BuildingPlacement, cell: CellBounds): boolean {
  return b.x >= cell.minX && b.x <= cell.maxX && b.z >= cell.minZ && b.z <= cell.maxZ;
}

/** Deterministic seed from city seed + cell so same city layout reproduces same pyramid look. */
function pyramidSeedForCell(cell: CellBounds, citySeed: number): number {
  let h = (citySeed ^ 0x9e3779b9) >>> 0;
  const mix = (x: number) => {
    h ^= x;
    h = Math.imul(h, 2654435761) >>> 0;
  };
  mix(cell.minX | 0);
  mix(cell.maxX | 0);
  mix(cell.minZ | 0);
  mix(cell.maxZ | 0);
  return h;
}

function generatePyramidForCell(
  cell: CellBounds,
  citySeed: number,
): { blocks: PyramidBlock[]; totalLayers: number; baseWidth: number } {
  const rng = mulberry32(pyramidSeedForCell(cell, citySeed));
  const blocks: PyramidBlock[] = [];
  // One random emissive color + pulse range for the whole pyramid.
  const glowColor = pick(GLOW_COLORS, rng);
  const pulseDim = 0.25 + rng() * 0.25;
  const pulseBright = 2.5 + rng() * 2.5;
  const cellSize = Math.min(cell.maxX - cell.minX, cell.maxZ - cell.minZ);
  const baseWidth = cellSize * 0.85;
  const baseBlocks = Math.floor(baseWidth / PYRAMID_BLOCK_SIZE);
  const totalLayers = Math.min(PYRAMID_LAYERS, Math.floor(baseBlocks / 2));

  for (let layer = 0; layer < totalLayers; layer++) {
    const span = baseBlocks - layer * 2;
    if (span < 1) break;
    const half = (span * PYRAMID_BLOCK_SIZE) / 2;
    const y = layer * PYRAMID_BLOCK_SIZE + PYRAMID_BLOCK_SIZE / 2;
    const doorCentre = Math.floor(span / 2);
    const doorHalf = Math.floor(PYRAMID_DOOR_WIDTH_BLKS / 2);

    for (let bx = 0; bx < span; bx++) {
      for (let bz = 0; bz < span; bz++) {
        const onEdge = bx === 0 || bx === span - 1 || bz === 0 || bz === span - 1;
        if (!onEdge) continue;
        if (layer < DOOR_HEIGHT_LAYERS && (bz === 0 || bz === span - 1) &&
            bx >= doorCentre - doorHalf && bx <= doorCentre + doorHalf) continue;

        const x = -half + bx * PYRAMID_BLOCK_SIZE + PYRAMID_BLOCK_SIZE / 2;
        const z = -half + bz * PYRAMID_BLOCK_SIZE + PYRAMID_BLOCK_SIZE / 2;
        const isCorner = (bx === 0 || bx === span - 1) && (bz === 0 || bz === span - 1);
        if (isCorner) {
          blocks.push({
            x, y, z, size: PYRAMID_BLOCK_SIZE,
            color: glowColor, emission: glowColor, layer, isCorner: true,
            pulseDim, pulseBright,
          });
        } else {
          const color = pick(STONE_VARIANTS, rng);
          blocks.push({ x, y, z, size: PYRAMID_BLOCK_SIZE, color, layer, isCorner: false });
        }
      }
    }
  }
  return { blocks, totalLayers, baseWidth };
}

const PULSE_CYCLE_MS = 2000;
const PULSE_DIM = 0.3;
const PULSE_BRIGHT = 3;
/** Match engine create-agent-documents / grass default y (was 0.6 briefly). */
const PYRAMID_GRASS_Y = 0.005;
const PYRAMID_GRASS_EMISSION_INTENSITY = 0.075;
const PYRAMID_GRASS_COLOR_DARK = "#008833";

const PYRAMID_GRASS_PATCHES: readonly PyramidGrassPatch[] = [
  { dx: -3, dz: -3, count: 80, spread: 0.8, h: 0.25 },
  { dx: 3, dz: -3, count: 70, spread: 0.7, h: 0.2 },
  { dx: -3, dz: 3, count: 75, spread: 0.7, h: 0.3 },
  { dx: 3, dz: 3, count: 65, spread: 0.6, h: 0.2 },
  { dx: 0, dz: 0, count: 90, spread: 0.9, h: 0.35 },
  { dx: -1, dz: 2, count: 60, spread: 0.5, h: 0.2 },
  { dx: 2, dz: -1, count: 55, spread: 0.5, h: 0.25 },
];

function emitPyramidBlock(parts: string[], idx: number, block: PyramidBlock, cx: number, cz: number, layerDelay: number): void {
  const s = r2(block.size);
  const bx = r2(block.x + cx);
  const by = r2(block.y);
  const bz = r2(block.z + cz);
  let attrs = `id="pyr-${idx}" x="${bx}" y="${by}" z="${bz}"`;
  /** Only the base layer (outside perimeter of pyramid) has collision; upper layers are non-colliding. */
  const collide = block.layer === 0 ? "true" : "false";
  attrs += ` width="${s}" height="${s}" depth="${s}" color="${block.color}" collide="${collide}"`;
  if (!block.isCorner || !block.emission) {
    parts.push(`  <m-cube ${attrs} />`);
    return;
  }
  const dim = block.pulseDim ?? PULSE_DIM;
  const bright = block.pulseBright ?? PULSE_BRIGHT;
  attrs += ` emission="${block.emission}" emission-intensity="${r2(dim)}"`;
  const startTime = Math.round(block.layer * layerDelay);
  parts.push(`  <m-cube ${attrs}>`);
  parts.push(`    <m-attr-anim attr="emission-intensity" start="${r2(dim)}" end="${r2(bright)}" duration="${PULSE_CYCLE_MS}" start-time="${startTime}" loop="true" ping-pong="true" easing="easeInOutSine" />`);
  parts.push(`  </m-cube>`);
}

function emitPyramidGrass(
  parts: string[],
  cx: number,
  cz: number,
  baseWidth: number,
  grassColor: string,
): void {
  const maxSpread = baseWidth * 0.25;
  for (let i = 0; i < PYRAMID_GRASS_PATCHES.length; i++) {
    const patch = PYRAMID_GRASS_PATCHES[i]!;
    const spread = Math.min(patch.spread, maxSpread);
    parts.push(
      `  <m-grass id="pyr-grass-${i}" x="${r2(cx + patch.dx)}" y="${r2(PYRAMID_GRASS_Y)}" z="${r2(cz + patch.dz)}"` +
      ` count="${patch.count}" spread-x="${r2(spread)}" spread-z="${r2(spread)}" height="${patch.h}"` +
      ` color="${grassColor}" color-dark="${PYRAMID_GRASS_COLOR_DARK}" emission="${grassColor}" emission-intensity="${PYRAMID_GRASS_EMISSION_INTENSITY}" />`,
    );
  }
}

function emitPyramidParticles(
  parts: string[],
  cx: number,
  cz: number,
  baseWidth: number,
  particleColor: string,
): void {
  const maxSpread = baseWidth * 0.25;
  for (let i = 0; i < PYRAMID_GRASS_PATCHES.length; i++) {
    const patch = PYRAMID_GRASS_PATCHES[i]!;
    const spread = Math.min(patch.spread, maxSpread);
    const particleCount = Math.min(512, Math.max(96, Math.floor(patch.count * 1.2)));
    parts.push(
      `  <m-particle id="pyr-particle-${i}" x="${r2(cx + patch.dx)}" y="${r2(PYRAMID_GRASS_Y)}" z="${r2(cz + patch.dz)}"` +
      ` count="${particleCount}" spread-x="${r2(spread)}" spread-z="${r2(spread)}" spread-y="${r2(patch.h * 0.15)}"` +
      ` spawn-radius="0.45" color="${particleColor}" />`,
    );
  }
}

function emitPyramid(
  parts: string[],
  cell: CellBounds,
  offsetX: number,
  offsetZ: number,
  citySeed: number,
): void {
  const { blocks, totalLayers, baseWidth } = generatePyramidForCell(cell, citySeed);
  const rng = mulberry32(pyramidSeedForCell(cell, citySeed) ^ 0xbeef);
  const cellW = cell.maxX - cell.minX;
  const cellD = cell.maxZ - cell.minZ;
  const jitterX = (rng() - 0.5) * cellW * PYRAMID_JITTER_FRAC;
  const jitterZ = (rng() - 0.5) * cellD * PYRAMID_JITTER_FRAC;
  const cx = (cell.minX + cell.maxX) / 2 + offsetX + jitterX;
  const cz = (cell.minZ + cell.maxZ) / 2 + offsetZ + jitterZ;
  const layerDelay = PULSE_CYCLE_MS / Math.max(1, totalLayers);
  for (let i = 0; i < blocks.length; i++) emitPyramidBlock(parts, i, blocks[i]!, cx, cz, layerDelay);
  const grassColor =
    blocks.find((b) => b.isCorner && b.emission)?.emission ?? GLOW_COLORS[0]!;
  emitPyramidGrass(parts, cx, cz, baseWidth, grassColor);
  emitPyramidParticles(parts, cx, cz, baseWidth, grassColor);
}

/** Antenna on roof; buildingScale matches building m-model sx,sy,sz so position aligns. */
function emitAntenna(
  parts: string[],
  idx: number,
  b: BuildingPlacement,
  bx: number,
  bz: number,
  rng: () => number,
  buildingScale: number,
): void {
  const poleH = 0.8 + rng() * 1.2;
  const poleW = 0.08 + rng() * 0.06;
  const tipSize = 0.15 + rng() * 0.15;
  const color = pick(ANTENNA_COLORS, rng);
  const intensity = 3 + rng() * 7;
  const roofY = b.height * buildingScale;
  const localX = (rng() - 0.5) * b.width * 0.4 * buildingScale;
  const localZ = (rng() - 0.5) * b.depth * 0.4 * buildingScale;
  const cosR = Math.cos(b.rotation);
  const sinR = Math.sin(b.rotation);
  const wx = bx + localX * cosR - localZ * sinR;
  const wz = bz + localX * sinR + localZ * cosR;
  const poleY = roofY + poleH / 2;
  const tipY = roofY + poleH + tipSize / 2;
  parts.push(
    `  <m-cube id="ant-pole-${idx}" x="${r2(wx)}" y="${r2(poleY)}" z="${r2(wz)}" width="${r2(poleW)}" height="${r2(poleH)}" depth="${r2(poleW)}" color="#666666" collide="false" />`,
    `  <m-cube id="ant-tip-${idx}" x="${r2(wx)}" y="${r2(tipY)}" z="${r2(wz)}" width="${r2(tipSize)}" height="${r2(tipSize)}" depth="${r2(tipSize)}" color="${color}" emission="${color}" emission-intensity="${r2(intensity)}" collide="false" />`,
  );
}

const BILLBOARD_FACADE_CHANCE = 0.34;
const BILLBOARD_SCALE = 0.52;
const BILLBOARD_FACE_PAD = 0.1;
const BILLBOARD_Y_FRAC_MIN = 0.38;
const BILLBOARD_Y_FRAC_MAX = 0.82;

/** Scale windows to match scaled building (sx,sy,sz). */
function emitWindows(
  parts: string[],
  idx: number,
  b: BuildingPlacement,
  bx: number,
  bz: number,
  rng: () => number,
  buildingScale: number,
  windowColors: readonly string[],
  winIntensity: number,
): void {
  const θ = b.rotation;
  const cosR = Math.cos(θ);
  const sinR = Math.sin(θ);
  const geoCX = bx;
  const geoCZ = bz;
  const palette = windowColors.length > 0 ? windowColors : WINDOW_COLORS;
  const wColor = pick(palette, rng);
  let winIdx = 0;
  const hw = (b.width / 2) * buildingScale;
  const hd = (b.depth / 2) * buildingScale;
  const spanW = b.width * buildingScale;
  const spanD = b.depth * buildingScale;
  const faceHeight = b.height * buildingScale;
  const faces = [
    { nx: 0, nz: 1, dist: hd, span: spanW, winRy: θ },
    { nx: 0, nz: -1, dist: hd, span: spanW, winRy: θ + Math.PI },
    { nx: -1, nz: 0, dist: hw, span: spanD, winRy: θ - Math.PI / 2 },
    { nx: 1, nz: 0, dist: hw, span: spanD, winRy: θ + Math.PI / 2 },
  ];
  for (const face of faces) {
    const perFace = WINS_PER_FACE_MIN + Math.floor(rng() * (WINS_PER_FACE_MAX - WINS_PER_FACE_MIN + 1));
    const placed: { lat: number; y: number }[] = [];
    const PAD = 0.05;
    let attempts = 0;
    for (let w = 0; w < perFace && attempts < perFace * 4; ) {
      const wy = faceHeight * (0.1 + rng() * 0.8);
      const lateral = (rng() - 0.5) * 0.7 * face.span;
      attempts++;
      const overlaps = placed.some((p) => Math.abs(p.lat - lateral) < WIN_W + PAD && Math.abs(p.y - wy) < WIN_H + PAD);
      if (overlaps) continue;
      placed.push({ lat: lateral, y: wy });
      const localX = face.nx * (face.dist + 0.02) + (face.nz !== 0 ? lateral : 0);
      const localZ = face.nz * (face.dist + 0.02) + (face.nx !== 0 ? lateral : 0);
      // Local → world: (bx,bz) + R(θ)*(localX,localZ), R(θ) = [cos -sin; sin cos]
      const wx = geoCX + localX * cosR - localZ * sinR;
      const wz = geoCZ + localX * sinR + localZ * cosR;
      parts.push(
        `  <m-cube id="win-${idx}-${winIdx}" x="${r2(wx)}" y="${r2(wy)}" z="${r2(wz)}" ry="${deg(face.winRy)}" width="${WIN_W}" height="${WIN_H}" depth="0.05" color="${wColor}" emission="${wColor}" emission-intensity="${r2(winIntensity)}" collide="false" />`,
      );
      winIdx++;
      w++;
    }
  }
}

/** Random facade billboard (m-model) for catalog billboard assets. */
function emitBillboardOnBuilding(
  parts: string[],
  id: string,
  b: BuildingPlacement,
  bx: number,
  bz: number,
  rng: () => number,
  buildingScale: number,
  catalogId: string,
): void {
  const θ = b.rotation;
  const cosR = Math.cos(θ);
  const sinR = Math.sin(θ);
  const hw = (b.width / 2) * buildingScale;
  const hd = (b.depth / 2) * buildingScale;
  const spanW = b.width * buildingScale;
  const spanD = b.depth * buildingScale;
  const faceHeight = b.height * buildingScale;
  const faces = [
    { nx: 0, nz: 1, dist: hd, span: spanW, winRy: θ },
    { nx: 0, nz: -1, dist: hd, span: spanW, winRy: θ + Math.PI },
    { nx: -1, nz: 0, dist: hw, span: spanD, winRy: θ - Math.PI / 2 },
    { nx: 1, nz: 0, dist: hw, span: spanD, winRy: θ + Math.PI / 2 },
  ];
  const face = pick(faces, rng);
  const lateral = (rng() - 0.5) * 0.62 * face.span;
  const wy = faceHeight * (BILLBOARD_Y_FRAC_MIN + rng() * (BILLBOARD_Y_FRAC_MAX - BILLBOARD_Y_FRAC_MIN));
  const localX = face.nx * (face.dist + BILLBOARD_FACE_PAD) + (face.nz !== 0 ? lateral : 0);
  const localZ = face.nz * (face.dist + BILLBOARD_FACE_PAD) + (face.nx !== 0 ? lateral : 0);
  const wx = bx + localX * cosR - localZ * sinR;
  const wz = bz + localX * sinR + localZ * cosR;
  parts.push(
    `  <m-model id="${id}" x="${r2(wx)}" y="${r2(wy)}" z="${r2(wz)}" ry="${deg(face.winRy)}" sx="${BILLBOARD_SCALE}" sy="${BILLBOARD_SCALE}" sz="${BILLBOARD_SCALE}" catalogId="${catalogId}" collide="false" />`,
  );
}

// --- Street furniture (lights, vehicles, traffic lights) ----------------------

/** Center line: smaller so intersections look cleaner. Color from pyramid GLOW_COLORS (passed in). */
const CENTER_LINE_SEG_LEN = 0.8;
const CENTER_LINE_GAP = 0.6;
const CENTER_LINE_WIDTH = 0.04;
const CENTER_LINE_THICKNESS = 0.018;
const CENTER_LINE_EMISSION_INTENSITY = 1.0;
/** Road center line color (yellow). */
const CENTER_LINE_COLOR = "#ffdd00";

const LIGHT_SPACING = 14;
const LIGHT_POLE_H = 3.2;
const LIGHT_POLE_W = 0.12;
const LIGHT_LAMP_SIZE = 0.28;
const LIGHT_COLOR = "#ffeeaa";
const LIGHT_INTENSITY = 4;
const LIGHT_SETBACK = 0.4;

/**
 * Road surface as one cube per grid block along the street. The client culls by entity (x,z)
 * center only; one full-span slab is centered mid-avenue so standing near an end can cull the
 * entire road. Chunking matches {@link layout/index} block spacing.
 */
function emitRoadSlabs(
  parts: string[],
  streetIdx: number,
  s: StreetSegment,
  streetWidth: number,
  gridRows: number,
  gridCols: number,
  blockSize: number,
  roadY: number,
  roadThickness: number,
  offsetX: number,
  offsetZ: number,
  streetCollide: boolean,
): void {
  const coll = streetCollide ? "true" : "false";
  if (s.alongX) {
    const n = gridCols - 1;
    for (let k = 0; k < n; k++) {
      const x0 = s.startX + k * blockSize;
      const x1 = s.startX + (k + 1) * blockSize;
      const cx = (x0 + x1) / 2 + offsetX;
      const cz = s.startZ + offsetZ;
      parts.push(
        `  <m-cube id="street-${streetIdx}-${k}" x="${r2(cx)}" y="${r2(roadY)}" z="${r2(cz)}" width="${r2(blockSize)}" height="${r2(roadThickness)}" depth="${r2(streetWidth)}" color="#333333" collide="${coll}" />`,
      );
    }
  } else {
    const n = gridRows - 1;
    for (let k = 0; k < n; k++) {
      const z0 = s.startZ + k * blockSize;
      const z1 = s.startZ + (k + 1) * blockSize;
      const cx = s.startX + offsetX;
      const cz = (z0 + z1) / 2 + offsetZ;
      parts.push(
        `  <m-cube id="street-${streetIdx}-${k}" x="${r2(cx)}" y="${r2(roadY)}" z="${r2(cz)}" width="${r2(streetWidth)}" height="${r2(roadThickness)}" depth="${r2(blockSize)}" color="#333333" collide="${coll}" />`,
      );
    }
  }
}

/**
 * Emit dashed glowing center line along the middle of a street segment.
 * Color from pyramid palette (GLOW_COLORS); small so intersections stay clean. No collision.
 */
function emitCenterLine(
  parts: string[],
  streetIdx: number,
  s: StreetSegment,
  len: number,
  _streetWidth: number,
  roadY: number,
  roadThickness: number,
  offsetX: number,
  offsetZ: number,
  lineColor: string,
): void {
  const segLen = CENTER_LINE_SEG_LEN;
  const gap = CENTER_LINE_GAP;
  const cycle = segLen + gap;
  const lineY = roadY + roadThickness / 2 + CENTER_LINE_THICKNESS / 2;
  let segIdx = 0;
  for (let t = 0; t < len; t += cycle) {
    const segEnd = Math.min(t + segLen, len);
    if (segEnd <= t) break;
    const tMid = (t + segEnd) / 2;
    const segLength = segEnd - t;
    if (s.alongX) {
      const xWorld = s.startX + (s.endX - s.startX) * (tMid / len) + offsetX;
      const zWorld = s.startZ + offsetZ;
      const w = segLength;
      const d = CENTER_LINE_WIDTH;
      parts.push(
        `  <m-cube id="center-${streetIdx}-${segIdx}" x="${r2(xWorld)}" y="${r2(lineY)}" z="${r2(zWorld)}" width="${r2(w)}" height="${r2(CENTER_LINE_THICKNESS)}" depth="${r2(d)}" color="${lineColor}" emission="${lineColor}" emission-intensity="${CENTER_LINE_EMISSION_INTENSITY}" collide="false" />`,
      );
    } else {
      const xWorld = s.startX + offsetX;
      const zWorld = s.startZ + (s.endZ - s.startZ) * (tMid / len) + offsetZ;
      const w = CENTER_LINE_WIDTH;
      const d = segLength;
      parts.push(
        `  <m-cube id="center-${streetIdx}-${segIdx}" x="${r2(xWorld)}" y="${r2(lineY)}" z="${r2(zWorld)}" width="${r2(w)}" height="${r2(CENTER_LINE_THICKNESS)}" depth="${r2(d)}" color="${lineColor}" emission="${lineColor}" emission-intensity="${CENTER_LINE_EMISSION_INTENSITY}" collide="false" />`,
      );
    }
    segIdx++;
  }
}

/** Fallback vehicle catalog IDs when catalog has no Vehicles category (e.g. block not seeded). Enables vehicles to show when block has these models. */
const DEFAULT_VEHICLE_CATALOG_IDS = ["SportsCar", "PoliceCar", "Motorcycle"];
/** Minimum segment length to spawn a moving vehicle (m). Lower so more streets get vehicles. */
const VEHICLE_MIN_LEN = 4;
/** Ms per metre of travel (slow city traffic). */
const VEHICLE_MS_PER_M = 320;
const VEHICLE_END_PAD = 2;
const VEHICLE_LANE_OFFSET = 0.55;
/** Number of vehicles per segment (different lanes, staggered start). */
const VEHICLES_PER_SEGMENT = 2;
/** Traffic lights along segment centerline (static m-model). */
const TRAFFIC_LIGHT_SPACING = 28;

function emitStreetLights(
  parts: string[],
  streetIdx: number,
  s: StreetSegment,
  len: number,
  streetWidth: number,
  roadY: number,
  roadThickness: number,
  offsetX: number,
  offsetZ: number,
): void {
  if (len < LIGHT_SPACING) return;
  const halfW = streetWidth / 2 + LIGHT_SETBACK;
  const poleBaseY = roadY + roadThickness / 2 + LIGHT_POLE_H / 2;
  const lampY = roadY + roadThickness / 2 + LIGHT_POLE_H + LIGHT_LAMP_SIZE / 2;
  let lightIdx = 0;
  for (let t = LIGHT_SPACING / 2; t < len - LIGHT_SPACING / 2; t += LIGHT_SPACING) {
    const u = t / len;
    if (s.alongX) {
      const xWorld = s.startX + (s.endX - s.startX) * u + offsetX;
      const zBase = s.startZ + offsetZ;
      const zNorth = zBase - halfW;
      const zSouth = zBase + halfW;
      const idBase = `light-${streetIdx}-${lightIdx}`;
      parts.push(
        `  <m-cube id="${idBase}-n-pole" x="${r2(xWorld)}" y="${r2(poleBaseY)}" z="${r2(zNorth)}" width="${r2(LIGHT_POLE_W)}" height="${r2(LIGHT_POLE_H)}" depth="${r2(LIGHT_POLE_W)}" color="#222222" collide="false" />`,
        `  <m-cube id="${idBase}-n-lamp" x="${r2(xWorld)}" y="${r2(lampY)}" z="${r2(zNorth)}" width="${r2(LIGHT_LAMP_SIZE)}" height="${r2(LIGHT_LAMP_SIZE * 0.6)}" depth="${r2(LIGHT_LAMP_SIZE)}" color="${LIGHT_COLOR}" emission="${LIGHT_COLOR}" emission-intensity="${LIGHT_INTENSITY}" collide="false" />`,
        `  <m-cube id="${idBase}-s-pole" x="${r2(xWorld)}" y="${r2(poleBaseY)}" z="${r2(zSouth)}" width="${r2(LIGHT_POLE_W)}" height="${r2(LIGHT_POLE_H)}" depth="${r2(LIGHT_POLE_W)}" color="#222222" collide="false" />`,
        `  <m-cube id="${idBase}-s-lamp" x="${r2(xWorld)}" y="${r2(lampY)}" z="${r2(zSouth)}" width="${r2(LIGHT_LAMP_SIZE)}" height="${r2(LIGHT_LAMP_SIZE * 0.6)}" depth="${r2(LIGHT_LAMP_SIZE)}" color="${LIGHT_COLOR}" emission="${LIGHT_COLOR}" emission-intensity="${LIGHT_INTENSITY}" collide="false" />`,
      );
    } else {
      const zWorld = s.startZ + (s.endZ - s.startZ) * u + offsetZ;
      const xBase = s.startX + offsetX;
      const xWest = xBase - halfW;
      const xEast = xBase + halfW;
      const idBase = `light-${streetIdx}-${lightIdx}`;
      parts.push(
        `  <m-cube id="${idBase}-w-pole" x="${r2(xWest)}" y="${r2(poleBaseY)}" z="${r2(zWorld)}" width="${r2(LIGHT_POLE_W)}" height="${r2(LIGHT_POLE_H)}" depth="${r2(LIGHT_POLE_W)}" color="#222222" collide="false" />`,
        `  <m-cube id="${idBase}-w-lamp" x="${r2(xWest)}" y="${r2(lampY)}" z="${r2(zWorld)}" width="${r2(LIGHT_LAMP_SIZE)}" height="${r2(LIGHT_LAMP_SIZE * 0.6)}" depth="${r2(LIGHT_LAMP_SIZE)}" color="${LIGHT_COLOR}" emission="${LIGHT_COLOR}" emission-intensity="${LIGHT_INTENSITY}" collide="false" />`,
        `  <m-cube id="${idBase}-e-pole" x="${r2(xEast)}" y="${r2(poleBaseY)}" z="${r2(zWorld)}" width="${r2(LIGHT_POLE_W)}" height="${r2(LIGHT_POLE_H)}" depth="${r2(LIGHT_POLE_W)}" color="#222222" collide="false" />`,
        `  <m-cube id="${idBase}-e-lamp" x="${r2(xEast)}" y="${r2(lampY)}" z="${r2(zWorld)}" width="${r2(LIGHT_LAMP_SIZE)}" height="${r2(LIGHT_LAMP_SIZE * 0.6)}" depth="${r2(LIGHT_LAMP_SIZE)}" color="${LIGHT_COLOR}" emission="${LIGHT_COLOR}" emission-intensity="${LIGHT_INTENSITY}" collide="false" />`,
      );
    }
    lightIdx++;
  }
}

/**
 * Emit animated vehicles along the segment (m-model + m-attr-anim). Picks from catalog IDs by category Vehicles.
 * No-op when vehicleCatalogIds is empty.
 */
function emitVehicle(
  parts: string[],
  streetIdx: number,
  s: StreetSegment,
  len: number,
  offsetX: number,
  offsetZ: number,
  rng: () => number,
  vehicleCatalogIds: string[],
): void {
  if (vehicleCatalogIds.length === 0) return;
  const usable = len - 2 * VEHICLE_END_PAD;
  if (usable < VEHICLE_MIN_LEN) return;
  const duration = Math.max(4000, Math.round(usable * VEHICLE_MS_PER_M));

  for (let v = 0; v < VEHICLES_PER_SEGMENT; v++) {
    const lane = v === 0 ? VEHICLE_LANE_OFFSET : -VEHICLE_LANE_OFFSET;
    const startTime = Math.round(rng() * duration * 0.8);
    const catalogId = pick(vehicleCatalogIds, rng);
    const id = `veh-${streetIdx}-${v}`;
    const ryAlongX = rng() > 0.5 ? 90 : -90;
    const ryAlongZ = rng() > 0.5 ? 0 : 180;

    if (s.alongX) {
      const zWorld = s.startZ + offsetZ + lane;
      const x0 = Math.min(s.startX, s.endX) + offsetX + VEHICLE_END_PAD;
      const x1 = Math.max(s.startX, s.endX) + offsetX - VEHICLE_END_PAD;
      parts.push(
        `  <m-model id="${id}" x="${r2(x0)}" y="0" z="${r2(zWorld)}" ry="${ryAlongX}" catalogId="${catalogId}" collide="false">`
      );
      parts.push(
        `    <m-attr-anim attr="x" start="${r2(x0)}" end="${r2(x1)}" duration="${duration}" start-time="${startTime}" loop="true" ping-pong="true" easing="linear" />`
      );
      parts.push(`  </m-model>`);
    } else {
      const xWorld = s.startX + offsetX + lane;
      const z0 = Math.min(s.startZ, s.endZ) + offsetZ + VEHICLE_END_PAD;
      const z1 = Math.max(s.startZ, s.endZ) + offsetZ - VEHICLE_END_PAD;
      parts.push(
        `  <m-model id="${id}" x="${r2(xWorld)}" y="0" z="${r2(z0)}" ry="${ryAlongZ}" catalogId="${catalogId}" collide="false">`
      );
      parts.push(
        `    <m-attr-anim attr="z" start="${r2(z0)}" end="${r2(z1)}" duration="${duration}" start-time="${startTime}" loop="true" ping-pong="true" easing="linear" />`
      );
      parts.push(`  </m-model>`);
    }
  }
}

/**
 * Traffic-light models at road edge (same setback as street lamps). Picks from catalog IDs (e.g. Props with "traffic").
 * No-op when trafficLightCatalogIds is empty.
 */
function emitTrafficLights(
  parts: string[],
  streetIdx: number,
  s: StreetSegment,
  len: number,
  streetWidth: number,
  offsetX: number,
  offsetZ: number,
  trafficLightCatalogIds: string[],
  rng: () => number,
): void {
  if (trafficLightCatalogIds.length === 0) return;
  if (len < TRAFFIC_LIGHT_SPACING) return;
  const halfW = streetWidth / 2 + LIGHT_SETBACK;
  let idx = 0;
  for (let t = TRAFFIC_LIGHT_SPACING; t < len; t += TRAFFIC_LIGHT_SPACING) {
    const u = t / len;
    const side = idx % 2 === 0 ? 1 : -1;
    const catalogId = pick(trafficLightCatalogIds, rng);
    if (s.alongX) {
      const xWorld = s.startX + (s.endX - s.startX) * u + offsetX;
      const zBase = s.startZ + offsetZ;
      const zWorld = zBase + side * halfW;
      parts.push(
        `  <m-model id="tl-${streetIdx}-${idx}" x="${r2(xWorld)}" y="0" z="${r2(zWorld)}" ry="${side > 0 ? 0 : 180}" catalogId="${catalogId}" collide="false" />`
      );
    } else {
      const zWorld = s.startZ + (s.endZ - s.startZ) * u + offsetZ;
      const xBase = s.startX + offsetX;
      const xWorld = xBase + side * halfW;
      parts.push(
        `  <m-model id="tl-${streetIdx}-${idx}" x="${r2(xWorld)}" y="0" z="${r2(zWorld)}" ry="${side > 0 ? 90 : -90}" catalogId="${catalogId}" collide="false" />`
      );
    }
    idx++;
  }
}

/** Emit full city MML: streets, buildings (with windows/antennas/billboards), optional pyramid, lights, vehicles. */
function cityToMml(
  buildings: BuildingPlacement[],
  streets: StreetSegment[],
  streetWidth: number,
  blockSize: number,
  offsetX: number,
  offsetZ: number,
  seed: number,
  reservedCell: CellBounds | null,
  shouldEmitPyramid: boolean,
  vehicleCatalogIds: string[],
  trafficLightCatalogIds: string[],
  gridRows: number,
  gridCols: number,
  windowColors: readonly string[],
  windowEmissionIntensity: number,
  billboardCatalogIds: readonly string[],
): string {
  const parts: string[] = [];
  const rng = mulberry32(seed ^ 0xbeef);
  const roadThickness = 0.1;
  /** Street slab center Y — slightly below floor so road is recessed; no collision except perimeter. */
  const roadY = -0.02;
  /** Center line color: yellow for road lines. */
  const centerLineColor = CENTER_LINE_COLOR;
  /** Only outer street segments (city perimeter) have collision. Indices: first/last row, first/last col. */
  const perimeterStreetIndices = new Set<number>([
    0,
    gridRows - 1,
    gridRows,
    gridRows + gridCols - 1,
  ]);

  for (let i = 0; i < streets.length; i++) {
    const s = streets[i]!;
    const len = s.alongX ? Math.abs(s.endX - s.startX) : Math.abs(s.endZ - s.startZ);
    const streetCollide = perimeterStreetIndices.has(i);
    emitRoadSlabs(
      parts,
      i,
      s,
      streetWidth,
      gridRows,
      gridCols,
      blockSize,
      roadY,
      roadThickness,
      offsetX,
      offsetZ,
      streetCollide,
    );
    emitCenterLine(parts, i, s, len, streetWidth, roadY, roadThickness, offsetX, offsetZ, centerLineColor);
    emitStreetLights(parts, i, s, len, streetWidth, roadY, roadThickness, offsetX, offsetZ);
    emitTrafficLights(parts, i, s, len, streetWidth, offsetX, offsetZ, trafficLightCatalogIds, rng);
    emitVehicle(parts, i, s, len, offsetX, offsetZ, rng, vehicleCatalogIds);
  }

  /** Scale applied to all building m-models (sx, sy, sz). 1.2 = 20% larger. */
  const BUILDING_SCALE = 1.2;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i]!;
    if (reservedCell && buildingInCell(b, reservedCell)) continue;
    const bx = b.x + offsetX;
    const bz = b.z + offsetZ;
    // sx/sy/sz scale the model and collision; physics uses catalogId + dimensions from engine.
    parts.push(
      `  <m-model id="bldg-${i}" x="${r2(bx)}" y="0" z="${r2(bz)}" ry="${deg(b.rotation)}" sx="${BUILDING_SCALE}" sy="${BUILDING_SCALE}" sz="${BUILDING_SCALE}" catalogId="${b.catalogId}" collide="true" />`,
    );
    const hasAntenna = b.height >= ANTENNA_HEIGHT_THRESHOLD && rng() < ANTENNA_CHANCE;
    if (hasAntenna) emitAntenna(parts, i, b, bx, bz, rng, BUILDING_SCALE);
    if (!hasAntenna && BUILDING_CATALOG_IDS_WITH_WINDOWS.has(b.catalogId)) {
      emitWindows(parts, i, b, bx, bz, rng, BUILDING_SCALE, windowColors, windowEmissionIntensity);
    }
    if (billboardCatalogIds.length > 0 && rng() < BILLBOARD_FACADE_CHANCE) {
      emitBillboardOnBuilding(parts, `billboard-${i}`, b, bx, bz, rng, BUILDING_SCALE, pick(billboardCatalogIds, rng));
    }
  }

  if (shouldEmitPyramid && reservedCell) emitPyramid(parts, reservedCell, offsetX, offsetZ, seed);
  return `<m-group id="city-layout-root">\n${parts.join("\n")}\n</m-group>`;
}

// --- Public API --------------------------------------------------------------

export type GenerateCityMmlOptions = {
  /**
   * Building pool for layout packing — from hub catalog by category Buildings.
   * If omitted or empty, layout has no buildings (streets and pyramid only).
   */
  buildings?: SeedBuildingEntry[];
  /**
   * Catalog IDs for moving vehicles (from hub catalog by category Vehicles).
   * If omitted or empty, no vehicles are emitted.
   */
  vehicleCatalogIds?: string[];
  /**
   * Catalog IDs for traffic lights (e.g. Props with "traffic" in id/name).
   * If omitted or empty, no traffic lights are emitted.
   */
  trafficLightCatalogIds?: string[];
  /** Hex colors for emissive window cubes (e.g. `["#ff0040","#00aaff"]`). Empty uses built-in palette. */
  windowColors?: string[];
  /** Emission intensity for window cubes; default matches recipe constant. */
  windowEmissionIntensity?: number;
  /** Billboard catalog IDs (e.g. from catalog category "Billboard"); placed randomly on building facades. */
  billboardCatalogIds?: string[];
};

/** Pure MML generator; no I/O. Building pool from options.buildings; empty if omitted. */
export function generateCityMml(
  config: Partial<CityGenConfig> = {},
  options?: GenerateCityMmlOptions,
): string {
  const c = clampCityConfig(config);
  const layoutCfg = {
    centerX: 0,
    centerZ: 0,
    gridRows: c.gridRows,
    gridCols: c.gridCols,
    blockSize: c.blockSize,
    streetWidth: c.streetWidth,
    buildingSetback: c.buildingSetback,
    seed: c.seed,
  };
  const pool = options?.buildings?.length ? options.buildings : [];
  const layout = generateCityLayout(pool, layoutCfg);

  const cellFn = getCellBounds({ ...layoutCfg, centerX: 0, centerZ: 0 });
  const cellRows = c.gridRows - 1;
  const cellCols = c.gridCols - 1;
  const centerRow = Math.max(0, Math.floor((cellRows - 1) / 2));
  const centerCol = Math.max(0, Math.floor((cellCols - 1) / 2));

  let reservedCell: CellBounds | null = null;
  let shouldEmitPyramid = false;
  if (c.noPyramid) {
    reservedCell = cellFn(centerRow, centerCol);
    shouldEmitPyramid = false;
  } else if (c.pyramidRow != null && c.pyramidCol != null) {
    reservedCell = cellFn(c.pyramidRow, c.pyramidCol);
    shouldEmitPyramid = reservedCell != null;
  }

  const offsetX = BLOCK_SIZE_M / 2;
  const offsetZ = BLOCK_SIZE_M / 2;
  const vehicleCatalogIds =
    options?.vehicleCatalogIds?.length ? options.vehicleCatalogIds : DEFAULT_VEHICLE_CATALOG_IDS;
  const trafficLightCatalogIds = options?.trafficLightCatalogIds ?? [];
  const windowColors = options?.windowColors?.length ? options.windowColors : [];
  const windowEmissionIntensity =
    typeof options?.windowEmissionIntensity === "number" &&
    Number.isFinite(options.windowEmissionIntensity) &&
    options.windowEmissionIntensity > 0
      ? options.windowEmissionIntensity
      : WIN_INTENSITY;
  const billboardCatalogIds = options?.billboardCatalogIds?.length ? options.billboardCatalogIds : [];
  return cityToMml(
    layout.buildings,
    layout.streets,
    c.streetWidth,
    c.blockSize,
    offsetX,
    offsetZ,
    c.seed,
    reservedCell,
    shouldEmitPyramid,
    vehicleCatalogIds,
    trafficLightCatalogIds,
    c.gridRows,
    c.gridCols,
    windowColors,
    windowEmissionIntensity,
    billboardCatalogIds,
  );
}

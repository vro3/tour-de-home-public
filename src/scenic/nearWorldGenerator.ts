import * as THREE from 'three';
import type { ScenicTheme } from '../types/scenic';

/**
 * Individual prop families used to fill the ride's near and middle ground.
 * Renderers can map each family and its `variant` to any mesh or material set.
 */
export const NEAR_WORLD_PROP_KINDS = [
  'tree',
  'rock',
  'groundCover',
  'structure',
  'reflector',
  'streamBank',
  'waterfallMist',
] as const;

export type NearWorldPropKind = typeof NEAR_WORLD_PROP_KINDS[number];
export type NearWorldBandName = 'near' | 'mid';
export type NearWorldQuality = 'standard' | 'low';
export type NearWorldSide = -1 | 1;
export type NearWorldYawMode = 'random' | 'route' | 'crossRoute' | 'faceRoad';

export interface NearWorldBandConfig {
  band: NearWorldBandName;
  /** Relative selection weight. It does not need to be normalized. */
  weight: number;
  /** Perpendicular distance from route centerline, expressed in real meters. */
  minOffsetMeters: number;
  /** Perpendicular distance from route centerline, expressed in real meters. */
  maxOffsetMeters: number;
}

export interface NearWorldKindConfig {
  /** Expected instances per real route kilometre before the quality multiplier. */
  densityPerKilometer: number;
  bands: readonly NearWorldBandConfig[];
  /** XYZ size bounds in real meters. Output scale is converted to scene units. */
  scaleMinMeters: readonly [number, number, number];
  scaleMaxMeters: readonly [number, number, number];
  variants: number;
  yawMode: NearWorldYawMode;
  maxTiltRadians: number;
  /** Fraction of output height used to lift a centered mesh from the ground. */
  verticalAnchor: number;
  /** Left/right route-side weights, respectively. */
  sideWeights: readonly [number, number];
  /** Higher-priority props survive hard performance-budget trimming first. */
  budgetPriority: number;
  /** 0 is uniform scatter; 1 produces pronounced groves and clearings. */
  clusterStrength: number;
  /** Longitudinal habitat wavelength in real route meters. */
  clusterScaleMeters: number;
}

export interface NearWorldThemeConfig {
  cellLengthMeters: number;
  roadClearanceMeters: number;
  densityMultiplier: number;
  maxInstancesPerCell: number;
  maxInstancesPerWindow: number;
  maxWindowMeters: number;
  kinds: Readonly<Record<NearWorldPropKind, NearWorldKindConfig>>;
}

export interface NearWorldRouteFrame {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  headingRadians: number;
  routeQuaternion: THREE.Quaternion;
}

export interface NearWorldInstance {
  /** Stable across overlapping streaming windows and repeated runs. */
  id: string;
  kind: NearWorldPropKind;
  band: NearWorldBandName;
  side: NearWorldSide;
  cellIndex: number;
  ordinal: number;
  variant: number;
  distanceMeters: number;
  lateralOffsetMeters: number;
  lateralOffsetWorld: number;
  headingRadians: number;
  groundPosition: THREE.Vector3;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  routeQuaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  /** Stable tie-breaker available to renderers for LOD or draw budgets. */
  budgetRank: number;
  /** Stable 0..1 ecology suitability at this absolute route coordinate. */
  habitat: number;
  /** Stable longitudinal ecology region used for side-biased grouping. */
  clusterId: number;
}

export interface GenerateNearWorldOptions {
  curve: THREE.Curve<THREE.Vector3>;
  totalDistanceMeters: number;
  startMeters: number;
  endMeters: number;
  seed: number | string;
  theme: ScenicTheme;
  /** Scene units per real meter. ScenicRide currently uses 0.1. */
  worldScale?: number;
  quality?: NearWorldQuality;
  focusMeters?: number;
  config?: NearWorldThemeConfig;
  /** Optional terrain displacement in scene units, matching ScenicRide terrainHeightDelta. */
  terrainHeightAt?: (distanceMeters: number, lateralOffsetWorld: number) => number;
  /**
   * Optional absolute-coordinate placement gate. Returning false rejects the
   * candidate without rerolling it, so deterministic IDs and overlapping-window
   * transforms remain stable. Lateral offsets are expressed in scene units.
   */
  placementSuitabilityAt?: (
    kind: NearWorldPropKind,
    distanceMeters: number,
    lateralOffsetWorld: number,
  ) => boolean;
}

export interface NearWorldGenerationResult {
  instances: NearWorldInstance[];
  window: {
    requestedStartMeters: number;
    requestedEndMeters: number;
    startMeters: number;
    endMeters: number;
    wasClamped: boolean;
  };
  stats: {
    visitedCells: number;
    candidates: number;
    droppedByCellBudget: number;
    droppedByWindowBudget: number;
  };
}

const FORWARD = new THREE.Vector3(0, 0, 1);
const EPSILON = 1e-8;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'string') return hashString(seed);
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteVector(vector: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  if (Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)) return vector;
  return fallback.clone();
}

function weightedBand(random: () => number, bands: readonly NearWorldBandConfig[]): NearWorldBandConfig | null {
  const valid = bands.filter((band) => (
    Number.isFinite(band.weight)
    && band.weight > 0
    && Number.isFinite(band.minOffsetMeters)
    && Number.isFinite(band.maxOffsetMeters)
  ));
  const totalWeight = valid.reduce((sum, band) => sum + band.weight, 0);
  if (!(totalWeight > 0)) return null;
  let cursor = random() * totalWeight;
  for (const band of valid) {
    cursor -= band.weight;
    if (cursor <= 0) return band;
  }
  return valid.at(-1) ?? null;
}

function chooseSide(random: () => number, weights: readonly [number, number]): NearWorldSide {
  const left = Math.max(0, finite(weights[0], 0.5));
  const right = Math.max(0, finite(weights[1], 0.5));
  const total = left + right;
  if (!(total > 0)) return random() < 0.5 ? -1 : 1;
  return random() * total < left ? -1 : 1;
}

function range(random: () => number, first: number, second: number): number {
  const min = Math.min(finite(first, 0), finite(second, 0));
  const max = Math.max(finite(first, 0), finite(second, 0));
  return THREE.MathUtils.lerp(min, max, random());
}

function poissonCount(random: () => number, expected: number): number {
  if (!(expected > 0)) return 0;
  if (expected > 24) {
    const integer = Math.floor(expected);
    return integer + (random() < expected - integer ? 1 : 0);
  }
  // Knuth sampling avoids conspicuous identical counts in every cell while
  // remaining deterministic for a given cell/kind seed.
  const threshold = Math.exp(-expected);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > threshold);
  return count - 1;
}

function kindConfig(
  densityPerKilometer: number,
  bands: readonly NearWorldBandConfig[],
  scaleMinMeters: readonly [number, number, number],
  scaleMaxMeters: readonly [number, number, number],
  variants: number,
  yawMode: NearWorldYawMode,
  maxTiltRadians: number,
  verticalAnchor: number,
  budgetPriority: number,
  sideWeights: readonly [number, number] = [1, 1],
  clusterStrength = 0.5,
  clusterScaleMeters = 220,
): NearWorldKindConfig {
  return {
    densityPerKilometer,
    bands,
    scaleMinMeters,
    scaleMaxMeters,
    variants,
    yawMode,
    maxTiltRadians,
    verticalAnchor,
    sideWeights,
    budgetPriority,
    clusterStrength,
    clusterScaleMeters,
  };
}

const NEAR = (weight = 1, minOffsetMeters = 8.5, maxOffsetMeters = 28): NearWorldBandConfig => ({
  band: 'near', weight, minOffsetMeters, maxOffsetMeters,
});
const MID = (weight = 1, minOffsetMeters = 28, maxOffsetMeters = 62): NearWorldBandConfig => ({
  band: 'mid', weight, minOffsetMeters, maxOffsetMeters,
});
const ROADSIDE = (weight = 1): NearWorldBandConfig => ({
  band: 'near', weight, minOffsetMeters: 4.6, maxOffsetMeters: 6.1,
});

type ThemeDensities = readonly [
  tree: number,
  rock: number,
  groundCover: number,
  structure: number,
  reflector: number,
  streamBank: number,
  waterfallMist: number,
];

function naturalTheme(
  densities: ThemeDensities,
  options: {
    roadClearanceMeters?: number;
    treeBands?: readonly NearWorldBandConfig[];
    rockBands?: readonly NearWorldBandConfig[];
    structureBands?: readonly NearWorldBandConfig[];
    streamSideWeights?: readonly [number, number];
    structureScale?: readonly [number, number, number];
  } = {},
): NearWorldThemeConfig {
  const [tree, rock, groundCover, structure, , streamBank] = densities;
  return {
    cellLengthMeters: 50,
    roadClearanceMeters: options.roadClearanceMeters ?? 7.4,
    densityMultiplier: 1,
    maxInstancesPerCell: 24,
    maxInstancesPerWindow: 980,
    maxWindowMeters: 2_400,
    kinds: {
      tree: kindConfig(tree, options.treeBands ?? [NEAR(0.62), MID(0.38)], [3.2, 5.8, 3.2], [8.5, 15, 8.5], 8, 'random', 0.045, 0.5, 0.76, [1, 1], 0.92, 285),
      rock: kindConfig(rock, options.rockBands ?? [NEAR(0.7), MID(0.3)], [0.8, 0.45, 0.7], [4.5, 2.6, 4.4], 10, 'random', 0.38, 0.42, 0.7, [1, 1], 0.62, 210),
      groundCover: kindConfig(groundCover, [NEAR(0.86, 7.5, 23), MID(0.14, 23, 40)], [0.6, 0.28, 0.6], [3.4, 1.35, 3.4], 12, 'random', 0.16, 0.42, 0.34, [1, 1], 0.8, 125),
      structure: kindConfig(structure, options.structureBands ?? [NEAR(0.2, 16, 30), MID(0.8, 30, 68)], [3.4, 5.5, 3.4], options.structureScale ?? [12, 32, 12], 8, 'route', 0.025, 0.5, 0.82, [1, 1], 0.54, 440),
      // ScenicRide renders its own absolute-distance roadside posts. Keeping a
      // second invisible reflector population here only consumes cell budgets.
      reflector: kindConfig(0, [ROADSIDE()], [0.12, 0.75, 0.12], [0.22, 1.35, 0.22], 4, 'route', 0.015, 0.5, 1, [1, 1], 0, 100),
      streamBank: kindConfig(streamBank, [NEAR(0.38, 12, 27), MID(0.62, 27, 54)], [0.5, 0.35, 0.5], [3.2, 2.2, 3.2], 9, 'random', 0.22, 0.38, 0.52, options.streamSideWeights ?? [1, 1], 0.7, 175),
      // StreamedWaterFeatures owns visible mist and its strict draw budget.
      waterfallMist: kindConfig(0, [MID(1, 34, 61)], [3.5, 4.5, 1.2], [10, 18, 3.5], 5, 'faceRoad', 0.02, 0.5, 0.88, options.streamSideWeights ?? [1, 1], 0.68, 520),
    },
  };
}

const STANDARD_THEME_CONFIGS: Readonly<Record<ScenicTheme, NearWorldThemeConfig>> = {
  daybreak: naturalTheme([92, 36, 116, 0, 28, 13, 0.55]),
  moonride: naturalTheme([42, 58, 38, 4.5, 24, 0, 0], {
    treeBands: [NEAR(0.45), MID(0.55)],
    structureScale: [9, 28, 9],
  }),
  deathisland: naturalTheme([110, 70, 240, 5.5, 25, 35, 0.5], {
    treeBands: [NEAR(0.7, 9, 25), MID(0.3, 25, 54)],
    streamSideWeights: [1.8, 1],
    structureScale: [10, 35, 10],
  }),
  avalanche: naturalTheme([58, 85, 110, 7, 30, 24, 0.4], {
    treeBands: [NEAR(0.3, 12, 28), MID(0.7, 28, 62)],
    rockBands: [NEAR(0.48), MID(0.52)],
    structureScale: [10, 42, 10],
  }),
  sidewinder: naturalTheme([58, 85, 70, 5, 28, 18, 0.3], {
    treeBands: [NEAR(0.34), MID(0.66)],
    structureScale: [8, 34, 8],
  }),
  snowbound: naturalTheme([12, 90, 68, 12, 34, 20, 0.25], {
    rockBands: [NEAR(0.45), MID(0.55)],
    structureScale: [13, 48, 13],
  }),
  forgeworld: {
    ...naturalTheme([275, 105, 430, 6.5, 30, 72, 1.9], {
      treeBands: [NEAR(0.82, 7.8, 24), MID(0.18, 24, 48)],
      rockBands: [NEAR(0.82, 7.6, 25), MID(0.18, 25, 46)],
      streamSideWeights: [1, 1.65],
      structureScale: [12, 44, 12],
    }),
    maxInstancesPerCell: 48,
    maxInstancesPerWindow: 1_560,
  },
  powerhouse: naturalTheme([16, 112, 92, 16, 32, 28, 0], {
    rockBands: [NEAR(0.58), MID(0.42)],
    structureBands: [NEAR(0.55, 14, 31), MID(0.45, 31, 58)],
    structureScale: [18, 38, 18],
  }),
  nmpdhq: naturalTheme([18, 8, 46, 48, 42, 18, 0], {
    roadClearanceMeters: 7.8,
    structureBands: [NEAR(0.72, 12, 29), MID(0.28, 29, 48)],
    structureScale: [28, 70, 28],
  }),
  coastalhighway: naturalTheme([42, 30, 126, 28, 38, 28, 0.2], {
    roadClearanceMeters: 7.8,
    structureBands: [NEAR(0.55, 14, 30), MID(0.45, 30, 55)],
    structureScale: [20, 52, 20],
    streamSideWeights: [1.45, 1],
  }),
};

function lowDetailConfig(standard: NearWorldThemeConfig): NearWorldThemeConfig {
  return {
    ...standard,
    densityMultiplier: standard.densityMultiplier * 0.43,
    maxInstancesPerCell: Math.max(6, Math.floor(standard.maxInstancesPerCell * 0.5)),
    maxInstancesPerWindow: Math.max(260, Math.floor(standard.maxInstancesPerWindow * 0.46)),
  };
}

export function getNearWorldThemeConfig(
  theme: ScenicTheme,
  quality: NearWorldQuality = 'standard',
): NearWorldThemeConfig {
  const standard = STANDARD_THEME_CONFIGS[theme];
  return quality === 'low' ? lowDetailConfig(standard) : standard;
}

/**
 * Samples a stable horizontal route frame from a real route distance. This is
 * intentionally independent of ScenicRide's private RouteWorld shape.
 */
export function sampleNearWorldRouteFrame(
  curve: THREE.Curve<THREE.Vector3>,
  distanceMeters: number,
  totalDistanceMeters: number,
): NearWorldRouteFrame {
  const safeTotal = finitePositive(totalDistanceMeters, 1);
  const safeDistance = THREE.MathUtils.clamp(finite(distanceMeters, 0), 0, safeTotal);
  const u = safeDistance / safeTotal;
  let point = new THREE.Vector3();
  let tangent = new THREE.Vector3(0, 0, 1);
  try {
    point = finiteVector(curve.getPointAt(u).clone(), new THREE.Vector3());
    tangent = finiteVector(curve.getTangentAt(u).clone(), tangent);
  } catch {
    // A malformed external curve should produce a safe frame, not poison an
    // entire instanced draw with NaNs.
  }
  if (tangent.lengthSq() <= EPSILON) tangent.set(0, 0, 1);
  tangent.normalize();
  const right = new THREE.Vector3(-tangent.z, 0, tangent.x);
  if (right.lengthSq() <= EPSILON) right.set(1, 0, 0);
  right.normalize();
  const headingRadians = Math.atan2(tangent.x, tangent.z);
  const routeQuaternion = new THREE.Quaternion().setFromUnitVectors(FORWARD, tangent);
  return { point, tangent, right, headingRadians, routeQuaternion };
}

/** Smooth absolute-distance habitat field shared by all streaming windows. */
export function sampleNearWorldHabitat(
  theme: ScenicTheme,
  seed: number | string,
  kind: NearWorldPropKind,
  distanceMeters: number,
  clusterScaleMeters?: number,
): number {
  const normalized = normalizeSeed(seed);
  const scale = finitePositive(
    clusterScaleMeters ?? STANDARD_THEME_CONFIGS[theme].kinds[kind].clusterScaleMeters,
    220,
  );
  const phase = (hashString(`${normalized}:${theme}:${kind}:habitat`) % 65536) / 911;
  const value = (
    0.5
    + Math.sin(distanceMeters / scale * Math.PI * 2 + phase) * 0.31
    + Math.sin(distanceMeters / (scale * 0.43) * Math.PI * 2 + phase * 1.67) * 0.13
    + Math.cos(distanceMeters / (scale * 2.3) * Math.PI * 2 - phase * 0.41) * 0.08
  );
  return THREE.MathUtils.clamp(value, 0, 1);
}

function yawForKind(
  mode: NearWorldYawMode,
  frame: NearWorldRouteFrame,
  side: NearWorldSide,
  random: () => number,
): number {
  if (mode === 'random') return random() * Math.PI * 2;
  if (mode === 'crossRoute') return frame.headingRadians + Math.PI / 2 + (random() - 0.5) * 0.22;
  if (mode === 'faceRoad') return frame.headingRadians + (side < 0 ? Math.PI / 2 : -Math.PI / 2);
  return frame.headingRadians + (random() - 0.5) * 0.16;
}

function makeCandidate(
  curve: THREE.Curve<THREE.Vector3>,
  totalDistanceMeters: number,
  theme: ScenicTheme,
  worldScale: number,
  seed: number,
  cellIndex: number,
  kind: NearWorldPropKind,
  kindSettings: NearWorldKindConfig,
  ordinal: number,
  cellLengthMeters: number,
  roadClearanceMeters: number,
  terrainHeightAt?: GenerateNearWorldOptions['terrainHeightAt'],
  placementSuitabilityAt?: GenerateNearWorldOptions['placementSuitabilityAt'],
): NearWorldInstance | null {
  const random = mulberry32(hashString(`${seed}:${theme}:${kind}:${cellIndex}:${ordinal}`));
  const band = weightedBand(random, kindSettings.bands);
  if (!band) return null;
  const cellStart = cellIndex * cellLengthMeters;
  const distanceMeters = cellStart + random() * cellLengthMeters;
  // Do not collapse candidates from a partial final cell onto the route end.
  // Rejecting preserves the expected density over the cell's valid fraction.
  if (distanceMeters < 0 || distanceMeters > totalDistanceMeters) return null;
  const clusterScale = finitePositive(kindSettings.clusterScaleMeters, 220);
  const clusterId = Math.floor(distanceMeters / clusterScale);
  const habitat = sampleNearWorldHabitat(theme, seed, kind, distanceMeters, clusterScale);
  let side = chooseSide(random, kindSettings.sideWeights);
  const dominantSide: NearWorldSide = (hashString(`${seed}:${theme}:${kind}:side:${clusterId}`) & 1) === 0 ? -1 : 1;
  if (random() < THREE.MathUtils.clamp(kindSettings.clusterStrength, 0, 1) * 0.52) side = dominantSide;
  const bandMin = Math.max(roadClearanceMeters, Math.min(band.minOffsetMeters, band.maxOffsetMeters));
  const bandMax = Math.max(bandMin, Math.max(band.minOffsetMeters, band.maxOffsetMeters));
  const lateralOffsetMeters = side * range(random, bandMin, bandMax);
  const lateralOffsetWorld = lateralOffsetMeters * worldScale;
  if (placementSuitabilityAt && !placementSuitabilityAt(kind, distanceMeters, lateralOffsetWorld)) {
    return null;
  }
  const frame = sampleNearWorldRouteFrame(curve, distanceMeters, totalDistanceMeters);
  const groundPosition = frame.point.clone().addScaledVector(frame.right, lateralOffsetWorld);
  const terrainLift = terrainHeightAt?.(distanceMeters, lateralOffsetWorld) ?? 0;
  groundPosition.y += finite(terrainLift, 0);

  const scale = new THREE.Vector3(
    range(random, kindSettings.scaleMinMeters[0], kindSettings.scaleMaxMeters[0]) * worldScale,
    range(random, kindSettings.scaleMinMeters[1], kindSettings.scaleMaxMeters[1]) * worldScale,
    range(random, kindSettings.scaleMinMeters[2], kindSettings.scaleMaxMeters[2]) * worldScale,
  );
  const yaw = yawForKind(kindSettings.yawMode, frame, side, random);
  const tiltX = (random() * 2 - 1) * Math.max(0, finite(kindSettings.maxTiltRadians, 0));
  const tiltZ = (random() * 2 - 1) * Math.max(0, finite(kindSettings.maxTiltRadians, 0));
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, 'YXZ'));
  const position = groundPosition.clone();
  position.y += scale.y * THREE.MathUtils.clamp(finite(kindSettings.verticalAnchor, 0), 0, 1);
  const variantCount = Math.max(1, Math.floor(finite(kindSettings.variants, 1)));
  const variant = Math.min(variantCount - 1, Math.floor(random() * variantCount));
  const budgetRank = random();

  return {
    id: `${theme}:${seed.toString(16)}:${kind}:${cellIndex}:${ordinal}`,
    kind,
    band: band.band,
    side,
    cellIndex,
    ordinal,
    variant,
    distanceMeters,
    lateralOffsetMeters,
    lateralOffsetWorld,
    headingRadians: frame.headingRadians,
    groundPosition,
    position,
    quaternion,
    routeQuaternion: frame.routeQuaternion,
    scale,
    budgetRank,
    habitat,
    clusterId,
  };
}

function finiteInstance(instance: NearWorldInstance): boolean {
  return [
    instance.distanceMeters,
    instance.lateralOffsetMeters,
    instance.lateralOffsetWorld,
    instance.headingRadians,
    instance.budgetRank,
    ...instance.groundPosition.toArray(),
    ...instance.position.toArray(),
    ...instance.quaternion.toArray(),
    ...instance.routeQuaternion.toArray(),
    ...instance.scale.toArray(),
  ].every(Number.isFinite);
}

function prioritySort(
  first: NearWorldInstance,
  second: NearWorldInstance,
  config: NearWorldThemeConfig,
): number {
  return config.kinds[second.kind].budgetPriority - config.kinds[first.kind].budgetPriority
    || second.budgetRank - first.budgetRank
    || first.id.localeCompare(second.id);
}

function resolveWindow(options: GenerateNearWorldOptions, config: NearWorldThemeConfig) {
  const total = finitePositive(options.totalDistanceMeters, 1);
  const requestedStartMeters = THREE.MathUtils.clamp(finite(options.startMeters, 0), 0, total);
  const requestedEndMeters = THREE.MathUtils.clamp(
    Math.max(requestedStartMeters, finite(options.endMeters, requestedStartMeters)),
    requestedStartMeters,
    total,
  );
  const maxWindow = finitePositive(config.maxWindowMeters, 2_400);
  if (requestedEndMeters - requestedStartMeters <= maxWindow) {
    return {
      requestedStartMeters,
      requestedEndMeters,
      startMeters: requestedStartMeters,
      endMeters: requestedEndMeters,
      wasClamped: false,
    };
  }
  const focus = THREE.MathUtils.clamp(
    finite(options.focusMeters ?? (requestedStartMeters + requestedEndMeters) / 2, requestedStartMeters),
    requestedStartMeters,
    requestedEndMeters,
  );
  let startMeters = THREE.MathUtils.clamp(focus - maxWindow / 2, requestedStartMeters, requestedEndMeters - maxWindow);
  let endMeters = startMeters + maxWindow;
  if (endMeters > total) {
    endMeters = total;
    startMeters = Math.max(0, endMeters - maxWindow);
  }
  return { requestedStartMeters, requestedEndMeters, startMeters, endMeters, wasClamped: true };
}

/**
 * Generates a bounded, deterministic set of individualized near-world props.
 * Every cell and candidate owns an absolute seed, so streaming-window changes
 * never move an already-created prop.
 */
export function generateNearWorld(options: GenerateNearWorldOptions): NearWorldGenerationResult {
  const quality = options.quality ?? 'standard';
  const config = options.config ?? getNearWorldThemeConfig(options.theme, quality);
  const window = resolveWindow(options, config);
  const totalDistanceMeters = finitePositive(options.totalDistanceMeters, 1);
  const worldScale = finitePositive(options.worldScale ?? 0.1, 0.1);
  const seed = normalizeSeed(options.seed);
  const cellLengthMeters = finitePositive(config.cellLengthMeters, 50);
  const maxPerCell = Math.max(0, Math.floor(finite(config.maxInstancesPerCell, 0)));
  const maxPerWindow = Math.max(0, Math.floor(finite(config.maxInstancesPerWindow, 0)));
  const roadClearanceMeters = Math.max(0, finite(config.roadClearanceMeters, 0));
  const densityMultiplier = Math.max(0, finite(config.densityMultiplier, 0));
  const firstCell = Math.max(0, Math.floor(window.startMeters / cellLengthMeters));
  const lastCell = Math.max(firstCell - 1, Math.ceil(window.endMeters / cellLengthMeters) - 1);
  const instances: NearWorldInstance[] = [];
  let candidates = 0;
  let droppedByCellBudget = 0;

  for (let cellIndex = firstCell; cellIndex <= lastCell; cellIndex += 1) {
    const cellInstances: NearWorldInstance[] = [];
    for (const kind of NEAR_WORLD_PROP_KINDS) {
      const settings = config.kinds[kind];
      const countRandom = mulberry32(hashString(`${seed}:${options.theme}:${kind}:${cellIndex}:count`));
      const habitat = sampleNearWorldHabitat(
        options.theme,
        seed,
        kind,
        (cellIndex + 0.5) * cellLengthMeters,
        settings.clusterScaleMeters,
      );
      const clusterStrength = THREE.MathUtils.clamp(finite(settings.clusterStrength, 0), 0, 1);
      const habitatMultiplier = Math.max(0.08, 1 + (habitat - 0.5) * clusterStrength * 2.35);
      const expected = Math.max(0, finite(settings.densityPerKilometer, 0))
        * cellLengthMeters / 1_000
        * densityMultiplier
        * habitatMultiplier;
      const count = poissonCount(countRandom, expected);
      for (let ordinal = 0; ordinal < count; ordinal += 1) {
        const candidate = makeCandidate(
          options.curve,
          totalDistanceMeters,
          options.theme,
          worldScale,
          seed,
          cellIndex,
          kind,
          settings,
          ordinal,
          cellLengthMeters,
          roadClearanceMeters,
          options.terrainHeightAt,
          options.placementSuitabilityAt,
        );
        if (!candidate || !finiteInstance(candidate)) continue;
        candidates += 1;
        if (candidate.distanceMeters >= window.startMeters && candidate.distanceMeters <= window.endMeters) {
          cellInstances.push(candidate);
        }
      }
    }
    if (cellInstances.length > maxPerCell) {
      cellInstances.sort((first, second) => prioritySort(first, second, config));
      droppedByCellBudget += cellInstances.length - maxPerCell;
      cellInstances.length = maxPerCell;
    }
    instances.push(...cellInstances);
  }

  let droppedByWindowBudget = 0;
  if (instances.length > maxPerWindow) {
    instances.sort((first, second) => prioritySort(first, second, config));
    droppedByWindowBudget = instances.length - maxPerWindow;
    instances.length = maxPerWindow;
  }
  instances.sort((first, second) => first.distanceMeters - second.distanceMeters || first.id.localeCompare(second.id));

  return {
    instances,
    window,
    stats: {
      visitedCells: Math.max(0, lastCell - firstCell + 1),
      candidates,
      droppedByCellBudget,
      droppedByWindowBudget,
    },
  };
}

export function groupNearWorldInstances(
  instances: readonly NearWorldInstance[],
): Record<NearWorldPropKind, NearWorldInstance[]> {
  const grouped: Record<NearWorldPropKind, NearWorldInstance[]> = {
    tree: [],
    rock: [],
    groundCover: [],
    structure: [],
    reflector: [],
    streamBank: [],
    waterfallMist: [],
  };
  for (const instance of instances) grouped[instance.kind].push(instance);
  return grouped;
}

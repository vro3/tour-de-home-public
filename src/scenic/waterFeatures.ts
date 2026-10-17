import * as THREE from 'three';

/**
 * Water features are generated from absolute route-distance cells. A feature's
 * ID and transform therefore do not change when the streamed scenery window
 * moves or overlaps a previous window.
 */
export type ActiveWaterwayKind = 'stream' | 'ice' | 'runoff' | 'canal';
export type WaterSurfaceStyle = 'water' | 'ice' | 'runoff' | 'canal';

export interface WaterFeatureWindow {
  startMeters: number;
  endMeters: number;
}

export interface WaterFeatureBudget {
  streamVertices: number;
  waterfallVertices: number;
  mistInstances: number;
  rockInstances: number;
}

export interface WaterFeatureConfig {
  style: WaterSurfaceStyle;
  cellLengthMeters: number;
  sampleSpacingMeters: number;
  lateralDistance: number;
  meanderPrimary: number;
  meanderSecondary: number;
  widthVariation: number;
  surfaceLift: number;
  waterfallChance: number;
  waterfallSourceDistance: number;
  waterfallMinDrop: number;
  waterfallWidth: readonly [number, number];
  mistPerWaterfall: readonly [number, number];
  rocksPerCell: readonly [number, number];
  rockScale: readonly [number, number];
}

export interface WaterStreamSample {
  distanceMeters: number;
  centerOffset: number;
  halfWidth: number;
  left: THREE.Vector3;
  right: THREE.Vector3;
}

export interface WaterfallSheet {
  id: string;
  cellIndex: number;
  distanceMeters: number;
  topOffset: number;
  baseOffset: number;
  topTerrainY: number;
  baseTerrainY: number;
  top: THREE.Vector3;
  base: THREE.Vector3;
  width: number;
}

export interface WaterFeatureTransform {
  id: string;
  cellIndex: number;
  distanceMeters: number;
  lateralOffset: number;
  terrainY: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export interface StreamedWaterFeatures {
  kind: ActiveWaterwayKind;
  style: WaterSurfaceStyle;
  streamGeometry: THREE.BufferGeometry;
  waterfallGeometry: THREE.BufferGeometry;
  streamSamples: WaterStreamSample[];
  waterfalls: WaterfallSheet[];
  mist: WaterFeatureTransform[];
  rocks: WaterFeatureTransform[];
  budget: WaterFeatureBudget;
}

export interface CreateStreamedWaterFeaturesOptions {
  curve: THREE.CatmullRomCurve3;
  totalDistanceMeters: number;
  window: WaterFeatureWindow;
  seed: number;
  kind: ActiveWaterwayKind;
  /** Used in stable IDs and phase generation when several worlds share a route. */
  themeKey?: string;
  /** Full ribbon width in scene units. */
  width: number;
  roadHalfWidth?: number;
  roadClearance?: number;
  lowDetail?: boolean;
  budget?: Partial<WaterFeatureBudget>;
  config?: Partial<WaterFeatureConfig>;
  /**
   * Optional shared terrain-corridor sampler. When provided, the water ribbon,
   * banks and waterfall bases use the same centerline that carved the ground.
   */
  centerOffsetAt?: (distanceMeters: number, halfWidth: number) => number | null;
  /**
   * Returns the absolute scene-space terrain Y at an absolute route distance
   * and lateral offset. Non-finite samples safely fall back to the route Y.
   */
  terrainHeight: (distanceMeters: number, lateralOffset: number) => number;
}

export const WATER_FEATURE_BUDGETS = {
  standard: {
    streamVertices: 322,
    waterfallVertices: 28,
    mistInstances: 30,
    rockInstances: 72,
  },
  low: {
    streamVertices: 182,
    waterfallVertices: 16,
    mistInstances: 12,
    rockInstances: 36,
  },
} as const satisfies Record<'standard' | 'low', WaterFeatureBudget>;

export const WATER_FEATURE_CONFIGS = {
  stream: {
    style: 'water',
    cellLengthMeters: 220,
    sampleSpacingMeters: 14,
    lateralDistance: 4.8,
    meanderPrimary: 1.15,
    meanderSecondary: 0.42,
    widthVariation: 0.24,
    surfaceLift: 0.025,
    waterfallChance: 0.28,
    waterfallSourceDistance: 2.8,
    waterfallMinDrop: 0.16,
    waterfallWidth: [0.38, 0.9],
    mistPerWaterfall: [3, 6],
    rocksPerCell: [4, 7],
    rockScale: [0.08, 0.28],
  },
  ice: {
    style: 'ice',
    cellLengthMeters: 280,
    sampleSpacingMeters: 18,
    lateralDistance: 5.2,
    meanderPrimary: 0.72,
    meanderSecondary: 0.26,
    widthVariation: 0.16,
    surfaceLift: 0.032,
    waterfallChance: 0.16,
    waterfallSourceDistance: 3.2,
    waterfallMinDrop: 0.22,
    waterfallWidth: [0.46, 1.05],
    mistPerWaterfall: [1, 3],
    rocksPerCell: [3, 6],
    rockScale: [0.1, 0.34],
  },
  runoff: {
    style: 'runoff',
    cellLengthMeters: 180,
    sampleSpacingMeters: 16,
    lateralDistance: 4.4,
    meanderPrimary: 0.64,
    meanderSecondary: 0.31,
    widthVariation: 0.3,
    surfaceLift: 0.02,
    waterfallChance: 0.2,
    waterfallSourceDistance: 2.1,
    waterfallMinDrop: 0.12,
    waterfallWidth: [0.28, 0.68],
    mistPerWaterfall: [1, 3],
    rocksPerCell: [5, 8],
    rockScale: [0.07, 0.24],
  },
  canal: {
    style: 'canal',
    cellLengthMeters: 320,
    sampleSpacingMeters: 20,
    lateralDistance: 4.2,
    meanderPrimary: 0.08,
    meanderSecondary: 0.03,
    widthVariation: 0.04,
    surfaceLift: 0.018,
    waterfallChance: 0,
    waterfallSourceDistance: 1.6,
    waterfallMinDrop: 0.2,
    waterfallWidth: [0.3, 0.5],
    mistPerWaterfall: [0, 0],
    rocksPerCell: [2, 4],
    rockScale: [0.1, 0.22],
  },
} as const satisfies Record<ActiveWaterwayKind, WaterFeatureConfig>;

const UP = new THREE.Vector3(0, 1, 0);

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(initialSeed: number): () => number {
  let seed = initialSeed >>> 0;
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedBudget(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.floor(finiteOr(value ?? fallback, fallback)));
}

function resolveBudget(
  lowDetail: boolean,
  requested: Partial<WaterFeatureBudget> | undefined,
): WaterFeatureBudget {
  const fallback = lowDetail ? WATER_FEATURE_BUDGETS.low : WATER_FEATURE_BUDGETS.standard;
  return {
    streamVertices: normalizedBudget(requested?.streamVertices, fallback.streamVertices),
    waterfallVertices: normalizedBudget(requested?.waterfallVertices, fallback.waterfallVertices),
    mistInstances: normalizedBudget(requested?.mistInstances, fallback.mistInstances),
    rockInstances: normalizedBudget(requested?.rockInstances, fallback.rockInstances),
  };
}

function resolvedConfig(
  kind: ActiveWaterwayKind,
  overrides: Partial<WaterFeatureConfig> | undefined,
): WaterFeatureConfig {
  return { ...WATER_FEATURE_CONFIGS[kind], ...overrides };
}

function routeFrame(
  curve: THREE.CatmullRomCurve3,
  distanceMeters: number,
  totalDistanceMeters: number,
) {
  const u = THREE.MathUtils.clamp(distanceMeters / totalDistanceMeters, 0, 1);
  const point = curve.getPointAt(u);
  const tangent = curve.getTangentAt(u).normalize();
  const right = new THREE.Vector3(-tangent.z, 0, tangent.x);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  return { point, tangent, right };
}

function safeTerrainHeight(
  sampler: CreateStreamedWaterFeaturesOptions['terrainHeight'],
  distanceMeters: number,
  lateralOffset: number,
  fallbackY: number,
): number {
  return finiteOr(sampler(distanceMeters, lateralOffset), fallbackY);
}

function streamSide(seed: number): number {
  return (seed & 1) === 0 ? 1 : -1;
}

function streamOffsetAt(
  distanceMeters: number,
  side: number,
  phase: number,
  config: WaterFeatureConfig,
  halfWidth: number,
  minimumClearanceOffset: number,
  centerOffsetAt?: CreateStreamedWaterFeaturesOptions['centerOffsetAt'],
): number {
  const sharedCenter = centerOffsetAt?.(distanceMeters, halfWidth);
  if (sharedCenter !== null && sharedCenter !== undefined && Number.isFinite(sharedCenter)) {
    const sharedSide = sharedCenter < 0 ? -1 : 1;
    return sharedSide * Math.max(Math.abs(sharedCenter), minimumClearanceOffset + halfWidth);
  }
  const meander = (
    Math.sin(distanceMeters * 0.0091 + phase) * config.meanderPrimary
    + Math.sin(distanceMeters * 0.023 + phase * 0.71) * config.meanderSecondary
  );
  const magnitude = Math.max(
    config.lateralDistance + meander,
    minimumClearanceOffset + halfWidth,
  );
  return side * magnitude;
}

function widthAt(
  distanceMeters: number,
  phase: number,
  width: number,
  variation: number,
): number {
  const multiplier = 1 + Math.sin(distanceMeters * 0.014 + phase * 1.31) * variation;
  return Math.max(0.02, width * multiplier);
}

function emptyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
  geometry.setIndex([]);
  return geometry;
}

function makeStreamGeometry(
  options: CreateStreamedWaterFeaturesOptions,
  config: WaterFeatureConfig,
  budget: WaterFeatureBudget,
  startMeters: number,
  endMeters: number,
  side: number,
  phase: number,
  roadHalfWidth: number,
  roadClearance: number,
): { geometry: THREE.BufferGeometry; samples: WaterStreamSample[] } {
  const maxSampleCount = Math.floor(budget.streamVertices / 2);
  if (maxSampleCount < 2 || endMeters <= startMeters || options.width <= 0) {
    return { geometry: emptyGeometry(), samples: [] };
  }

  const spacing = Math.max(0.5, finiteOr(config.sampleSpacingMeters, 14));
  const distances = [startMeters];
  const firstGridDistance = Math.ceil((startMeters + 1e-7) / spacing) * spacing;
  for (let distance = firstGridDistance; distance < endMeters - 1e-7; distance += spacing) {
    distances.push(distance);
  }
  if (endMeters - distances[distances.length - 1] > 1e-7) distances.push(endMeters);
  if (distances.length > maxSampleCount) {
    const interior = distances.slice(1, -1);
    const stride = Math.ceil(interior.length / Math.max(1, maxSampleCount - 2));
    const bounded = interior.filter((_, index) => index % stride === 0).slice(0, maxSampleCount - 2);
    distances.splice(0, distances.length, startMeters, ...bounded, endMeters);
  }
  const sampleCount = distances.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const samples: WaterStreamSample[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const distanceMeters = distances[index];
    const frame = routeFrame(options.curve, distanceMeters, options.totalDistanceMeters);
    const fullWidth = widthAt(distanceMeters, phase, options.width, config.widthVariation);
    const halfWidth = fullWidth / 2;
    const centerOffset = streamOffsetAt(
      distanceMeters,
      side,
      phase,
      config,
      halfWidth,
      roadHalfWidth + roadClearance,
      options.centerOffsetAt,
    );
    const leftOffset = centerOffset - halfWidth;
    const rightOffset = centerOffset + halfWidth;
    const left = frame.point.clone().addScaledVector(frame.right, leftOffset);
    const right = frame.point.clone().addScaledVector(frame.right, rightOffset);
    left.y = safeTerrainHeight(options.terrainHeight, distanceMeters, leftOffset, frame.point.y)
      + config.surfaceLift;
    right.y = safeTerrainHeight(options.terrainHeight, distanceMeters, rightOffset, frame.point.y)
      + config.surfaceLift;

    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    const textureV = distanceMeters / 35;
    uvs.push(0, textureV, 1, textureV);
    samples.push({ distanceMeters, centerOffset, halfWidth, left, right });

    if (index < sampleCount - 1) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, samples };
}

interface Ranked<T> {
  rank: number;
  value: T;
}

function chooseByStableRank<T>(candidates: Ranked<T>[], maximum: number): T[] {
  if (maximum <= 0) return [];
  return candidates
    .sort((left, right) => left.rank - right.rank)
    .slice(0, maximum)
    .map((candidate) => candidate.value);
}

function integerBetween(random: () => number, range: readonly [number, number]): number {
  const minimum = Math.ceil(Math.min(range[0], range[1]));
  const maximum = Math.floor(Math.max(range[0], range[1]));
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function createWaterfallGeometry(waterfalls: WaterfallSheet[]): THREE.BufferGeometry {
  if (waterfalls.length === 0) return emptyGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < waterfalls.length; index += 1) {
    const waterfall = waterfalls[index];
    const fallDirection = waterfall.base.clone().sub(waterfall.top);
    const horizontal = new THREE.Vector3(fallDirection.x, 0, fallDirection.z);
    if (horizontal.lengthSq() < 1e-8) horizontal.set(0, 0, 1);
    horizontal.normalize();
    const across = new THREE.Vector3().crossVectors(UP, horizontal).normalize()
      .multiplyScalar(waterfall.width / 2);
    const topLeft = waterfall.top.clone().sub(across);
    const topRight = waterfall.top.clone().add(across);
    const baseLeft = waterfall.base.clone().sub(across);
    const baseRight = waterfall.base.clone().add(across);
    positions.push(
      topLeft.x, topLeft.y, topLeft.z,
      topRight.x, topRight.y, topRight.z,
      baseLeft.x, baseLeft.y, baseLeft.z,
      baseRight.x, baseRight.y, baseRight.z,
    );
    uvs.push(0, 1, 1, 1, 0, 0, 1, 0);
    const baseIndex = index * 4;
    indices.push(
      baseIndex, baseIndex + 2, baseIndex + 1,
      baseIndex + 1, baseIndex + 2, baseIndex + 3,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function featureCells(startMeters: number, endMeters: number, cellLengthMeters: number): number[] {
  if (endMeters <= startMeters) return [];
  const first = Math.floor(startMeters / cellLengthMeters);
  const last = Math.floor(Math.max(startMeters, endMeters - 1e-7) / cellLengthMeters);
  const cells: number[] = [];
  for (let cell = first; cell <= last; cell += 1) cells.push(cell);
  return cells;
}

/**
 * Builds a bounded, deterministic water-feature window. The two returned
 * geometries are caller-owned and should be disposed when a streamed window is
 * retired. Mist and rock transforms can be fed directly to instanced meshes.
 */
export function createStreamedWaterFeatures(
  options: CreateStreamedWaterFeaturesOptions,
): StreamedWaterFeatures {
  const totalDistanceMeters = Math.max(1, finiteOr(options.totalDistanceMeters, 1));
  const startMeters = THREE.MathUtils.clamp(
    Math.min(options.window.startMeters, options.window.endMeters),
    0,
    totalDistanceMeters,
  );
  const endMeters = THREE.MathUtils.clamp(
    Math.max(options.window.startMeters, options.window.endMeters),
    0,
    totalDistanceMeters,
  );
  const config = resolvedConfig(options.kind, options.config);
  const budget = resolveBudget(Boolean(options.lowDetail), options.budget);
  const roadHalfWidth = Math.max(0, finiteOr(options.roadHalfWidth ?? 0.35, 0.35));
  const roadClearance = Math.max(0, finiteOr(options.roadClearance ?? 1.05, 1.05));
  const namespace = `${options.themeKey ?? options.kind}:${options.seed >>> 0}`;
  const featureSeed = (options.seed ^ hashString(namespace)) >>> 0;
  const side = streamSide(featureSeed);
  const phase = (hashString(`${namespace}:water-phase`) % 65536) / 977;
  const { geometry: streamGeometry, samples: streamSamples } = makeStreamGeometry(
    { ...options, totalDistanceMeters },
    config,
    budget,
    startMeters,
    endMeters,
    side,
    phase,
    roadHalfWidth,
    roadClearance,
  );

  const waterfallCandidates: Ranked<WaterfallSheet>[] = [];
  const rockCandidates: Ranked<WaterFeatureTransform>[] = [];
  const cellLength = Math.max(25, finiteOr(config.cellLengthMeters, 220));
  const cells = featureCells(startMeters, endMeters, cellLength);

  for (const cellIndex of cells) {
    const cellSeed = (featureSeed ^ Math.imul(cellIndex + 1, 0x45D9F3B)) >>> 0;
    const random = mulberry32(cellSeed);
    const waterfallRoll = random();
    const waterfallDistance = (cellIndex + 0.16 + random() * 0.68) * cellLength;
    const waterfallRandoms = [random(), random(), random()];
    const rockCount = integerBetween(random, config.rocksPerCell);

    if (
      config.waterfallChance > 0
      && waterfallRoll < config.waterfallChance
      && waterfallDistance >= startMeters
      && waterfallDistance <= endMeters
    ) {
      const frame = routeFrame(options.curve, waterfallDistance, totalDistanceMeters);
      const streamWidth = widthAt(waterfallDistance, phase, options.width, config.widthVariation);
      const baseOffset = streamOffsetAt(
        waterfallDistance,
        side,
        phase,
        config,
        streamWidth / 2,
        roadHalfWidth + roadClearance,
        options.centerOffsetAt,
      );
      const topOffset = baseOffset + side * (
        config.waterfallSourceDistance * (0.82 + waterfallRandoms[0] * 0.36)
      );
      const topTerrainY = safeTerrainHeight(
        options.terrainHeight,
        waterfallDistance,
        topOffset,
        frame.point.y,
      );
      const baseTerrainY = safeTerrainHeight(
        options.terrainHeight,
        waterfallDistance,
        baseOffset,
        frame.point.y,
      );
      if (topTerrainY - baseTerrainY >= config.waterfallMinDrop) {
        const top = frame.point.clone().addScaledVector(frame.right, topOffset);
        const base = frame.point.clone().addScaledVector(frame.right, baseOffset);
        top.y = topTerrainY + config.surfaceLift;
        base.y = baseTerrainY + config.surfaceLift;
        const width = THREE.MathUtils.lerp(
          config.waterfallWidth[0],
          config.waterfallWidth[1],
          waterfallRandoms[1],
        );
        const id = `${namespace}:waterfall:${cellIndex}`;
        waterfallCandidates.push({
          rank: hashString(`${id}:rank`),
          value: {
            id,
            cellIndex,
            distanceMeters: waterfallDistance,
            topOffset,
            baseOffset,
            topTerrainY,
            baseTerrainY,
            top,
            base,
            width,
          },
        });
      }
    }

    for (let rockIndex = 0; rockIndex < rockCount; rockIndex += 1) {
      const distanceMeters = (cellIndex + 0.05 + random() * 0.9) * cellLength;
      if (distanceMeters < startMeters || distanceMeters > endMeters) continue;
      const frame = routeFrame(options.curve, distanceMeters, totalDistanceMeters);
      const streamWidth = widthAt(distanceMeters, phase, options.width, config.widthVariation);
      const streamOffset = streamOffsetAt(
        distanceMeters,
        side,
        phase,
        config,
        streamWidth / 2,
        roadHalfWidth + roadClearance,
        options.centerOffsetAt,
      );
      const bankSide = random() < 0.5 ? -1 : 1;
      const lateralOffset = streamOffset + bankSide * (streamWidth * 0.55 + 0.08 + random() * 0.42);
      const terrainY = safeTerrainHeight(
        options.terrainHeight,
        distanceMeters,
        lateralOffset,
        frame.point.y,
      );
      const scalar = THREE.MathUtils.lerp(config.rockScale[0], config.rockScale[1], random());
      const scale = new THREE.Vector3(
        scalar * (0.75 + random() * 0.8),
        scalar * (0.5 + random() * 0.75),
        scalar * (0.72 + random() * 0.85),
      );
      const position = frame.point.clone().addScaledVector(frame.right, lateralOffset);
      position.y = terrainY + scale.y / 2;
      const id = `${namespace}:bank-rock:${cellIndex}:${rockIndex}`;
      rockCandidates.push({
        rank: hashString(`${id}:rank`),
        value: {
          id,
          cellIndex,
          distanceMeters,
          lateralOffset,
          terrainY,
          position,
          quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(
            random() * 0.22,
            random() * Math.PI * 2,
            random() * 0.22,
          )),
          scale,
        },
      });
    }
  }

  const waterfalls = chooseByStableRank(
    waterfallCandidates,
    Math.floor(budget.waterfallVertices / 4),
  ).sort((left, right) => left.distanceMeters - right.distanceMeters);
  const rocks = chooseByStableRank(rockCandidates, budget.rockInstances)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  const mistCandidates: Ranked<WaterFeatureTransform>[] = [];

  for (const waterfall of waterfalls) {
    const random = mulberry32(hashString(`${waterfall.id}:mist`));
    const count = integerBetween(random, config.mistPerWaterfall);
    for (let mistIndex = 0; mistIndex < count; mistIndex += 1) {
      const distanceMeters = waterfall.distanceMeters + (random() - 0.5) * 18;
      const lateralOffset = waterfall.baseOffset + (random() - 0.5) * waterfall.width * 1.6;
      const frame = routeFrame(options.curve, distanceMeters, totalDistanceMeters);
      const terrainY = safeTerrainHeight(
        options.terrainHeight,
        distanceMeters,
        lateralOffset,
        waterfall.baseTerrainY,
      );
      const size = 0.18 + random() * 0.34;
      const position = frame.point.clone().addScaledVector(frame.right, lateralOffset);
      position.y = terrainY + size * (0.22 + random() * 0.28);
      const id = `${waterfall.id}:mist:${mistIndex}`;
      mistCandidates.push({
        rank: hashString(`${id}:rank`),
        value: {
          id,
          cellIndex: waterfall.cellIndex,
          distanceMeters,
          lateralOffset,
          terrainY,
          position,
          quaternion: new THREE.Quaternion(),
          scale: new THREE.Vector3(size * (1.3 + random()), size, size),
        },
      });
    }
  }

  const mist = chooseByStableRank(mistCandidates, budget.mistInstances)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  return {
    kind: options.kind,
    style: config.style,
    streamGeometry,
    waterfallGeometry: createWaterfallGeometry(waterfalls),
    streamSamples,
    waterfalls,
    mist,
    rocks,
    budget,
  };
}

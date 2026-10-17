import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RouteModel } from '../types/cycling';
import type { ScenicQualityMode, ScenicTheme } from '../types/scenic';
import {
  getScenicWorldProfile,
  type ScenicIndividualAsset,
} from '../scenic/worldProfiles';
import {
  EquirectangularBackground,
  panoramaYawForTangent,
} from '../scenic/EquirectangularBackground';
import {
  createProceduralMaterialBundle,
  type ProceduralMaterialBundle,
} from '../scenic/proceduralMaterials';
import {
  cinematicTerrainAlphaWeight,
  createCinematicTerrainMaterial,
  setCinematicTerrainAlphaAttribute,
  setCinematicTerrainDistanceAttribute,
} from '../scenic/cinematicTerrainMaterial';
import { sampleCurvaturePresentation } from '../scenic/curvaturePresentation';
import {
  generateNearWorld,
  groupNearWorldInstances,
  type NearWorldInstance,
} from '../scenic/nearWorldGenerator';
import { createStreamedWaterFeatures } from '../scenic/waterFeatures';
import {
  SCENIC_TERRAIN_RECIPES,
  sampleScenicTerrain,
  scenicTerrainHeight,
  scenicWaterCenterOffset,
} from '../scenic/terrainSystem';
import {
  deriveBillboardVariation,
  stableBillboardHash,
  type BillboardVariationKind,
} from '../scenic/billboardVariation';
import { ScenicEnvironmentLighting } from '../scenic/ScenicEnvironmentLighting';
import { ScenicWaterMaterial } from '../scenic/ScenicWaterMaterial';
import {
  configureGpuBillboardInstances,
  createGpuBillboardMaterial,
} from '../scenic/gpuBillboardMaterial';
import {
  createAdaptiveScenicQualityState,
  deriveScenicRenderPlan,
  setAdaptiveScenicQualityMode,
  summarizeScenicFrameTimes,
  updateAdaptiveScenicQuality,
  type ScenicPerformanceWindow,
  type ScenicQualityEnvironment,
  type ScenicRenderPlan,
} from '../scenic/adaptiveQuality';

export type { ScenicTheme } from '../types/scenic';

interface ScenicRideProps {
  ghostDistanceMeters?: number;
  route: RouteModel;
  distanceMeters: number;
  speedKph: number;
  cadenceRpm: number;
  isPaused: boolean;
  theme: ScenicTheme;
  qualityMode: ScenicQualityMode;
}

interface RouteWorld {
  curve: THREE.CatmullRomCurve3;
  totalDistanceMeters: number;
  seed: number;
  lowDetail: boolean;
}

interface InstanceTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  groundPosition?: THREE.Vector3;
  billboardYawOffset?: number;
  billboardLean?: number;
  billboardWindPhase?: number;
  billboardWindAmplitude?: number;
  billboardWindSpeed?: number;
}

interface WorldWindow {
  index: number;
  startMeters: number;
  endMeters: number;
}

interface ScenicRendererMetrics {
  meanFrameTimeMs: number;
  frameTimeP95Ms: number;
  slowFrameRatio: number;
  calls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

const WORLD_SCALE = 0.1; // One scene unit represents ten real-world meters.
// True-scale grades read as flat from a rider's-eye camera, so the visual world
// exaggerates elevation only. Physics, resistance, and recorded data are untouched.
const VERTICAL_EXAGGERATION = 1.5;
const ROAD_WIDTH = 0.7;
// Keep procedural texture phase continuous when the streamed 400 m world window changes.
// Existing material repeat values were tuned around an approximately 2.2 km UV span.
const SCENIC_TEXTURE_UV_SPAN_METERS = 2_200;
const UP = new THREE.Vector3(0, 1, 0);

function scheduleScenicIdleWork(work: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const idleWindow = window as Window & typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(work, { timeout: 900 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(work, 48);
  return () => window.clearTimeout(handle);
}

function scheduleScenicIdleSequence(tasks: ReadonlyArray<() => void>): () => void {
  let cancelled = false;
  let cancelCurrent: () => void = () => undefined;
  const scheduleAt = (index: number) => {
    if (cancelled || index >= tasks.length) return;
    cancelCurrent = scheduleScenicIdleWork(() => {
      if (cancelled) return;
      tasks[index]();
      // Request the next idle slot only after this product is complete. This
      // prevents terrain, props, and water from clustering in one idle frame.
      scheduleAt(index + 1);
    });
  };
  scheduleAt(0);
  return () => {
    cancelled = true;
    cancelCurrent();
  };
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}

function useScenicViewportSize(ref: React.RefObject<HTMLDivElement>) {
  const [size, setSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1_280 : Math.max(1, window.innerWidth),
    height: typeof window === 'undefined' ? 720 : Math.max(1, window.innerHeight),
  }));

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      setSize((current) => {
        const next = {
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        };
        return current.width === next.width && current.height === next.height ? current : next;
      });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function useDevicePixelRatio(): number {
  const [devicePixelRatio, setDevicePixelRatio] = useState(() => (
    typeof window === 'undefined' ? 1 : window.devicePixelRatio
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let resolutionQuery: MediaQueryList | null = null;
    const update = () => {
      setDevicePixelRatio(window.devicePixelRatio);
      resolutionQuery?.removeEventListener('change', update);
      resolutionQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        : null;
      resolutionQuery?.addEventListener('change', update);
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      resolutionQuery?.removeEventListener('change', update);
    };
  }, []);

  return devicePixelRatio;
}

function ScenicPerformanceProbe({
  enabled,
  onObservation,
}: {
  enabled: boolean;
  onObservation: (observation: ScenicPerformanceWindow, metrics: ScenicRendererMetrics) => void;
}) {
  const { gl } = useThree();
  const frameTimes = useRef<number[]>([]);
  const observedDuration = useRef(0);

  useFrame((_state, deltaSeconds) => {
    if (!enabled || (typeof document !== 'undefined' && document.hidden)) {
      frameTimes.current = [];
      observedDuration.current = 0;
      return;
    }
    const frameTimeMs = Math.min(250, Math.max(0.1, deltaSeconds * 1_000));
    frameTimes.current.push(frameTimeMs);
    observedDuration.current += frameTimeMs;
    if (observedDuration.current < 1_750) return;
    const summary = summarizeScenicFrameTimes(frameTimes.current);
    frameTimes.current = [];
    observedDuration.current = 0;
    if (!summary) return;
    onObservation(summary, {
      meanFrameTimeMs: summary.meanFrameTimeMs,
      frameTimeP95Ms: summary.frameTimeP95Ms,
      slowFrameRatio: summary.slowFrameRatio,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      textures: gl.info.memory.textures,
      geometries: gl.info.memory.geometries,
    });
  });

  return null;
}

function hasCinematicBackdrop(theme: ScenicTheme): boolean {
  const profile = getScenicWorldProfile(theme);
  return Boolean(profile.panorama || profile.referenceArt);
}

const THEMES = {
  daybreak: {
    fog: '#8daab4',
    fogDensity: 0.0048,
    skyTop: '#102a46',
    skyHorizon: '#e6a56f',
    skyBottom: '#829eaa',
    terrain: '#365448',
    shoulder: '#69736d',
    road: '#171b20',
    roadEdge: '#eff8f7',
    tree: '#102b25',
    trunk: '#473a2d',
    rock: '#68777c',
    mountain: '#536a78',
    mountainCap: '#dbe8e9',
    celestial: '#ffd99c',
    celestialGlow: '#ffad62',
    ambient: '#bbd3de',
    sun: '#ffd5a3',
    exposure: 1.12,
  },
  moonride: {
    fog: '#11112d',
    fogDensity: 0.0075,
    skyTop: '#020617',
    skyHorizon: '#29205d',
    skyBottom: '#0d102c',
    terrain: '#171632',
    shoulder: '#2d2852',
    road: '#090d18',
    roadEdge: '#22d3ee',
    tree: '#090a1b',
    trunk: '#171225',
    rock: '#302d56',
    mountain: '#151536',
    mountainCap: '#7c6aaf',
    celestial: '#e4a7ff',
    celestialGlow: '#a855f7',
    ambient: '#536da8',
    sun: '#bf8cff',
    exposure: 1.22,
  },
  deathisland: {
    fog: '#74b8bf',
    fogDensity: 0.0055,
    skyTop: '#526a9a',
    skyHorizon: '#d1d5d1',
    skyBottom: '#7897a4',
    terrain: '#526242',
    shoulder: '#746c5b',
    road: '#343a3b',
    roadEdge: '#69cfd4',
    tree: '#344d2f',
    trunk: '#473b28',
    rock: '#737b71',
    mountain: '#5f665b',
    mountainCap: '#8a9183',
    celestial: '#ffe3a3',
    celestialGlow: '#ffd37a',
    ambient: '#bde0d1',
    sun: '#ffe0a6',
    exposure: 1.18,
  },
  avalanche: {
    fog: '#b3c8d8', fogDensity: 0.0045, skyTop: '#172638', skyHorizon: '#879dac', skyBottom: '#cad8e1',
    terrain: '#9fb2bf', shoulder: '#b9cbd6', road: '#303b43', roadEdge: '#a5f3fc', tree: '#263b43',
    trunk: '#4b5256', rock: '#708695', mountain: '#506675', mountainCap: '#e5f2f7', celestial: '#e8f4ff',
    celestialGlow: '#b9ddff', ambient: '#c7dae8', sun: '#dceeff', exposure: 1.14,
  },
  sidewinder: {
    fog: '#75879d', fogDensity: 0.0042, skyTop: '#081528', skyHorizon: '#bd9988', skyBottom: '#50657c',
    terrain: '#7b8790', shoulder: '#a4afb5', road: '#30373d', roadEdge: '#8ad7e3', tree: '#152a2f',
    trunk: '#3e4143', rock: '#5e6872', mountain: '#3e4b59', mountainCap: '#d8e3e8', celestial: '#f4f7ff',
    celestialGlow: '#99bce7', ambient: '#8299b8', sun: '#c9d9ef', exposure: 1.12,
  },
  snowbound: {
    fog: '#b8c9e5', fogDensity: 0.0038, skyTop: '#0e3f94', skyHorizon: '#8bb8f0', skyBottom: '#d7e5f4',
    terrain: '#c4d2df', shoulder: '#dbe4ec', road: '#343a4d', roadEdge: '#a78bfa', tree: '#334155',
    trunk: '#475569', rock: '#69768a', mountain: '#53627a', mountainCap: '#f1f5f9', celestial: '#eadcff',
    celestialGlow: '#c084fc', ambient: '#d3e0f3', sun: '#f6f0ff', exposure: 1.18,
  },
  forgeworld: {
    fog: '#a8cad8', fogDensity: 0.0032, skyTop: '#2d84c5', skyHorizon: '#c9e6ef', skyBottom: '#79aec0',
    terrain: '#4f6944', shoulder: '#76766a', road: '#343a39', roadEdge: '#b9eef0', tree: '#1e3d2d',
    trunk: '#51483a', rock: '#7b827d', mountain: '#606b6b', mountainCap: '#e1eaec', celestial: '#fff1c9',
    celestialGlow: '#d8efff', ambient: '#c4dfdc', sun: '#fff1d6', exposure: 1.16,
  },
  powerhouse: {
    fog: '#a98470', fogDensity: 0.004, skyTop: '#765a51', skyHorizon: '#d9ad89', skyBottom: '#9a7664',
    terrain: '#70533c', shoulder: '#8c6f54', road: '#3b3430', roadEdge: '#e7a764', tree: '#453e2c',
    trunk: '#4a3328', rock: '#815b43', mountain: '#694936', mountainCap: '#b58a6d', celestial: '#ffe0ae',
    celestialGlow: '#f59e6b', ambient: '#c9a28c', sun: '#ffd0a0', exposure: 1.12,
  },
  nmpdhq: {
    fog: '#755d69', fogDensity: 0.0048, skyTop: '#33283d', skyHorizon: '#db836f', skyBottom: '#76515e',
    terrain: '#3d3c43', shoulder: '#60575a', road: '#28282d', roadEdge: '#f09a7f', tree: '#24242b',
    trunk: '#373238', rock: '#5b5660', mountain: '#49434d', mountainCap: '#a78d96', celestial: '#ffd5ba',
    celestialGlow: '#fb7185', ambient: '#ac8796', sun: '#ffba9c', exposure: 1.08,
  },
  coastalhighway: {
    fog: '#9a6b55', fogDensity: 0.0044, skyTop: '#58362f', skyHorizon: '#f5a866', skyBottom: '#9d604a',
    terrain: '#554a3e', shoulder: '#806b58', road: '#302d2b', roadEdge: '#ffc36e', tree: '#2f3827',
    trunk: '#4a3528', rock: '#706359', mountain: '#5e514b', mountainCap: '#bda18f', celestial: '#ffe0a1',
    celestialGlow: '#fb923c', ambient: '#c99f83', sun: '#ffd099', exposure: 1.12,
  },
} as const;

const THEME_LIGHTING: Record<ScenicTheme, {
  sunPosition: [number, number, number];
  sunIntensity: number;
  hemisphereIntensity: number;
  environmentIntensity: number;
  groundColor: string;
  shadowColor: string;
  shadowAngle: number;
  billboardTint: string;
}> = {
  daybreak: { sunPosition: [-48, 52, 30], sunIntensity: 3.35, hemisphereIntensity: 1.5, environmentIntensity: 0.72, groundColor: '#243a31', shadowColor: '#13251f', shadowAngle: -0.95, billboardTint: '#fff5e6' },
  moonride: { sunPosition: [34, 68, -42], sunIntensity: 1.35, hemisphereIntensity: 0.82, environmentIntensity: 0, groundColor: '#080615', shadowColor: '#050714', shadowAngle: 0.7, billboardTint: '#d9ddff' },
  deathisland: { sunPosition: [-56, 58, -12], sunIntensity: 2.35, hemisphereIntensity: 1.16, environmentIntensity: 0.78, groundColor: '#283329', shadowColor: '#15241c', shadowAngle: -1.1, billboardTint: '#f3f5e8' },
  avalanche: { sunPosition: [-24, 76, -48], sunIntensity: 2.6, hemisphereIntensity: 1.25, environmentIntensity: 0.92, groundColor: '#596b78', shadowColor: '#344552', shadowAngle: -0.45, billboardTint: '#edf6ff' },
  sidewinder: { sunPosition: [44, 64, -36], sunIntensity: 2.15, hemisphereIntensity: 1.05, environmentIntensity: 0.7, groundColor: '#232c38', shadowColor: '#18222e', shadowAngle: 0.6, billboardTint: '#dce8f4' },
  snowbound: { sunPosition: [-4, 82, -54], sunIntensity: 2.75, hemisphereIntensity: 1.34, environmentIntensity: 0.96, groundColor: '#6b7b94', shadowColor: '#42516c', shadowAngle: -0.1, billboardTint: '#f3f5ff' },
  forgeworld: { sunPosition: [-62, 62, -20], sunIntensity: 2.5, hemisphereIntensity: 1.24, environmentIntensity: 0.86, groundColor: '#304032', shadowColor: '#17271c', shadowAngle: -1.2, billboardTint: '#f1f4e8' },
  powerhouse: { sunPosition: [58, 54, -12], sunIntensity: 2.55, hemisphereIntensity: 1.08, environmentIntensity: 0.66, groundColor: '#3c2e28', shadowColor: '#2a1712', shadowAngle: 1.05, billboardTint: '#ffe8d7' },
  nmpdhq: { sunPosition: [48, 60, -38], sunIntensity: 2.7, hemisphereIntensity: 1.02, environmentIntensity: 0.88, groundColor: '#2b2028', shadowColor: '#1a111a', shadowAngle: 0.75, billboardTint: '#ffe2dc' },
  coastalhighway: { sunPosition: [-54, 48, -8], sunIntensity: 2.85, hemisphereIntensity: 1.12, environmentIntensity: 0.82, groundColor: '#3a2a23', shadowColor: '#25150f', shadowAngle: -1.0, billboardTint: '#ffe9d5' },
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function getRouteFrame(curve: THREE.CatmullRomCurve3, u: number) {
  const clampedU = THREE.MathUtils.clamp(u, 0, 1);
  const point = curve.getPointAt(clampedU);
  const tangent = curve.getTangentAt(clampedU).normalize();
  const right = new THREE.Vector3(-tangent.z, 0, tangent.x);
  if (right.lengthSq() < 0.00001) right.set(1, 0, 0);
  right.normalize();
  return { point, tangent, right };
}

function buildRouteWorld(route: RouteModel, lowDetail: boolean): RouteWorld {
  const validPoints = route.points.filter((point) => (
    Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && Number.isFinite(point.elevation)
  ));

  const source = validPoints.length >= 2 ? validPoints : [
    { lat: 0, lng: 0, elevation: 0 },
    { lat: 0.001, lng: 0, elevation: 8 },
  ];
  const first = source[0];
  const latitudeRadians = first.lat * Math.PI / 180;
  const maxControlPoints = 900;
  const stride = Math.max(1, Math.ceil(source.length / maxControlPoints));
  const sampled = source.filter((_, index) => index % stride === 0 || index === source.length - 1);

  const worldPoints: THREE.Vector3[] = [];
  for (const point of sampled) {
    const eastMeters = (point.lng - first.lng) * 111_320 * Math.cos(latitudeRadians);
    const northMeters = (point.lat - first.lat) * 111_320;
    const candidate = new THREE.Vector3(
      eastMeters * WORLD_SCALE,
      (point.elevation - first.elevation) * WORLD_SCALE * VERTICAL_EXAGGERATION,
      -northMeters * WORLD_SCALE,
    );
    if (!worldPoints.length || candidate.distanceToSquared(worldPoints.at(-1)!) > 0.000001) {
      worldPoints.push(candidate);
    }
  }

  if (worldPoints.length < 2) worldPoints.push(new THREE.Vector3(0, 0.8, -10));
  const curve = new THREE.CatmullRomCurve3(worldPoints, false, 'centripetal', 0.35);
  curve.arcLengthDivisions = Math.min(5000, Math.max(800, Math.round(route.totalDistanceMeters / 4)));
  curve.updateArcLengths();

  return {
    curve,
    totalDistanceMeters: Math.max(1, route.totalDistanceMeters),
    seed: hashString(`${route.id}:${route.name}`),
    lowDetail,
  };
}

function getWorldWindow(world: RouteWorld, index: number): WorldWindow {
  const anchorMeters = index * 400;
  return {
    index,
    startMeters: Math.max(0, anchorMeters - 300),
    endMeters: Math.min(world.totalDistanceMeters, Math.max(1_600, anchorMeters + 1_900)),
  };
}

function getSceneryWindow(
  world: RouteWorld,
  index: number,
  cinematicBackdrop: boolean,
): WorldWindow {
  const window = getWorldWindow(world, index);
  return cinematicBackdrop ? {
    ...window,
    endMeters: Math.min(window.endMeters, index * 400 + 700),
  } : window;
}

function streamedWindowCacheKey(
  world: RouteWorld,
  theme: ScenicTheme,
  window: WorldWindow,
): string {
  return [
    world.seed,
    world.totalDistanceMeters,
    world.lowDetail ? 'low' : 'standard',
    theme,
    window.index,
    window.startMeters,
    window.endMeters,
  ].join(':');
}

function terrainHeightDelta(distanceMeters: number, offset: number, seed: number, theme: ScenicTheme): number {
  const profile = getScenicWorldProfile(theme);
  return scenicTerrainHeight({
    distanceMeters,
    lateralOffsetWorld: offset,
    seed,
    theme,
    waterwayKind: profile.waterway.kind,
    waterWidth: profile.waterway.width,
  });
}

function createNearWorldForWindow(
  world: RouteWorld,
  theme: ScenicTheme,
  sceneryWindow: WorldWindow,
): ReturnType<typeof generateNearWorld> | null {
  const profile = getScenicWorldProfile(theme);
  if (!hasCinematicBackdrop(theme) || !profile.individualAssets) return null;
  return generateNearWorld({
    curve: world.curve,
    totalDistanceMeters: world.totalDistanceMeters,
    startMeters: sceneryWindow.startMeters,
    endMeters: sceneryWindow.endMeters,
    focusMeters: sceneryWindow.index * 400 + 200,
    seed: world.seed,
    theme,
    worldScale: WORLD_SCALE,
    quality: world.lowDetail ? 'low' : 'standard',
    terrainHeightAt: (distance, lateralOffsetWorld) => (
      terrainHeightDelta(distance, lateralOffsetWorld, world.seed, theme)
    ),
    placementSuitabilityAt: (kind, distance, lateralOffsetWorld) => {
      const sample = sampleScenicTerrain({
        distanceMeters: distance,
        lateralOffsetWorld,
        seed: world.seed,
        theme,
        waterwayKind: profile.waterway.kind,
        waterWidth: profile.waterway.width,
      });
      if (kind === 'streamBank') {
        return sample.waterDistance === null
          || (sample.wetness > 0.04 && sample.wetness < 0.72);
      }
      if (kind === 'rock') return sample.wetness < 0.68;
      if (kind === 'groundCover') return sample.wetness < 0.58;
      return sample.wetness < 0.42;
    },
  });
}

function createWaterForWindow(
  world: RouteWorld,
  theme: ScenicTheme,
  sceneryWindow: WorldWindow,
): ReturnType<typeof createStreamedWaterFeatures> | null {
  const profile = getScenicWorldProfile(theme);
  if (profile.waterway.kind === 'none') return null;
  return createStreamedWaterFeatures({
    curve: world.curve,
    totalDistanceMeters: world.totalDistanceMeters,
    window: sceneryWindow,
    seed: world.seed,
    themeKey: theme,
    kind: profile.waterway.kind,
    width: profile.waterway.width,
    roadHalfWidth: ROAD_WIDTH / 2,
    roadClearance: 0.72,
    lowDetail: world.lowDetail,
    config: theme === 'forgeworld' ? {
      lateralDistance: 1.82,
      meanderPrimary: 0.48,
      meanderSecondary: 0.18,
      waterfallChance: 0.48,
      waterfallSourceDistance: 2.1,
    } : undefined,
    centerOffsetAt: (distance) => scenicWaterCenterOffset(
      theme,
      world.seed,
      distance,
      profile.waterway.kind,
    ),
    terrainHeight: (distance, lateralOffsetWorld) => {
      const frame = getRouteFrame(world.curve, distance / world.totalDistanceMeters);
      return frame.point.y + terrainHeightDelta(distance, lateralOffsetWorld, world.seed, theme);
    },
  });
}

function disposeStreamedWater(
  streamedWater: ReturnType<typeof createStreamedWaterFeatures> | null,
): void {
  streamedWater?.streamGeometry.dispose();
  streamedWater?.waterfallGeometry.dispose();
}

function createRibbonGeometry(
  curve: THREE.CatmullRomCurve3,
  totalDistanceMeters: number,
  segments: number,
  width: number,
  yOffset: number,
  startU = 0,
  endU = 1,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const localU = index / segments;
    const frame = getRouteFrame(curve, THREE.MathUtils.lerp(startU, endU, localU));
    const left = frame.point.clone().addScaledVector(frame.right, -width / 2);
    const right = frame.point.clone().addScaledVector(frame.right, width / 2);
    left.y += yOffset;
    right.y += yOffset;
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    const routeDistanceMeters = THREE.MathUtils.lerp(startU, endU, localU)
      * totalDistanceMeters;
    const textureV = routeDistanceMeters / SCENIC_TEXTURE_UV_SPAN_METERS;
    uvs.push(0, textureV, 1, textureV);
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createTerrainGeometry(world: RouteWorld, theme: ScenicTheme, window: WorldWindow): THREE.BufferGeometry {
  const windowLength = Math.max(1, window.endMeters - window.startMeters);
  const alongSegments = Math.min(world.lowDetail ? 120 : 220, Math.max(48, Math.round(windowLength / 10)));
  const acrossSegments = world.lowDetail ? 12 : 20;
  // Cinematic worlds use the original matte painting for their distant scale and
  // detail. Keep real terrain close to the rider so it grounds the road without
  // covering the artwork with a wall of low-poly geometry.
  const halfWidth = hasCinematicBackdrop(theme) ? 6.2 : 22;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const alphaWeights: number[] = [];
  const routeDistances: number[] = [];
  const indices: number[] = [];
  const lowColor = new THREE.Color(THEMES[theme].terrain);
  const highColor = new THREE.Color(getScenicWorldProfile(theme).terrain.highColor);
  const terrainRecipe = SCENIC_TERRAIN_RECIPES[theme];
  const wetColor = new THREE.Color(terrainRecipe.wetColor);
  const accentColor = new THREE.Color(terrainRecipe.accentColor);
  const profile = getScenicWorldProfile(theme);

  for (let along = 0; along <= alongSegments; along += 1) {
    const distanceMeters = THREE.MathUtils.lerp(window.startMeters, window.endMeters, along / alongSegments);
    const u = distanceMeters / world.totalDistanceMeters;
    const frame = getRouteFrame(world.curve, u);
    for (let across = 0; across <= acrossSegments; across += 1) {
      const offset = -halfWidth + (across / acrossSegments) * halfWidth * 2;
      const position = frame.point.clone().addScaledVector(frame.right, offset);
      const terrainSample = sampleScenicTerrain({
        distanceMeters,
        lateralOffsetWorld: offset,
        seed: world.seed,
        theme,
        waterwayKind: profile.waterway.kind,
        waterWidth: profile.waterway.width,
      });
      const delta = terrainSample.height;
      position.y += delta;
      positions.push(position.x, position.y, position.z);

      const color = lowColor.clone().lerp(highColor, terrainSample.ridge * 0.78);
      color.lerp(accentColor, Math.abs(terrainSample.variation - 0.5) * 0.22);
      color.lerp(wetColor, terrainSample.wetness * 0.68);
      color.offsetHSL(0, 0, (terrainSample.variation - 0.5) * 0.055);
      colors.push(color.r, color.g, color.b);
      uvs.push(
        across / acrossSegments,
        distanceMeters / SCENIC_TEXTURE_UV_SPAN_METERS,
      );
      if (hasCinematicBackdrop(theme)) {
        routeDistances.push(distanceMeters);
        alphaWeights.push(cinematicTerrainAlphaWeight(
          0,
          offset,
          [330, 760],
          [5.35, halfWidth],
        ));
      }
    }
  }

  const row = acrossSegments + 1;
  for (let along = 0; along < alongSegments; along += 1) {
    for (let across = 0; across < acrossSegments; across += 1) {
      const a = along * row + across;
      const b = a + row;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (alphaWeights.length > 0) {
    setCinematicTerrainAlphaAttribute(geometry, alphaWeights);
    setCinematicTerrainDistanceAttribute(geometry, routeDistances);
  }
  return geometry;
}

function createOffsetCurve(
  world: RouteWorld,
  offset: number,
  lift: number,
  window: WorldWindow,
): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const windowLength = Math.max(1, window.endMeters - window.startMeters);
  const samples = Math.min(world.lowDetail ? 140 : 240, Math.max(48, Math.round(windowLength / 10)));
  for (let index = 0; index <= samples; index += 1) {
    const distanceMeters = THREE.MathUtils.lerp(window.startMeters, window.endMeters, index / samples);
    const frame = getRouteFrame(world.curve, distanceMeters / world.totalDistanceMeters);
    points.push(frame.point.clone().addScaledVector(frame.right, offset).addScaledVector(UP, lift));
  }
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  curve.arcLengthDivisions = samples;
  curve.updateArcLengths();
  return curve;
}

function forEachScenerySample(
  window: WorldWindow,
  seed: number,
  density: number,
  samplesPerCell: number,
  visitor: (distanceMeters: number, random: () => number) => void,
) {
  if (density <= 0) return;
  const cellLength = 200;
  const firstCell = Math.floor(window.startMeters / cellLength);
  const lastCell = Math.floor(window.endMeters / cellLength);
  for (let cell = firstCell; cell <= lastCell; cell += 1) {
    const random = mulberry32(seed ^ Math.imul(cell + 1, 0x45D9F3B));
    const exactCount = density * samplesPerCell;
    const count = Math.floor(exactCount) + (random() < exactCount % 1 ? 1 : 0);
    for (let sample = 0; sample < count; sample += 1) {
      const distanceMeters = (cell + random()) * cellLength;
      if (distanceMeters >= window.startMeters && distanceMeters <= window.endMeters) {
        visitor(distanceMeters, random);
      }
    }
  }
}

function buildDashes(world: RouteWorld, window: WorldWindow): InstanceTransform[] {
  const transforms: InstanceTransform[] = [];
  // Real-road rhythm (~3 m dash / ~9 m gap) reads faster than long sparse dashes.
  const stepMeters = world.lowDetail ? 18 : 12;
  const dashLengthWorld = 0.3;
  const basis = new THREE.Matrix4();
  const firstDash = Math.max(14, Math.ceil(window.startMeters / stepMeters) * stepMeters);
  for (let distance = firstDash; distance < Math.min(window.endMeters, world.totalDistanceMeters - 8); distance += stepMeters) {
    const frame = getRouteFrame(world.curve, distance / world.totalDistanceMeters);
    // Full surface-aligned basis: a minimal-rotation quaternion rolls the dash
    // sideways on grades, which reads as a tilted slab instead of paint.
    const up = frame.tangent.clone().cross(frame.right).normalize();
    const right = up.clone().cross(frame.tangent).normalize();
    basis.makeBasis(right, up, frame.tangent);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
    transforms.push({
      position: frame.point.clone().addScaledVector(up, 0.045),
      quaternion,
      scale: new THREE.Vector3(1, 1, dashLengthWorld),
    });
  }
  return transforms;
}

function buildRoadsidePosts(world: RouteWorld, window: WorldWindow): InstanceTransform[] {
  const transforms: InstanceTransform[] = [];
  const stepMeters = world.lowDetail ? 150 : 100;
  const firstPost = Math.max(45, Math.ceil(window.startMeters / stepMeters) * stepMeters);
  for (let distance = firstPost; distance < Math.min(window.endMeters, world.totalDistanceMeters - 15); distance += stepMeters) {
    const frame = getRouteFrame(world.curve, distance / world.totalDistanceMeters);
    for (const side of [-1, 1]) {
      transforms.push({
        position: frame.point.clone()
          .addScaledVector(frame.right, side * (ROAD_WIDTH * 0.64))
          .addScaledVector(UP, 0.055),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
      });
    }
  }
  return transforms;
}

function buildTrees(world: RouteWorld, theme: ScenicTheme, window: WorldWindow): InstanceTransform[] {
  const profile = getScenicWorldProfile(theme);
  const transforms: InstanceTransform[] = [];
  forEachScenerySample(window, world.seed ^ hashString(`${theme}:trees`), profile.scenery.treeDensity, world.lowDetail ? 9 : 15, (distanceMeters, random) => {
    const u = distanceMeters / world.totalDistanceMeters;
    const frame = getRouteFrame(world.curve, u);
    const side = random() > 0.5 ? 1 : -1;
    const offset = side * (1.5 + Math.pow(random(), 0.65) * 16);
    const height = 0.42 + random() * 0.78;
    const position = frame.point.clone().addScaledVector(frame.right, offset);
    position.y += terrainHeightDelta(distanceMeters, offset, world.seed, theme) + height * 0.5;
    const quaternion = new THREE.Quaternion().setFromAxisAngle(UP, random() * Math.PI * 2);
    transforms.push({
      position,
      quaternion,
      scale: new THREE.Vector3(height * (0.48 + random() * 0.18), height, height * (0.48 + random() * 0.18)),
    });
  });
  return transforms;
}

function buildRocks(world: RouteWorld, theme: ScenicTheme, window: WorldWindow): InstanceTransform[] {
  const profile = getScenicWorldProfile(theme);
  const transforms: InstanceTransform[] = [];
  forEachScenerySample(window, world.seed ^ hashString(`${theme}:rocks`), profile.scenery.rockDensity, world.lowDetail ? 7 : 12, (distanceMeters, random) => {
    const u = distanceMeters / world.totalDistanceMeters;
    const frame = getRouteFrame(world.curve, u);
    const side = random() > 0.5 ? 1 : -1;
    const offset = side * (1.1 + random() * 18);
    const size = 0.12 + random() * 0.38;
    const position = frame.point.clone().addScaledVector(frame.right, offset);
    position.y += terrainHeightDelta(distanceMeters, offset, world.seed, theme) + size * 0.35;
    transforms.push({
      position,
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(random(), random() * Math.PI, random())),
      scale: new THREE.Vector3(size * (0.8 + random()), size * (0.55 + random() * 0.7), size * (0.8 + random())),
    });
  });
  return transforms;
}

function buildMountains(world: RouteWorld, theme: ScenicTheme, window: WorldWindow): InstanceTransform[] {
  const profile = getScenicWorldProfile(theme);
  const transforms: InstanceTransform[] = [];
  forEachScenerySample(window, world.seed ^ hashString(`${theme}:mountains`), profile.scenery.mountainDensity, world.lowDetail ? 1.4 : 2.2, (distanceMeters, random) => {
    const u = distanceMeters / world.totalDistanceMeters;
    const frame = getRouteFrame(world.curve, u);
    const side = random() > 0.5 ? 1 : -1;
    const offset = side * (42 + random() * 50);
    const height = 12 + random() * 24;
    const radius = 7 + random() * 10;
    const position = frame.point.clone().addScaledVector(frame.right, offset);
    position.y += terrainHeightDelta(distanceMeters, Math.sign(offset) * 20, world.seed, theme) + height * 0.32 - 5;
    transforms.push({
      position,
      quaternion: new THREE.Quaternion().setFromAxisAngle(UP, random() * Math.PI),
      scale: new THREE.Vector3(radius, height, radius),
    });
  });
  return transforms;
}

function buildStructures(world: RouteWorld, theme: ScenicTheme, window: WorldWindow): InstanceTransform[] {
  const profile = getScenicWorldProfile(theme);
  const architecture = profile.scenery.architecture;
  const transforms: InstanceTransform[] = [];
  forEachScenerySample(
    window,
    world.seed ^ hashString(`${theme}:structures`),
    profile.scenery.architectureDensity,
    world.lowDetail ? 5 : 9,
    (distanceMeters, random) => {
      const frame = getRouteFrame(world.curve, distanceMeters / world.totalDistanceMeters);
      const side = random() > 0.5 ? 1 : -1;
      const nearOffset = architecture === 'city' ? 2.4 : architecture === 'industrial' ? 3.4 : 5.2;
      const offset = side * (nearOffset + Math.pow(random(), 0.7) * (architecture === 'city' ? 18 : 12));
      let width = 0.55 + random() * 1.3;
      let height = 1.8 + random() * 4.2;
      let depth = 0.55 + random() * 1.5;
      if (architecture === 'city') {
        width = 0.9 + random() * 2.4;
        height = 3.2 + Math.pow(random(), 0.45) * 14;
        depth = 0.9 + random() * 2.8;
      } else if (architecture === 'industrial') {
        width = 0.9 + random() * 2.8;
        height = 1.2 + random() * 5.5;
        depth = 0.8 + random() * 3;
      } else if (architecture === 'coastal') {
        height *= 1.35;
        width *= 0.72;
      } else if (architecture === 'glacial') {
        width *= 0.42;
        depth *= 0.42;
        height *= 1.4;
      }
      const position = frame.point.clone().addScaledVector(frame.right, offset);
      position.y += terrainHeightDelta(distanceMeters, offset, world.seed, theme) + height * 0.5;
      transforms.push({
        position,
        quaternion: new THREE.Quaternion().setFromAxisAngle(UP, random() * Math.PI * 2),
        scale: new THREE.Vector3(width, height, depth),
      });
    },
  );
  return transforms;
}

function buildBiomeBillboards(world: RouteWorld, theme: ScenicTheme, window: WorldWindow): InstanceTransform[] {
  const profile = getScenicWorldProfile(theme);
  const billboard = profile.biomeBillboard;
  if (!billboard) return [];
  const transforms: InstanceTransform[] = [];
  forEachScenerySample(
    window,
    world.seed ^ hashString(`${theme}:biome-billboards`),
    billboard.density,
    world.lowDetail ? 1.2 : 2,
    (distanceMeters, random) => {
      const terrainFocusMeters = window.index * 400 + 200;
      if (Math.abs(distanceMeters - terrainFocusMeters) > 280) return;
      const frame = getRouteFrame(world.curve, distanceMeters / world.totalDistanceMeters);
      const side = random() > 0.5 ? 1 : -1;
      // Detailed cutouts need visible ground beneath them. Keep them inside the
      // feathered terrain band and at real-world prop scale rather than using
      // them as giant distant set pieces.
      const offset = side * (2.45 + Math.pow(random(), 0.72) * 0.95);
      const height = THREE.MathUtils.lerp(billboard.minHeight, billboard.maxHeight, random()) * 0.48;
      const position = frame.point.clone().addScaledVector(frame.right, offset);
      position.y += terrainHeightDelta(distanceMeters, offset, world.seed, theme) + height * 0.5;
      transforms.push({
        position,
        quaternion: new THREE.Quaternion().setFromAxisAngle(UP, random() * Math.PI * 2),
        scale: new THREE.Vector3(height * 1.5, height, 1),
      });
    },
  );
  return transforms;
}

function InstancedObjects({
  transforms,
  geometry,
  color,
  material,
  roughness = 0.9,
  emissive,
  emissiveIntensity = 0,
  flatShading = true,
  map,
  transparent = false,
  opacity = 1,
  depthWrite = true,
}: {
  transforms: InstanceTransform[];
  geometry: React.ReactNode;
  color: string;
  material?: THREE.Material;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  flatShading?: boolean;
  map?: THREE.Texture;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < transforms.length; index += 1) {
      const transform = transforms[index];
      matrix.compose(transform.position, transform.quaternion, transform.scale);
      meshRef.current.setMatrixAt(index, matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.computeBoundingSphere();
  }, [transforms]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, transforms.length]} frustumCulled>
      {geometry}
      {material ? (
        <primitive attach="material" object={material} />
      ) : (
        <meshStandardMaterial
          color={color}
          roughness={roughness}
          emissive={emissive ?? color}
          emissiveIntensity={emissiveIntensity}
          flatShading={flatShading}
          map={map}
          transparent={transparent}
          opacity={opacity}
          depthWrite={depthWrite}
        />
      )}
    </instancedMesh>
  );
}

function WaterMist({ transforms }: { transforms: InstanceTransform[] }) {
  const particleData = useMemo(() => {
    const positions = new Float32Array(transforms.length * 3);
    const sizes = new Float32Array(transforms.length);
    const phases = new Float32Array(transforms.length);
    transforms.forEach((transform, index) => {
      transform.position.toArray(positions, index * 3);
      sizes[index] = Math.max(0.08, transform.scale.y);
      phases[index] = (stableBillboardHash(`${transform.position.x}:${transform.position.z}`) & 1023)
        / 1023 * Math.PI * 2;
    });
    return { positions, sizes, phases };
  }, [transforms]);
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(particleData.positions, 3));
    next.setAttribute('aSize', new THREE.BufferAttribute(particleData.sizes, 1));
    next.setAttribute('aPhase', new THREE.BufferAttribute(particleData.phases, 1));
    next.computeBoundingSphere();
    return next;
  }, [particleData]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  if (transforms.length === 0) return null;
  return (
    <points geometry={geometry} frustumCulled>
      <shaderMaterial
        uniforms={{
          uColor: { value: new THREE.Color('#e9fbff') },
          uOpacity: { value: 0.16 },
        }}
        vertexShader={`
          attribute float aSize;
          attribute float aPhase;
          varying float vMistVariation;
          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            float perspectiveSize = aSize * 220.0 / max(1.0, -viewPosition.z);
            gl_PointSize = clamp(perspectiveSize, 2.0, 42.0);
            gl_Position = projectionMatrix * viewPosition;
            vMistVariation = 0.84 + sin(aPhase) * 0.12;
          }
        `}
        fragmentShader={`
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vMistVariation;
          void main() {
            vec2 centered = (gl_PointCoord - 0.5) * 2.0;
            float radius = length(centered);
            float cloud = 1.0 - smoothstep(0.12, 1.0, radius);
            cloud *= 0.72 + 0.28 * (1.0 - smoothstep(0.0, 0.72, abs(centered.y)));
            if (cloud <= 0.002) discard;
            gl_FragColor = vec4(uColor, cloud * uOpacity * vMistVariation);
          }
        `}
        transparent
        depthWrite={false}
        toneMapped={false}
        forceSinglePass
      />
    </points>
  );
}

function InstancedBillboards({
  transforms,
  source,
  textureOverride,
  contactShadows = true,
  motionEnabled = false,
  motionScale = 1,
  tint = '#ffffff',
  shadowColor = '#07110c',
  shadowAngle = 0,
  facingStrength = 1,
}: {
  transforms: InstanceTransform[];
  source?: string;
  textureOverride?: THREE.Texture;
  contactShadows?: boolean;
  motionEnabled?: boolean;
  motionScale?: number;
  tint?: string;
  shadowColor?: string;
  shadowAngle?: number;
  facingStrength?: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const shadowMeshRef = useRef<THREE.InstancedMesh>(null);
  const texture = useMemo(() => {
    if (textureOverride) return textureOverride;
    if (!source || transforms.length === 0) return null;
    const loaded = new THREE.TextureLoader().load(source, () => invalidate());
    loaded.name = `scenic-biome:${source}`;
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.minFilter = THREE.LinearMipmapLinearFilter;
    loaded.magFilter = THREE.LinearFilter;
    loaded.generateMipmaps = true;
    loaded.anisotropy = 4;
    return loaded;
  }, [invalidate, source, textureOverride, transforms.length]);
  const baseMaterial = useMemo(() => {
    if (!texture) return null;
    return new THREE.MeshBasicMaterial({
      name: `scenic-billboard:${source ?? 'unknown'}`,
      map: texture,
      color: tint,
      // InstancedMesh.instanceColor is detected independently by Three. Setting
      // material.vertexColors here would also request a per-vertex `color`
      // attribute that PlaneGeometry does not carry, multiplying the cutout to
      // black on WebGL implementations whose missing attribute defaults to 0.
      vertexColors: false,
      // These are cutouts, not translucent glass. Alpha test + MSAA coverage
      // preserves fine leaf edges while keeping the cards in the opaque depth
      // pass, avoiding transparent sorting and reducing hidden-pixel overdraw.
      transparent: false,
      alphaTest: 0.12,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: true,
      toneMapped: true,
      forceSinglePass: true,
    });
  }, [source, texture, tint]);
  const gpuMaterial = useMemo(
    () => baseMaterial ? createGpuBillboardMaterial(baseMaterial, {
      windStrength: 0,
      name: `${baseMaterial.name}-gpu`,
    }) : null,
    [baseMaterial],
  );
  useEffect(() => {
    gpuMaterial?.setWindStrength(motionEnabled ? motionScale : 0);
  }, [gpuMaterial, motionEnabled, motionScale]);
  const shadowMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(shadowColor) },
      uOpacity: { value: 0.24 },
    },
    vertexShader: `
      varying vec2 vShadowUv;
      void main() {
        vShadowUv = uv;
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vShadowUv;
      void main() {
        vec2 centered = (vShadowUv - 0.5) * 2.0;
        float radius = length(centered);
        float softAlpha = 1.0 - smoothstep(0.18, 1.0, radius);
        if (softAlpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, softAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    toneMapped: false,
  }), [shadowColor]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !gpuMaterial) return;
    const hadInstanceColor = mesh.instanceColor !== null;
    const authoredEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    configureGpuBillboardInstances(mesh, transforms.map((transform) => {
      authoredEuler.setFromQuaternion(transform.quaternion, 'YXZ');
      return {
        position: transform.position,
        scale: transform.scale,
        mirrorX: transform.scale.x < 0,
        baseYaw: authoredEuler.y,
        facingStrength,
        yawOffset: transform.billboardYawOffset,
        lean: transform.billboardLean,
        windPhase: transform.billboardWindPhase,
        windAmplitude: transform.billboardWindAmplitude,
        windSpeed: transform.billboardWindSpeed,
      };
    }));
    const color = new THREE.Color();
    for (let index = 0; index < transforms.length; index += 1) {
      const transform = transforms[index];
      const hash = stableBillboardHash(`${source}:${transform.position.x.toFixed(3)}:${transform.position.z.toFixed(3)}`);
      const brightness = 0.9 + ((hash & 255) / 255) * 0.18;
      color.setRGB(brightness, brightness * (0.985 + ((hash >>> 8) & 15) / 1000), brightness);
      mesh.setColorAt(index, color);
    }
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.StaticDrawUsage);
      mesh.instanceColor.needsUpdate = true;
      // Instance-color is part of Three's program feature key. The attribute is
      // created here after the mesh material exists, so force one recompile and
      // one demand-frame when a paused ride first receives its cutouts.
      if (!hadInstanceColor) gpuMaterial.material.needsUpdate = true;
    }
    invalidate();
  }, [facingStrength, gpuMaterial, invalidate, source, transforms]);

  useLayoutEffect(() => {
    const mesh = shadowMeshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const groundRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, shadowAngle, 0));
    for (let index = 0; index < transforms.length; index += 1) {
      const transform = transforms[index];
      const position = transform.groundPosition?.clone() ?? transform.position.clone();
      if (!transform.groundPosition) position.y -= transform.scale.y * 0.5;
      position.y += 0.012;
      const footprint = Math.max(0.08, Math.abs(transform.scale.x));
      matrix.compose(
        position,
        groundRotation,
        new THREE.Vector3(footprint * 0.86, footprint * 0.42, 1),
      );
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shadowAngle, transforms]);

  // Face the rider without making the entire forest behave like one copied
  // card. Stable yaw/lean/mirroring and independent wind phases preserve the
  // clean photographic silhouette while breaking synchronized motion.
  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current;
    if (!mesh || !gpuMaterial) return;
    gpuMaterial.updateFrame(camera, mesh, clock.elapsedTime);
  });

  useEffect(() => () => {
    gpuMaterial?.dispose();
    baseMaterial?.dispose();
    if (!textureOverride) texture?.dispose();
  }, [baseMaterial, gpuMaterial, texture, textureOverride]);
  useEffect(() => () => shadowMaterial.dispose(), [shadowMaterial]);

  if (!gpuMaterial || transforms.length === 0) return null;
  return (
    <>
      {contactShadows && (
        <instancedMesh
          ref={shadowMeshRef}
          args={[undefined, undefined, transforms.length]}
          frustumCulled
          renderOrder={0}
        >
          <planeGeometry args={[1, 1]} />
          <primitive attach="material" object={shadowMaterial} />
        </instancedMesh>
      )}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, transforms.length]}
        frustumCulled
        renderOrder={1}
      >
        <planeGeometry args={[1, 1]} />
        <primitive attach="material" object={gpuMaterial.material} />
      </instancedMesh>
    </>
  );
}

function loadScenicCutoutTexture(source: string, onLoad?: () => void): THREE.Texture {
  const loaded = new THREE.TextureLoader().load(source, onLoad);
  loaded.name = `scenic-cutout:${source}`;
  loaded.colorSpace = THREE.SRGBColorSpace;
  loaded.minFilter = THREE.LinearMipmapLinearFilter;
  loaded.magFilter = THREE.LinearFilter;
  loaded.generateMipmaps = true;
  loaded.anisotropy = 4;
  return loaded;
}

function chunkBillboardTransforms(transforms: InstanceTransform[]): InstanceTransform[][] {
  if (transforms.length < 72) return [transforms];
  const cellSize = 42;
  const cells = new Map<string, InstanceTransform[]>();
  for (const transform of transforms) {
    const key = `${Math.floor(transform.position.x / cellSize)}:${Math.floor(transform.position.z / cellSize)}`;
    const cell = cells.get(key);
    if (cell) cell.push(transform);
    else cells.set(key, [transform]);
  }
  return [...cells.values()];
}

function BillboardAssetChunks({
  source,
  transforms,
  contactShadows,
  motionEnabled,
  motionScale,
  tint,
  shadowColor,
  shadowAngle,
  facingStrength,
}: {
  source: string;
  transforms: InstanceTransform[];
  contactShadows: boolean;
  motionEnabled: boolean;
  motionScale: number;
  tint?: string;
  shadowColor?: string;
  shadowAngle?: number;
  facingStrength: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const texture = useMemo(
    () => loadScenicCutoutTexture(source, () => invalidate()),
    [invalidate, source],
  );
  const chunks = useMemo(() => chunkBillboardTransforms(transforms), [transforms]);
  useEffect(() => () => texture.dispose(), [texture]);
  return chunks.map((chunk, index) => (
    <InstancedBillboards
      key={`${source}:${index}`}
      transforms={chunk}
      source={source}
      textureOverride={texture}
      contactShadows={contactShadows}
      motionEnabled={motionEnabled}
      motionScale={motionScale}
      tint={tint}
      shadowColor={shadowColor}
      shadowAngle={shadowAngle}
      facingStrength={facingStrength}
    />
  ));
}

function IndividualAssetBillboards({
  transforms,
  assets,
  lowDetail,
  contactShadows = true,
  variationKind = 'rigid',
  motionEnabled = false,
  motionScale = 1,
  tint,
  shadowColor,
  shadowAngle,
}: {
  transforms: InstanceTransform[];
  assets: readonly ScenicIndividualAsset[];
  lowDetail: boolean;
  contactShadows?: boolean;
  variationKind?: BillboardVariationKind;
  motionEnabled?: boolean;
  motionScale?: number;
  tint?: string;
  shadowColor?: string;
  shadowAngle?: number;
}) {
  const selectionWeights = useMemo(
    () => assets.map((asset) => Math.max(0.001, asset.selectionWeight ?? 1)),
    [assets],
  );
  const totalSelectionWeight = useMemo(
    () => selectionWeights.reduce((sum, weight) => sum + weight, 0),
    [selectionWeights],
  );
  const groups = useMemo(() => assets.map((asset, assetIndex) => ({
    source: lowDetail ? asset.low : asset.standard,
    transforms: transforms.flatMap((transform, transformIndex) => {
      const authoredVariant = 'variant' in transform && typeof transform.variant === 'number'
        ? transform.variant
        : transformIndex;
      const stableId = 'id' in transform && typeof transform.id === 'string'
        ? transform.id
        : `${authoredVariant}:${transform.position.x.toFixed(3)}:${transform.position.z.toFixed(3)}`;
      const hash = stableBillboardHash(stableId);
      let selection = ((hash >>> 0) / 4294967296) * totalSelectionWeight;
      let selectedAssetIndex = assets.length - 1;
      for (let index = 0; index < selectionWeights.length; index += 1) {
        selection -= selectionWeights[index];
        if (selection <= 0) {
          selectedAssetIndex = index;
          break;
        }
      }
      if (selectedAssetIndex !== assetIndex) return [];
      const variation = deriveBillboardVariation(stableId, variationKind);
      const height = Math.max(
        0.04,
        transform.scale.y * (asset.heightScale ?? 1) * variation.heightScale,
      );
      const width = Math.max(0.04, height * asset.aspectRatio * variation.widthScale);
      const position = transform.position.clone();
      if (transform.groundPosition && transform.scale.y > 1e-7) {
        const anchor = (transform.position.y - transform.groundPosition.y) / transform.scale.y;
        position.y = transform.groundPosition.y
          + height * (anchor - Math.max(0, asset.groundSink ?? 0));
      }
      return [{
        ...transform,
        position,
        scale: new THREE.Vector3(variation.mirrorX ? -width : width, height, width),
        billboardYawOffset: variation.yawOffset,
        billboardLean: variation.lean,
        billboardWindPhase: variation.windPhase,
        billboardWindAmplitude: variation.windAmplitude,
        billboardWindSpeed: variation.windSpeed,
      }];
    }),
  })), [assets, lowDetail, selectionWeights, totalSelectionWeight, transforms, variationKind]);

  const facingStrength = variationKind === 'foliage'
    ? 1
    : variationKind === 'water'
      ? 0.85
      : variationKind === 'ground'
        ? 0.28
        : 0.38;
  return groups.filter((group) => group.transforms.length > 0).map((group) => (
    <BillboardAssetChunks
      key={group.source}
      transforms={group.transforms}
      source={group.source}
      contactShadows={contactShadows}
      motionEnabled={motionEnabled}
      motionScale={motionScale}
      tint={tint}
      shadowColor={shadowColor}
      shadowAngle={shadowAngle}
      facingStrength={facingStrength}
    />
  ));
}

interface ScenicMaterialBundles {
  terrain: ProceduralMaterialBundle;
  shoulder: ProceduralMaterialBundle;
  road: ProceduralMaterialBundle;
  rock?: ProceduralMaterialBundle;
  structure?: ProceduralMaterialBundle;
}

function createScenicMaterialBundles(
  world: RouteWorld,
  theme: ScenicTheme,
  useSurfaceDetailMaps: boolean,
): ScenicMaterialBundles {
  const palette = THEMES[theme];
  const profile = getScenicWorldProfile(theme);
  const quality = world.lowDetail || !useSurfaceDetailMaps ? 'low' : 'standard';
  const resolution = world.lowDetail ? 64 : 128;
  const structureKind = profile.scenery.architecture === 'city'
    ? 'city'
    : profile.scenery.architecture === 'industrial'
      ? 'industrial'
      : 'rock';
  const seed = world.seed ^ hashString(`${theme}:materials`);
  const needsPrimitiveScenery = !profile.individualAssets;
  const needsStructures = needsPrimitiveScenery && profile.scenery.architecture !== 'none';
  return {
    terrain: createProceduralMaterialBundle({
      kind: 'terrain', seed: seed ^ 0x17A1, resolution, quality, repeat: [9, 34],
      baseColor: '#d7ddd4', accentColor: '#ffffff', detailColor: '#9ca69b', vertexColors: true,
    }),
    shoulder: createProceduralMaterialBundle({
      kind: 'terrain', seed: seed ^ 0x514D, resolution, quality, repeat: [2, 42],
      baseColor: palette.shoulder, accentColor: palette.rock, detailColor: palette.mountain,
    }),
    road: createProceduralMaterialBundle({
      kind: 'road', seed: seed ^ 0xA5FA, resolution: world.lowDetail ? 64 : 256, quality, repeat: [2.2, 56],
      baseColor: palette.road, accentColor: palette.shoulder, detailColor: '#202326',
    }),
    rock: needsPrimitiveScenery ? createProceduralMaterialBundle({
      kind: 'rock', seed: seed ^ 0xB01D, resolution, quality, repeat: [2.5, 2.5],
      baseColor: palette.rock, accentColor: palette.mountain, detailColor: '#2b3031', flatShading: true,
    }) : undefined,
    structure: needsStructures ? createProceduralMaterialBundle({
      kind: structureKind, seed: seed ^ 0x57C7, resolution, quality, repeat: [3, 5],
      baseColor: profile.scenery.structureColor,
      accentColor: palette.rock,
      detailColor: '#17191c',
      flatShading: true,
      emissiveColor: profile.scenery.structureAccent,
      emissiveIntensity: profile.scenery.architecture === 'city' ? 0.1 : 0.025,
    }) : undefined,
  };
}

function ProceduralTerrain({
  world,
  theme,
  distanceMeters,
  reducedMotion,
  renderPlan,
}: {
  world: RouteWorld;
  theme: ScenicTheme;
  distanceMeters: number;
  reducedMotion: boolean;
  renderPlan: ScenicRenderPlan;
}) {
  const palette = THEMES[theme];
  const profile = getScenicWorldProfile(theme);
  const cinematicBackdrop = hasCinematicBackdrop(theme);
  const lighting = THEME_LIGHTING[theme];
  const roadEdgeColor = palette.roadEdge;
  const windowIndex = Math.floor(Math.max(0, distanceMeters) / 400);
  const window = useMemo(() => getWorldWindow(world, windowIndex), [world, windowIndex]);
  const sceneryWindow = useMemo(
    () => getSceneryWindow(world, windowIndex, cinematicBackdrop),
    [cinematicBackdrop, windowIndex, world],
  );
  const activeStreamCacheKey = streamedWindowCacheKey(world, theme, sceneryWindow);
  const terrainPrewarmCacheRef = useRef(new Map<string, THREE.BufferGeometry>());
  const nearWorldPrewarmCacheRef = useRef(
    new Map<string, ReturnType<typeof generateNearWorld>>(),
  );
  const waterPrewarmCacheRef = useRef(
    new Map<string, ReturnType<typeof createStreamedWaterFeatures>>(),
  );
  const startU = window.startMeters / world.totalDistanceMeters;
  const endU = window.endMeters / world.totalDistanceMeters;
  const windowLength = Math.max(1, window.endMeters - window.startMeters);
  const roadSegments = Math.min(world.lowDetail ? 180 : 320, Math.max(64, Math.round(windowLength / 8)));
  const terrainGeometry = useMemo(() => {
    const cached = terrainPrewarmCacheRef.current.get(activeStreamCacheKey);
    if (cached) {
      terrainPrewarmCacheRef.current.delete(activeStreamCacheKey);
      return cached;
    }
    return createTerrainGeometry(world, theme, sceneryWindow);
  }, [activeStreamCacheKey, sceneryWindow, theme, world]);
  const shoulderGeometry = useMemo(
    () => createRibbonGeometry(
      world.curve,
      world.totalDistanceMeters,
      roadSegments,
      profile.terrain.shoulderWidth,
      -0.015,
      startU,
      endU,
    ),
    [endU, profile.terrain.shoulderWidth, roadSegments, startU, world.curve, world.totalDistanceMeters],
  );
  const roadGeometry = useMemo(
    () => createRibbonGeometry(
      world.curve,
      world.totalDistanceMeters,
      roadSegments,
      ROAD_WIDTH,
      0.018,
      startU,
      endU,
    ),
    [endU, roadSegments, startU, world.curve, world.totalDistanceMeters],
  );
  const leftEdgeCurve = useMemo(
    () => cinematicBackdrop
      ? null
      : createOffsetCurve(world, -ROAD_WIDTH * 0.43, 0.048, window),
    [cinematicBackdrop, window, world],
  );
  const rightEdgeCurve = useMemo(
    () => cinematicBackdrop
      ? null
      : createOffsetCurve(world, ROAD_WIDTH * 0.43, 0.048, window),
    [cinematicBackdrop, window, world],
  );
  const leftEdgeGeometry = useMemo(
    () => leftEdgeCurve
      ? new THREE.TubeGeometry(leftEdgeCurve, roadSegments, 0.007, 4, false)
      : null,
    [leftEdgeCurve, roadSegments],
  );
  const rightEdgeGeometry = useMemo(
    () => rightEdgeCurve
      ? new THREE.TubeGeometry(rightEdgeCurve, roadSegments, 0.007, 4, false)
      : null,
    [rightEdgeCurve, roadSegments],
  );
  const dashes = useMemo(() => buildDashes(world, window), [window, world]);
  const roadsidePosts = useMemo(() => buildRoadsidePosts(world, window), [window, world]);
  const roadsideReflectors = useMemo(() => roadsidePosts.map((post) => ({
    ...post,
    position: post.position.clone().addScaledVector(UP, 0.028),
  })), [roadsidePosts]);
  const primitiveForeground = !profile.individualAssets && (!cinematicBackdrop || theme === 'daybreak');
  const trees = useMemo(
    () => primitiveForeground ? buildTrees(world, theme, sceneryWindow) : [],
    [primitiveForeground, sceneryWindow, world, theme],
  );
  const rocks = useMemo(
    () => primitiveForeground ? buildRocks(world, theme, sceneryWindow) : [],
    [primitiveForeground, sceneryWindow, world, theme],
  );
  const mountains = useMemo(
    () => cinematicBackdrop ? [] : buildMountains(world, theme, sceneryWindow),
    [cinematicBackdrop, sceneryWindow, world, theme],
  );
  const structures = useMemo(
    () => cinematicBackdrop ? [] : buildStructures(world, theme, sceneryWindow),
    [cinematicBackdrop, sceneryWindow, world, theme],
  );
  const generatedNearWorld = useMemo(() => {
    if (!cinematicBackdrop || !profile.individualAssets) return null;
    const cached = nearWorldPrewarmCacheRef.current.get(activeStreamCacheKey);
    if (cached) {
      nearWorldPrewarmCacheRef.current.delete(activeStreamCacheKey);
      return cached;
    }
    return createNearWorldForWindow(world, theme, sceneryWindow);
  }, [activeStreamCacheKey, cinematicBackdrop, profile.individualAssets, sceneryWindow, theme, world]);

  // Prepare the next 400 m stream boundary only when the browser is idle. The
  // active window remains bounded, but the two most expensive deterministic
  // products are ready before the rider crosses the boundary.
  useEffect(() => {
    const nextIndex = windowIndex + 1;
    if (nextIndex * 400 - 300 >= world.totalDistanceMeters) return;
    const nextSceneryWindow = getSceneryWindow(world, nextIndex, cinematicBackdrop);
    const nextKey = streamedWindowCacheKey(world, theme, nextSceneryWindow);
    const prewarmTasks: Array<() => void> = [];

    if (!terrainPrewarmCacheRef.current.has(nextKey)) {
      prewarmTasks.push(() => {
        const geometry = createTerrainGeometry(world, theme, nextSceneryWindow);
        for (const stale of terrainPrewarmCacheRef.current.values()) stale.dispose();
        terrainPrewarmCacheRef.current.clear();
        terrainPrewarmCacheRef.current.set(nextKey, geometry);
      });
    }
    if (cinematicBackdrop && profile.individualAssets && !nearWorldPrewarmCacheRef.current.has(nextKey)) {
      prewarmTasks.push(() => {
        const prepared = createNearWorldForWindow(world, theme, nextSceneryWindow);
        nearWorldPrewarmCacheRef.current.clear();
        if (prepared) nearWorldPrewarmCacheRef.current.set(nextKey, prepared);
      });
    }
    if (profile.waterway.kind !== 'none' && !waterPrewarmCacheRef.current.has(nextKey)) {
      prewarmTasks.push(() => {
        const prepared = createWaterForWindow(world, theme, nextSceneryWindow);
        for (const stale of waterPrewarmCacheRef.current.values()) disposeStreamedWater(stale);
        waterPrewarmCacheRef.current.clear();
        if (prepared) waterPrewarmCacheRef.current.set(nextKey, prepared);
      });
    }
    return scheduleScenicIdleSequence(prewarmTasks);
  }, [cinematicBackdrop, profile.individualAssets, profile.waterway.kind, theme, windowIndex, world]);

  useEffect(() => () => {
    for (const geometry of terrainPrewarmCacheRef.current.values()) geometry.dispose();
    terrainPrewarmCacheRef.current.clear();
    nearWorldPrewarmCacheRef.current.clear();
    for (const streamedWater of waterPrewarmCacheRef.current.values()) {
      disposeStreamedWater(streamedWater);
    }
    waterPrewarmCacheRef.current.clear();
  }, []);
  const nearWorldGroups = useMemo(
    () => groupNearWorldInstances((generatedNearWorld?.instances ?? []).filter((instance) => {
      if (renderPlan.propDensity >= 0.999) return true;
      return (stableBillboardHash(instance.id) >>> 0) / 4294967296 <= renderPlan.propDensity;
    })),
    [generatedNearWorld, renderPlan.propDensity],
  );
  const biomeBillboards = useMemo(
    () => profile.individualAssets ? [] : buildBiomeBillboards(world, theme, sceneryWindow),
    [profile.individualAssets, sceneryWindow, world, theme],
  );
  const streamedWater = useMemo(() => {
    if (profile.waterway.kind === 'none') return null;
    const cached = waterPrewarmCacheRef.current.get(activeStreamCacheKey);
    if (cached) {
      waterPrewarmCacheRef.current.delete(activeStreamCacheKey);
      return cached;
    }
    return createWaterForWindow(world, theme, sceneryWindow);
  }, [activeStreamCacheKey, profile.waterway.kind, sceneryWindow, theme, world]);
  const nearStreamBankRocks = useMemo(
    () => nearWorldGroups.streamBank.filter((instance) => instance.variant % 2 === 0),
    [nearWorldGroups.streamBank],
  );
  const nearStreamBankCover = useMemo(
    () => nearWorldGroups.streamBank.filter((instance) => instance.variant % 2 !== 0),
    [nearWorldGroups.streamBank],
  );
  const individualStructureDressing = useMemo<InstanceTransform[]>(
    () => nearWorldGroups.structure.map((instance) => {
      const height = THREE.MathUtils.clamp(instance.scale.y * 0.42, 0.34, 1.85);
      const position = instance.groundPosition.clone().addScaledVector(UP, height * 0.5);
      return {
        ...instance,
        position,
        scale: new THREE.Vector3(height * 0.78, height, height * 0.78),
      };
    }),
    [nearWorldGroups.structure],
  );
  const individualRockTransforms = useMemo<InstanceTransform[]>(
    () => [
      ...nearWorldGroups.rock,
      ...individualStructureDressing,
      ...nearStreamBankRocks,
      ...(streamedWater?.rocks ?? []),
    ],
    [individualStructureDressing, nearStreamBankRocks, nearWorldGroups.rock, streamedWater?.rocks],
  );
  const individualGroundCoverTransforms = useMemo<NearWorldInstance[]>(
    () => [...nearWorldGroups.groundCover, ...nearStreamBankCover],
    [nearStreamBankCover, nearWorldGroups.groundCover],
  );
  const individualWaterfallTransforms = useMemo<InstanceTransform[]>(
    () => streamedWater?.waterfalls.map((waterfall) => ({
      id: waterfall.id,
      variant: waterfall.cellIndex,
      groundPosition: waterfall.base.clone(),
      position: waterfall.top.clone().add(waterfall.base).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(
        Math.max(0.16, waterfall.width),
        Math.max(0.22, waterfall.top.distanceTo(waterfall.base)),
        Math.max(0.16, waterfall.width),
      ),
    })) ?? [],
    [streamedWater],
  );
  const structureAccents = useMemo(() => structures.map((structure) => ({
    position: structure.position.clone().addScaledVector(UP, structure.scale.y * 0.43),
    quaternion: structure.quaternion,
    scale: new THREE.Vector3(structure.scale.x * 1.035, Math.max(0.035, structure.scale.y * 0.055), structure.scale.z * 1.035),
  })), [structures]);
  const materialBundles = useMemo(
    () => createScenicMaterialBundles(world, theme, renderPlan.useSurfaceDetailMaps),
    [renderPlan.useSurfaceDetailMaps, world, theme],
  );
  const cinematicTerrainMaterial = useMemo(
    () => cinematicBackdrop
      ? createCinematicTerrainMaterial(materialBundles.terrain.material, {
        alphaTest: 0.015,
        depthWrite: false,
        focusDistanceMeters: distanceMeters,
        distanceFadeMeters: [330, 760],
        name: `${theme}-cinematic-terrain`,
      })
      : null,
    [cinematicBackdrop, materialBundles.terrain.material, theme],
  );
  useEffect(() => () => {
    for (const bundle of Object.values(materialBundles)) bundle?.dispose();
  }, [materialBundles]);
  useEffect(() => () => cinematicTerrainMaterial?.dispose(), [cinematicTerrainMaterial]);
  useEffect(() => {
    cinematicTerrainMaterial?.setFocusDistance(distanceMeters);
  }, [cinematicTerrainMaterial, distanceMeters]);
  useEffect(() => () => terrainGeometry.dispose(), [terrainGeometry]);
  useEffect(() => () => shoulderGeometry.dispose(), [shoulderGeometry]);
  useEffect(() => () => roadGeometry.dispose(), [roadGeometry]);
  useEffect(() => () => leftEdgeGeometry?.dispose(), [leftEdgeGeometry]);
  useEffect(() => () => rightEdgeGeometry?.dispose(), [rightEdgeGeometry]);
  useEffect(() => () => disposeStreamedWater(streamedWater), [streamedWater]);

  const billboardSource = world.lowDetail
    ? profile.biomeBillboard?.low
    : profile.biomeBillboard?.standard;
  return (
    <>
      <mesh geometry={terrainGeometry} receiveShadow>
        <primitive
          attach="material"
          object={cinematicTerrainMaterial?.material ?? materialBundles.terrain.material}
        />
      </mesh>

      <mesh geometry={shoulderGeometry} receiveShadow>
        <primitive attach="material" object={materialBundles.shoulder.material} />
      </mesh>
      <mesh geometry={roadGeometry} receiveShadow>
        <primitive attach="material" object={materialBundles.road.material} />
      </mesh>

      {streamedWater && (
        <>
          <mesh geometry={streamedWater.streamGeometry} renderOrder={1}>
            <ScenicWaterMaterial
              color={profile.waterway.color}
              kind={profile.waterway.kind}
              opacity={profile.waterway.opacity}
              seed={world.seed}
              reducedMotion={reducedMotion || renderPlan.motionScale <= 0}
            />
          </mesh>
          {!profile.individualAssets?.waterfall && (
            <mesh geometry={streamedWater.waterfallGeometry} renderOrder={2}>
              <ScenicWaterMaterial
                color={profile.waterway.color}
                kind={profile.waterway.kind}
                opacity={profile.waterway.opacity}
                seed={world.seed}
                reducedMotion={reducedMotion || renderPlan.motionScale <= 0}
                waterfall
              />
            </mesh>
          )}
          {streamedWater.mist.length > 0 && (
            <WaterMist transforms={streamedWater.mist} />
          )}
        </>
      )}

      {!cinematicBackdrop && leftEdgeGeometry && rightEdgeGeometry && (
        <>
          <mesh geometry={leftEdgeGeometry}>
            <meshStandardMaterial
              color={roadEdgeColor}
              emissive={roadEdgeColor}
              emissiveIntensity={theme === 'moonride' ? 4.5 : 0.15}
              toneMapped={theme === 'daybreak'}
            />
          </mesh>
          <mesh geometry={rightEdgeGeometry}>
            <meshStandardMaterial
              color={roadEdgeColor}
              emissive={roadEdgeColor}
              emissiveIntensity={theme === 'moonride' ? 4.5 : 0.15}
              toneMapped={theme === 'daybreak'}
            />
          </mesh>
        </>
      )}

      <InstancedObjects
        transforms={dashes}
        geometry={<boxGeometry args={[0.018, 0.004, 1]} />}
        color={theme === 'daybreak' ? '#e9eeee' : cinematicBackdrop ? '#d7e3e3' : '#a7b4d4'}
        emissiveIntensity={theme === 'moonride' ? 0.5 : cinematicBackdrop ? 0.03 : 0}
      />
      <InstancedObjects
        transforms={roadsidePosts}
        geometry={<boxGeometry args={[0.016, 0.1, 0.016]} />}
        color="#dce1df"
        roughness={0.68}
        emissive="#8b9494"
        emissiveIntensity={theme === 'moonride' ? 0.5 : 0.04}
      />
      <InstancedObjects
        transforms={roadsideReflectors}
        geometry={<boxGeometry args={[0.021, 0.017, 0.019]} />}
        color={theme === 'daybreak' ? '#f7fafc' : profile.scenery.structureAccent}
        roughness={0.28}
        emissive={theme === 'daybreak' ? '#f7fafc' : profile.scenery.structureAccent}
        emissiveIntensity={theme === 'moonride' ? 4 : cinematicBackdrop ? 1.4 : 0.45}
      />

      {trees.length > 0 && (
        <InstancedObjects
          transforms={trees}
          geometry={theme === 'coastalhighway'
            ? <sphereGeometry args={[0.62, 7, 5]} />
            : <coneGeometry args={[0.52, 1.35, theme === 'daybreak' ? 7 : 5]} />}
          color={palette.tree}
          roughness={1}
        />
      )}
      {(trees.length > 0 || rocks.length > 0) && (
        <>
          {trees.length > 0 && (
            <InstancedObjects
              transforms={trees.map((tree) => ({
                ...tree,
                position: tree.position.clone().addScaledVector(UP, -tree.scale.y * 0.38),
                scale: new THREE.Vector3(tree.scale.x * 0.18, tree.scale.y * 0.38, tree.scale.z * 0.18),
              }))}
              geometry={<cylinderGeometry args={[0.16, 0.21, 1, 5]} />}
              color={palette.trunk}
              roughness={1}
            />
          )}
          <InstancedObjects
            transforms={rocks}
            geometry={<dodecahedronGeometry args={[1, 0]} />}
            color={palette.rock}
            material={materialBundles.rock?.material}
          />
        </>
      )}
      {mountains.length > 0 && (
        <InstancedObjects
          transforms={mountains}
          geometry={<coneGeometry args={[1, 1, 6]} />}
          color={palette.mountain}
          material={materialBundles.rock?.material}
        />
      )}
      {theme === 'daybreak' && (
        <InstancedObjects
          transforms={mountains.map((mountain) => ({
            position: mountain.position.clone().addScaledVector(UP, mountain.scale.y * 0.36),
            quaternion: mountain.quaternion,
            scale: new THREE.Vector3(
              mountain.scale.x * 0.28,
              mountain.scale.y * 0.28,
              mountain.scale.z * 0.28,
            ),
          }))}
          geometry={<coneGeometry args={[1, 1, 6]} />}
          color={palette.mountainCap}
          roughness={0.9}
        />
      )}
      {structures.length > 0 && (
        <>
          <InstancedObjects
            transforms={structures}
            geometry={profile.scenery.architecture === 'glacial'
              ? <octahedronGeometry args={[0.72, 0]} />
              : profile.scenery.architecture === 'industrial'
                ? <cylinderGeometry args={[0.7, 0.92, 1, 8]} />
                : <boxGeometry args={[1, 1, 1]} />}
            color={profile.scenery.structureColor}
            material={materialBundles.structure?.material}
          />
          <InstancedObjects
            transforms={structureAccents}
            geometry={<boxGeometry args={[1, 1, 1]} />}
            color={profile.scenery.structureAccent}
            roughness={0.38}
            emissive={profile.scenery.structureAccent}
            emissiveIntensity={profile.scenery.architecture === 'city' ? 2.4 : 1.3}
          />
        </>
      )}
      {profile.individualAssets && (
        <>
          <IndividualAssetBillboards
            transforms={nearWorldGroups.tree}
            assets={profile.individualAssets.tree}
            lowDetail={world.lowDetail}
            variationKind={theme === 'snowbound' || theme === 'powerhouse'
              ? 'rigid'
              : 'foliage'}
            motionEnabled={!reducedMotion && theme !== 'snowbound' && theme !== 'powerhouse'}
            motionScale={renderPlan.motionScale}
            tint={lighting.billboardTint}
            shadowColor={lighting.shadowColor}
            shadowAngle={lighting.shadowAngle}
          />
          <IndividualAssetBillboards
            transforms={individualRockTransforms}
            assets={profile.individualAssets.rock}
            lowDetail={world.lowDetail}
            variationKind="rigid"
            tint={lighting.billboardTint}
            shadowColor={lighting.shadowColor}
            shadowAngle={lighting.shadowAngle}
          />
          <IndividualAssetBillboards
            transforms={individualGroundCoverTransforms}
            assets={profile.individualAssets.groundCover}
            lowDetail={world.lowDetail}
            variationKind="ground"
            tint={lighting.billboardTint}
            shadowColor={lighting.shadowColor}
            shadowAngle={lighting.shadowAngle}
          />
          {profile.individualAssets.waterfall && individualWaterfallTransforms.length > 0 && (
            <IndividualAssetBillboards
              transforms={individualWaterfallTransforms}
              assets={profile.individualAssets.waterfall}
              lowDetail={world.lowDetail}
              contactShadows={false}
              variationKind="water"
              tint={lighting.billboardTint}
              shadowColor={lighting.shadowColor}
              shadowAngle={lighting.shadowAngle}
            />
          )}
        </>
      )}
      {biomeBillboards.length > 0 && billboardSource && (
        <InstancedBillboards
          transforms={biomeBillboards}
          source={billboardSource}
          tint={lighting.billboardTint}
          shadowColor={lighting.shadowColor}
          shadowAngle={lighting.shadowAngle}
          facingStrength={0.9}
        />
      )}
    </>
  );
}

function Sky({ theme, seed }: { theme: ScenicTheme; seed: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const palette = THEMES[theme];

  const starsGeometry = useMemo(() => {
    const random = mulberry32(seed ^ 0x57A45);
    const positions: number[] = [];
    for (let index = 0; index < 620; index += 1) {
      const radius = 260 + random() * 130;
      const azimuth = random() * Math.PI * 2;
      const elevation = 0.08 + random() * 1.25;
      positions.push(
        Math.cos(azimuth) * Math.cos(elevation) * radius,
        Math.sin(elevation) * radius,
        Math.sin(azimuth) * Math.cos(elevation) * radius,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, [seed]);

  useFrame(({ camera }) => {
    if (groupRef.current) {
      groupRef.current.position.copy(camera.position);
    }
  });

  return (
    <group ref={groupRef}>
      {theme === 'moonride' && (
        <points geometry={starsGeometry}>
          <pointsMaterial color="#dbeafe" size={0.28} sizeAttenuation transparent opacity={0.9} fog={false} />
        </points>
      )}
      {!hasCinematicBackdrop(theme) && (
        <>
          <mesh
            position={theme === 'daybreak' ? [-105, 52, -230] : [105, 82, -240]}
            scale={theme === 'daybreak' ? [23, 23, 1] : [42, 42, 1]}
          >
            <circleGeometry args={[1, 48]} />
            <meshBasicMaterial color={palette.celestialGlow} transparent opacity={0.14} depthWrite={false} fog={false} />
          </mesh>
          <mesh
            position={theme === 'daybreak' ? [-105, 52, -229] : [105, 82, -239]}
            scale={theme === 'daybreak' ? [11, 11, 1] : [28, 28, 1]}
          >
            <circleGeometry args={[1, 64]} />
            <meshBasicMaterial color={palette.celestial} depthWrite={false} fog={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

function PanoramaBackground({
  theme,
  world,
  renderPlan,
}: {
  theme: ScenicTheme;
  world: RouteWorld;
  renderPlan: ScenicRenderPlan;
}) {
  const palette = THEMES[theme];
  const panorama = getScenicWorldProfile(theme).panorama;
  const yawRadians = useMemo(() => {
    const tangent = world.curve.getTangentAt(0).normalize();
    return panoramaYawForTangent(tangent)
      + THREE.MathUtils.degToRad(panorama?.yawDegrees ?? 0);
  }, [panorama?.yawDegrees, world.curve]);
  const source = renderPlan.maximumPanoramaFaceSize <= 512 ? panorama?.low : panorama?.standard;
  return (
    <EquirectangularBackground
      source={source}
      fallbackSource={renderPlan.maximumPanoramaFaceSize <= 512 ? undefined : panorama?.low}
      fallback={{
        top: palette.skyTop,
        horizon: palette.skyHorizon,
        bottom: palette.skyBottom,
      }}
      yawRadians={yawRadians}
      intensity={panorama?.intensity ?? 1}
      maxCubeFaceSize={renderPlan.maximumPanoramaFaceSize}
    />
  );
}

function SceneBackground({
  theme,
  world,
  renderPlan,
}: {
  theme: ScenicTheme;
  world: RouteWorld;
  renderPlan: ScenicRenderPlan;
}) {
  const referenceArt = getScenicWorldProfile(theme).referenceArt;
  // Authored perspective plates are rendered as a cover-cropped DOM layer below
  // the transparent WebGL canvas. This preserves their native composition and
  // avoids stretching a 16:9 painting into an equirectangular environment map.
  if (referenceArt) return null;
  return <PanoramaBackground theme={theme} world={world} renderPlan={renderPlan} />;
}

function getMatteMotion(world: RouteWorld, distanceMeters: number) {
  const curvature = sampleCurvaturePresentation(world.curve, distanceMeters, {
    routeLengthMeters: world.totalDistanceMeters,
    sampleSpanMeters: 150,
    straightThresholdDegrees: 1.5,
    fullTurnDegrees: 15,
  });
  return {
    // A right turn exposes a little more of the plate's right side while the
    // route itself supplies the true nearby parallax. Keep this motion subtle.
    positionX: 50 + (curvature.right - curvature.left) * 3.2,
    positionY: THREE.MathUtils.clamp(
      world.curve.getTangentAt(THREE.MathUtils.clamp(distanceMeters / world.totalDistanceMeters, 0, 1)).y * 7,
      -1.25,
      1.25,
    ),
    turnStrength: curvature.turnStrength,
  };
}

function ScenicMatteLayer({
  source,
  world,
  distanceMeters,
  reducedMotion,
}: {
  source: string;
  world: RouteWorld;
  distanceMeters: number;
  reducedMotion: boolean;
}) {
  const sampledMotion = getMatteMotion(world, distanceMeters);
  const motion = reducedMotion
    ? { positionX: 50, positionY: 0, turnStrength: 0 }
    : sampledMotion;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        inset: '-7%',
        overflow: 'hidden',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(rgba(6, 12, 16, 0.025), rgba(6, 12, 16, 0.09)), url('${source}')`,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover',
          transform: `translate3d(${(motion.positionX - 50) * -0.62}%, ${motion.positionY}%, 0) scale(${1.08 + motion.turnStrength * 0.008})`,
          transition: reducedMotion
            ? 'none'
            : 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
          willChange: 'transform',
        }}
      />
    </div>
  );
}

type AtmosphereMode = 'snow' | 'rain' | 'dust' | 'mist';

function atmosphereModeForTheme(theme: ScenicTheme): AtmosphereMode | null {
  if (theme === 'avalanche' || theme === 'sidewinder' || theme === 'snowbound') return 'snow';
  if (theme === 'nmpdhq' || theme === 'coastalhighway') return 'rain';
  if (theme === 'powerhouse') return 'dust';
  if (theme === 'deathisland' || theme === 'forgeworld') return 'mist';
  return null;
}

function AtmosphericParticles({
  world,
  theme,
  reducedMotion,
  densityScale,
  motionScale,
}: {
  world: RouteWorld;
  theme: ScenicTheme;
  reducedMotion: boolean;
  densityScale: number;
  motionScale: number;
}) {
  const mode = atmosphereModeForTheme(theme);
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const cameraDirection = useRef(new THREE.Vector3());
  const yawQuaternion = useRef(new THREE.Quaternion());
  const count = mode === null ? 0 : Math.round((world.lowDetail ? 0.45 : densityScale) * (
    mode === 'rain' ? 190 : mode === 'snow' ? 145 : mode === 'dust' ? 80 : 48
  ));
  const particleData = useMemo(() => {
    const values = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const random = mulberry32(world.seed ^ hashString(`${theme}:atmosphere`));
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = (random() - 0.5) * 17;
      values[index * 3 + 1] = (random() - 0.2) * 9;
      values[index * 3 + 2] = -1.5 - random() * 24;
      phases[index] = random() * Math.PI * 2;
    }
    return { positions: values, phases };
  }, [count, theme, world.seed]);

  useFrame(({ camera, clock }) => {
    const group = groupRef.current;
    const material = materialRef.current;
    if (!group || !material || !mode) return;
    group.position.copy(camera.position);
    camera.getWorldDirection(cameraDirection.current);
    const yaw = Math.atan2(cameraDirection.current.x, cameraDirection.current.z);
    yawQuaternion.current.setFromAxisAngle(UP, yaw);
    group.quaternion.copy(yawQuaternion.current);
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uMotionScale.value = motionScale;
  });

  if (!mode || count === 0 || reducedMotion || motionScale <= 0) return null;
  const palette = THEMES[theme];
  const color = mode === 'snow' ? '#f4f8ff' : mode === 'rain' ? '#d7e7ee' : mode === 'dust' ? '#d9a67c' : palette.fog;
  const size = mode === 'snow' ? 5.5 : mode === 'rain' ? 8 : mode === 'dust' ? 4.5 : 7;
  const opacity = mode === 'snow' ? 0.32 : mode === 'rain' ? 0.2 : mode === 'dust' ? 0.16 : 0.08;
  const modeCode = mode === 'rain' ? 1 : mode === 'snow' ? 2 : mode === 'dust' ? 3 : 4;
  const fallSpeed = mode === 'rain' ? 5.4 : mode === 'snow' ? 0.34 : mode === 'dust' ? -0.035 : 0.025;
  const drift = mode === 'rain' ? 0.22 : mode === 'snow' ? 0.13 : mode === 'dust' ? 0.075 : 0.035;
  return (
    <group ref={groupRef} frustumCulled={false}>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particleData.positions, 3]} />
          <bufferAttribute attach="attributes-aPhase" args={[particleData.phases, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={materialRef}
          uniforms={{
            uTime: { value: 0 },
            uMotionScale: { value: motionScale },
            uFallSpeed: { value: fallSpeed },
            uDrift: { value: drift },
            uPointSize: { value: size },
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: opacity },
            uMode: { value: modeCode },
          }}
          vertexShader={`
            attribute float aPhase;
            uniform float uTime;
            uniform float uMotionScale;
            uniform float uFallSpeed;
            uniform float uDrift;
            uniform float uPointSize;
            varying float vPhase;
            void main() {
              vec3 animated = position;
              float cycle = 10.5;
              animated.y = -2.2 + mod(position.y + 2.2 - uTime * uFallSpeed * uMotionScale + cycle * 8.0, cycle);
              animated.x += sin(uTime * uDrift * uMotionScale + aPhase) * 0.34;
              vec4 viewPosition = modelViewMatrix * vec4(animated, 1.0);
              gl_Position = projectionMatrix * viewPosition;
              gl_PointSize = clamp(uPointSize * (5.0 / max(1.0, -viewPosition.z)), 1.0, uPointSize);
              vPhase = aPhase;
            }
          `}
          fragmentShader={`
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform int uMode;
            varying float vPhase;
            void main() {
              vec2 point = gl_PointCoord - 0.5;
              float alpha;
              if (uMode == 1) {
                float streak = 1.0 - smoothstep(0.055, 0.16, abs(point.x));
                float taper = 1.0 - smoothstep(0.22, 0.5, abs(point.y));
                alpha = streak * taper;
              } else {
                float radius = length(point);
                alpha = 1.0 - smoothstep(uMode == 4 ? 0.08 : 0.2, 0.5, radius);
                if (uMode == 2) alpha *= 0.84 + sin(vPhase * 3.0) * 0.16;
              }
              if (alpha <= 0.01) discard;
              gl_FragColor = vec4(uColor, alpha * uOpacity);
            }
          `}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

function ValleyFloor({
  world,
  distanceMeters,
  theme,
}: {
  world: RouteWorld;
  distanceMeters: number;
  theme: ScenicTheme;
}) {
  const floorRef = useRef<THREE.Mesh>(null);
  const routePoint = useRef(new THREE.Vector3());
  const floor = getScenicWorldProfile(theme).floor;
  useFrame(({ camera }) => {
    if (!floorRef.current) return;
    const u = THREE.MathUtils.clamp(distanceMeters / world.totalDistanceMeters, 0, 1);
    world.curve.getPointAt(u, routePoint.current);
    floorRef.current.position.set(camera.position.x, routePoint.current.y - floor.depth, camera.position.z);
  });

  return (
    <mesh ref={floorRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2}>
      <circleGeometry args={[330, world.lowDetail ? 32 : 64]} />
      <meshStandardMaterial
        color={floor.color}
        roughness={floor.roughness}
        metalness={floor.metalness}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function RideCamera({
  world,
  distanceMeters,
  speedKph,
  cadenceRpm,
  isPaused,
  reducedMotion,
}: {
  world: RouteWorld;
  distanceMeters: number;
  speedKph: number;
  cadenceRpm: number;
  isPaused: boolean;
  reducedMotion: boolean;
}) {
  const { camera } = useThree();
  const displayedU = useRef(THREE.MathUtils.clamp(distanceMeters / world.totalDistanceMeters, 0, 1));
  const smoothLook = useRef(new THREE.Vector3());
  const currentPoint = useRef(new THREE.Vector3());
  const currentTangent = useRef(new THREE.Vector3());
  const aheadPoint = useRef(new THREE.Vector3());
  const targetPosition = useRef(new THREE.Vector3());
  const targetLook = useRef(new THREE.Vector3());
  const initialized = useRef(false);

  useFrame((state, delta) => {
    const targetU = THREE.MathUtils.clamp(distanceMeters / world.totalDistanceMeters, 0, 1);
    displayedU.current = THREE.MathUtils.damp(displayedU.current, targetU, isPaused ? 2.2 : 5.8, delta);
    world.curve.getPointAt(displayedU.current, currentPoint.current);
    world.curve.getTangentAt(displayedU.current, currentTangent.current).normalize();
    const lookAheadMeters = THREE.MathUtils.clamp(22 + speedKph * 0.75, 22, 52);
    const aheadU = Math.min(1, displayedU.current + lookAheadMeters / world.totalDistanceMeters);
    world.curve.getPointAt(aheadU, aheadPoint.current);
    const cadenceHz = Math.max(0, cadenceRpm) / 60;
    // Keep cadence motion extremely subtle. The previous 6 mm oscillation was
    // visually prominent at riding cadence and uncomfortable over long sessions.
    const bob = isPaused || reducedMotion
      ? 0
      : Math.sin(state.clock.elapsedTime * Math.PI * 2 * cadenceHz) * 0.0015;
    targetPosition.current.copy(currentPoint.current)
      .addScaledVector(UP, 0.19 + bob)
      .addScaledVector(currentTangent.current, -0.035);
    targetLook.current.copy(aheadPoint.current).addScaledVector(UP, 0.15);

    if (!initialized.current) {
      camera.position.copy(targetPosition.current);
      smoothLook.current.copy(targetLook.current);
      initialized.current = true;
    } else {
      const positionAlpha = 1 - Math.exp(-delta * 8.5);
      camera.position.lerp(targetPosition.current, positionAlpha);
      smoothLook.current.lerp(targetLook.current, 1 - Math.exp(-delta * 6.5));
    }

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const targetFov = reducedMotion ? 64 : 61 + Math.min(7, speedKph * 0.16);
    const nextFov = THREE.MathUtils.damp(perspectiveCamera.fov, targetFov, 4, delta);
    if (Math.abs(nextFov - perspectiveCamera.fov) > 0.002) {
      perspectiveCamera.fov = nextFov;
      perspectiveCamera.updateProjectionMatrix();
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(smoothLook.current);
  });

  return null;
}

// Original lightweight geometry: one translucent rider, no downloaded character assets.
function GhostRider({ world, distanceMeters, riderDistanceMeters }: { world: RouteWorld; distanceMeters: number; riderDistanceMeters: number }) {
  const frame = getRouteFrame(world.curve, THREE.MathUtils.clamp(distanceMeters / world.totalDistanceMeters, 0, 1));
  const position = frame.point.clone().addScaledVector(frame.right, 0.14);
  // Fade beside the camera so an overtake cannot fill the rider's view.
  const opacity = 0.55 * Math.min(1, Math.abs(distanceMeters - riderDistanceMeters) / 6);
  const material = <meshBasicMaterial color="#c4a0ff" transparent opacity={opacity} depthWrite={false} />;
  return <group position={position} rotation={[0, Math.atan2(frame.tangent.x, frame.tangent.z), 0]} name="race-yourself-ghost">
    {[-0.065, 0.065].map(z => <mesh key={z} position={[0, 0.04, z]} rotation={[0, Math.PI / 2, 0]}>
      <torusGeometry args={[0.035, 0.006, 6, 16]} />{material}
    </mesh>)}
    <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.009, 0.009, 0.13, 6]} />{material}</mesh>
    <mesh position={[0, 0.12, 0]} rotation={[0.35, 0, 0]}><capsuleGeometry args={[0.023, 0.055, 4, 8]} />{material}</mesh>
    <mesh position={[0, 0.18, 0.025]}><sphereGeometry args={[0.022, 10, 8]} />{material}</mesh>
    <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.12, 0.14, 24]} />{material}</mesh>
  </group>;
}

function Scene({
  world,
  ghostDistanceMeters,
  theme,
  distanceMeters,
  speedKph,
  cadenceRpm,
  isPaused,
  reducedMotion,
  renderPlan,
}: {
  world: RouteWorld;
  ghostDistanceMeters?: number;
  theme: ScenicTheme;
  distanceMeters: number;
  speedKph: number;
  cadenceRpm: number;
  isPaused: boolean;
  reducedMotion: boolean;
  renderPlan: ScenicRenderPlan;
}) {
  const palette = THEMES[theme];
  const cinematicBackdrop = hasCinematicBackdrop(theme);
  const profile = getScenicWorldProfile(theme);
  const lighting = THEME_LIGHTING[theme];
  return (
    <>
      <SceneBackground theme={theme} world={world} renderPlan={renderPlan} />
      <ScenicEnvironmentLighting
        source={profile.panorama?.low}
        enabled={renderPlan.useEnvironmentMap && Boolean(profile.panorama)}
        intensity={lighting.environmentIntensity}
        yawDegrees={profile.panorama?.yawDegrees}
      />
      <fogExp2
        attach="fog"
        args={[palette.fog, cinematicBackdrop ? palette.fogDensity * 0.24 : palette.fogDensity]}
      />
      <Sky theme={theme} seed={world.seed} />
      <hemisphereLight args={[
        palette.ambient,
        lighting.groundColor,
        lighting.hemisphereIntensity,
      ]} />
      <directionalLight
        color={palette.sun}
        intensity={lighting.sunIntensity}
        position={lighting.sunPosition}
      />
      {!cinematicBackdrop && (
        <ValleyFloor world={world} distanceMeters={distanceMeters} theme={theme} />
      )}
      <ProceduralTerrain
        world={world}
        theme={theme}
        distanceMeters={distanceMeters}
        reducedMotion={reducedMotion}
        renderPlan={renderPlan}
      />
      <AtmosphericParticles
        world={world}
        theme={theme}
        reducedMotion={reducedMotion}
        densityScale={renderPlan.particleDensity}
        motionScale={renderPlan.motionScale}
      />
      {ghostDistanceMeters !== undefined && <GhostRider world={world} distanceMeters={ghostDistanceMeters} riderDistanceMeters={distanceMeters} />}
      <RideCamera
        world={world}
        distanceMeters={distanceMeters}
        speedKph={speedKph}
        cadenceRpm={cadenceRpm}
        isPaused={isPaused}
        reducedMotion={reducedMotion}
      />
    </>
  );
}

function RendererSettings({ exposure }: { exposure: number }) {
  const { gl } = useThree();

  useEffect(() => {
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
  }, [exposure, gl]);

  return null;
}

export const ScenicRide: React.FC<ScenicRideProps> = ({
  route,
  ghostDistanceMeters,
  distanceMeters,
  speedKph,
  cadenceRpm,
  isPaused,
  theme,
  qualityMode,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportSize = useScenicViewportSize(viewportRef);
  const devicePixelRatio = useDevicePixelRatio();
  const reducedMotion = usePrefersReducedMotion();
  const qualityEnvironment = useMemo<ScenicQualityEnvironment>(() => ({
    cssWidth: viewportSize.width,
    cssHeight: viewportSize.height,
    devicePixelRatio,
    hardwareConcurrency: typeof navigator === 'undefined' ? 8 : navigator.hardwareConcurrency,
    deviceMemoryGb: typeof navigator === 'undefined'
      ? 8
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    prefersReducedMotion: reducedMotion,
    qualityMode,
  }), [devicePixelRatio, qualityMode, reducedMotion, viewportSize.height, viewportSize.width]);
  const environmentRef = useRef(qualityEnvironment);
  environmentRef.current = qualityEnvironment;
  const [qualityState, setQualityState] = useState(() => (
    createAdaptiveScenicQualityState(qualityEnvironment)
  ));
  const [rendererMetrics, setRendererMetrics] = useState<ScenicRendererMetrics | null>(null);

  useEffect(() => {
    setQualityState((current) => setAdaptiveScenicQualityMode(
      current,
      qualityMode,
      environmentRef.current,
    ));
  }, [qualityMode]);

  const renderPlan = useMemo(
    () => deriveScenicRenderPlan(qualityState, qualityEnvironment),
    [qualityEnvironment, qualityState],
  );
  const world = useMemo(
    () => buildRouteWorld(route, renderPlan.legacyLowDetail),
    [renderPlan.legacyLowDetail, route],
  );
  const handlePerformanceObservation = useCallback((
    observation: ScenicPerformanceWindow,
    metrics: ScenicRendererMetrics,
  ) => {
    setRendererMetrics(metrics);
    if (qualityMode === 'auto') {
      setQualityState((current) => updateAdaptiveScenicQuality(current, observation).state);
    }
  }, [qualityMode]);
  const palette = THEMES[theme];
  const referenceArt = getScenicWorldProfile(theme).referenceArt;
  const showPerformanceOverlay = useMemo(() => (
    typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('scenicPerf')
  ), []);
  return (
    <div
      ref={viewportRef}
      className="scenic-viewport relative h-full w-full overflow-hidden rounded-3xl border border-cardBorder bg-slate-950 shadow-2xl"
      data-scenic-quality-level={renderPlan.level}
      data-scenic-quality-tier={renderPlan.featureTier}
      style={{
        background: theme === 'daybreak'
          ? `linear-gradient(to bottom, ${palette.skyTop} 0%, #52778d 42%, ${palette.skyHorizon} 69%, ${palette.skyBottom} 100%)`
          : `linear-gradient(to bottom, ${palette.skyTop} 0%, ${palette.skyHorizon} 68%, ${palette.skyBottom} 100%)`,
      }}
    >
      {referenceArt && (
        <ScenicMatteLayer
          source={referenceArt}
          world={world}
          distanceMeters={distanceMeters}
          reducedMotion={reducedMotion}
        />
      )}
      <Canvas
        className="relative z-[1]"
        frameloop={isPaused ? 'demand' : 'always'}
        camera={{ fov: 64, near: 0.04, far: 450 }}
        dpr={renderPlan.targetDpr}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <RendererSettings exposure={palette.exposure} />
        <ScenicPerformanceProbe
          enabled={!isPaused && (qualityMode === 'auto' || showPerformanceOverlay)}
          onObservation={handlePerformanceObservation}
        />
        <Scene
          ghostDistanceMeters={ghostDistanceMeters}
          world={world}
          theme={theme}
          distanceMeters={distanceMeters}
          speedKph={speedKph}
          cadenceRpm={cadenceRpm}
          isPaused={isPaused}
          reducedMotion={reducedMotion}
          renderPlan={renderPlan}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 z-[2] scenic-vignette" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-32 bg-gradient-to-t from-slate-950/60 to-transparent" />
      {showPerformanceOverlay && rendererMetrics && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-[3] rounded-lg border border-cyan-300/20 bg-slate-950/82 px-2.5 py-2 font-mono text-[9px] leading-4 text-cyan-100 shadow-xl backdrop-blur-md">
          <div>Q{renderPlan.level} {renderPlan.featureTier} · DPR {renderPlan.targetDpr.toFixed(2)}</div>
          <div>{renderPlan.internalWidth}×{renderPlan.internalHeight} · {rendererMetrics.calls} calls</div>
          <div>p95 {rendererMetrics.frameTimeP95Ms.toFixed(1)} ms · {(rendererMetrics.slowFrameRatio * 100).toFixed(0)}% slow</div>
          <div>{rendererMetrics.triangles.toLocaleString()} tri · {rendererMetrics.textures} tex · {rendererMetrics.geometries} geo</div>
        </div>
      )}
    </div>
  );
};

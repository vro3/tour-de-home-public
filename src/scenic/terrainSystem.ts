import * as THREE from 'three';
import type { ScenicTheme } from '../types/scenic';
import type { ScenicWaterway } from './worldProfiles';

export type ScenicTerrainArchetype =
  | 'alpine'
  | 'lunar'
  | 'coastalShelf'
  | 'glacialTrench'
  | 'frozenBasin'
  | 'snowPlain'
  | 'fjordMeadow'
  | 'aridCanyon'
  | 'urbanDeck'
  | 'waterfrontDeck';

export interface ScenicTerrainRecipe {
  archetype: ScenicTerrainArchetype;
  leftRise: number;
  rightRise: number;
  lateralExponent: number;
  rollingAmplitude: number;
  rollingScaleMeters: number;
  terraceStep: number;
  terraceBlend: number;
  crossfall: number;
  roughness: number;
  vegetation: number;
  wetColor: string;
  accentColor: string;
  channelDepth: number;
  channelBankWidth: number;
  waterLateralDistance: number;
  waterMeanderPrimary: number;
  waterMeanderSecondary: number;
}

export interface ScenicTerrainSample {
  height: number;
  ridge: number;
  wetness: number;
  vegetation: number;
  variation: number;
  waterCenterOffset: number | null;
  waterDistance: number | null;
}

export interface SampleScenicTerrainOptions {
  distanceMeters: number;
  lateralOffsetWorld: number;
  seed: number;
  theme: ScenicTheme;
  waterwayKind?: ScenicWaterway;
  waterWidth?: number;
}

const RECIPES = {
  daybreak: {
    archetype: 'alpine', leftRise: 0.72, rightRise: 0.92, lateralExponent: 1.42,
    rollingAmplitude: 0.32, rollingScaleMeters: 145, terraceStep: 0.2, terraceBlend: 0.14,
    crossfall: 0.012, roughness: 0.34, vegetation: 0.9, wetColor: '#203f38', accentColor: '#8b826a',
    channelDepth: 0.13, channelBankWidth: 0.32, waterLateralDistance: 1.76,
    waterMeanderPrimary: 0.5, waterMeanderSecondary: 0.18,
  },
  moonride: {
    archetype: 'lunar', leftRise: 0.68, rightRise: 0.76, lateralExponent: 1.2,
    rollingAmplitude: 0.38, rollingScaleMeters: 105, terraceStep: 0.26, terraceBlend: 0.32,
    crossfall: 0.004, roughness: 0.72, vegetation: 0.08, wetColor: '#11132b', accentColor: '#625d92',
    channelDepth: 0, channelBankWidth: 0.25, waterLateralDistance: 1.8,
    waterMeanderPrimary: 0, waterMeanderSecondary: 0,
  },
  deathisland: {
    archetype: 'coastalShelf', leftRise: 0.28, rightRise: 1.26, lateralExponent: 1.65,
    rollingAmplitude: 0.29, rollingScaleMeters: 170, terraceStep: 0.22, terraceBlend: 0.42,
    crossfall: 0.018, roughness: 0.48, vegetation: 0.94, wetColor: '#183f3b', accentColor: '#786b52',
    channelDepth: 0.17, channelBankWidth: 0.42, waterLateralDistance: 1.72,
    waterMeanderPrimary: 0.56, waterMeanderSecondary: 0.2,
  },
  avalanche: {
    archetype: 'glacialTrench', leftRise: 1.46, rightRise: 1.55, lateralExponent: 1.72,
    rollingAmplitude: 0.21, rollingScaleMeters: 225, terraceStep: 0.3, terraceBlend: 0.2,
    crossfall: -0.003, roughness: 0.27, vegetation: 0.28, wetColor: '#7997aa', accentColor: '#c9e4eb',
    channelDepth: 0.1, channelBankWidth: 0.5, waterLateralDistance: 1.98,
    waterMeanderPrimary: 0.32, waterMeanderSecondary: 0.12,
  },
  sidewinder: {
    archetype: 'frozenBasin', leftRise: 0.82, rightRise: 0.68, lateralExponent: 1.34,
    rollingAmplitude: 0.24, rollingScaleMeters: 190, terraceStep: 0.24, terraceBlend: 0.18,
    crossfall: -0.008, roughness: 0.38, vegetation: 0.22, wetColor: '#334f65', accentColor: '#879cac',
    channelDepth: 0.08, channelBankWidth: 0.46, waterLateralDistance: 2.08,
    waterMeanderPrimary: 0.28, waterMeanderSecondary: 0.1,
  },
  snowbound: {
    archetype: 'snowPlain', leftRise: 0.24, rightRise: 0.28, lateralExponent: 1.18,
    rollingAmplitude: 0.14, rollingScaleMeters: 260, terraceStep: 0.16, terraceBlend: 0.1,
    crossfall: 0.002, roughness: 0.18, vegetation: 0.08, wetColor: '#8baac4', accentColor: '#ccc6e9',
    channelDepth: 0.06, channelBankWidth: 0.55, waterLateralDistance: 2.18,
    waterMeanderPrimary: 0.24, waterMeanderSecondary: 0.08,
  },
  forgeworld: {
    archetype: 'fjordMeadow', leftRise: 0.34, rightRise: 1.38, lateralExponent: 1.58,
    rollingAmplitude: 0.31, rollingScaleMeters: 155, terraceStep: 0.2, terraceBlend: 0.36,
    crossfall: 0.021, roughness: 0.42, vegetation: 1, wetColor: '#214739', accentColor: '#8d8865',
    channelDepth: 0.2, channelBankWidth: 0.46, waterLateralDistance: 1.82,
    waterMeanderPrimary: 0.48, waterMeanderSecondary: 0.18,
  },
  powerhouse: {
    archetype: 'aridCanyon', leftRise: 1.42, rightRise: 1.05, lateralExponent: 1.5,
    rollingAmplitude: 0.27, rollingScaleMeters: 130, terraceStep: 0.25, terraceBlend: 0.72,
    crossfall: -0.016, roughness: 0.68, vegetation: 0.16, wetColor: '#493024', accentColor: '#b06e43',
    channelDepth: 0.16, channelBankWidth: 0.34, waterLateralDistance: 1.62,
    waterMeanderPrimary: 0.34, waterMeanderSecondary: 0.16,
  },
  nmpdhq: {
    archetype: 'urbanDeck', leftRise: 0.07, rightRise: 0.08, lateralExponent: 1,
    rollingAmplitude: 0.018, rollingScaleMeters: 520, terraceStep: 0.08, terraceBlend: 0.76,
    crossfall: 0.006, roughness: 0.06, vegetation: 0.12, wetColor: '#20252b', accentColor: '#626b72',
    channelDepth: 0.055, channelBankWidth: 0.18, waterLateralDistance: 1.52,
    waterMeanderPrimary: 0.05, waterMeanderSecondary: 0.02,
  },
  coastalhighway: {
    archetype: 'waterfrontDeck', leftRise: 0.16, rightRise: 0.72, lateralExponent: 1.25,
    rollingAmplitude: 0.07, rollingScaleMeters: 380, terraceStep: 0.12, terraceBlend: 0.58,
    crossfall: 0.014, roughness: 0.12, vegetation: 0.35, wetColor: '#493a35', accentColor: '#a07859',
    channelDepth: 0.075, channelBankWidth: 0.24, waterLateralDistance: 1.7,
    waterMeanderPrimary: 0.1, waterMeanderSecondary: 0.04,
  },
} as const satisfies Record<ScenicTheme, ScenicTerrainRecipe>;

export const SCENIC_TERRAIN_RECIPES: Readonly<Record<ScenicTheme, ScenicTerrainRecipe>> = RECIPES;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seedPhase(seed: number, theme: ScenicTheme, salt: string): number {
  return (hashString(`${seed >>> 0}:${theme}:${salt}`) % 65536) / 997;
}

function smoothPulse(distance: number, scale: number, phase: number): number {
  return (
    Math.sin(distance / scale + phase) * 0.58
    + Math.sin(distance / (scale * 0.43) + phase * 1.73) * 0.27
    + Math.sin(distance / (scale * 2.4) - phase * 0.61) * 0.15
  );
}

/**
 * Returns the exact water center used by both the carved ground and water mesh.
 * Scene units are used because the route/world renderer uses one unit per 10 m.
 */
export function scenicWaterCenterOffset(
  theme: ScenicTheme,
  seed: number,
  distanceMeters: number,
  waterwayKind: ScenicWaterway,
): number | null {
  if (waterwayKind === 'none') return null;
  const recipe = RECIPES[theme];
  const namespace = `${theme}:${seed >>> 0}`;
  const featureSeed = ((seed >>> 0) ^ hashString(namespace)) >>> 0;
  const side = (featureSeed & 1) === 0 ? 1 : -1;
  const phase = seedPhase(seed, theme, 'water');
  const meander = (
    Math.sin(distanceMeters * 0.0091 + phase) * recipe.waterMeanderPrimary
    + Math.sin(distanceMeters * 0.023 + phase * 0.71) * recipe.waterMeanderSecondary
  );
  return side * Math.max(1.38, recipe.waterLateralDistance + meander);
}

/**
 * Continuous absolute-coordinate terrain. No chunk/window value participates in
 * the calculation, so neighbouring streamed meshes and grounded props agree.
 */
export function sampleScenicTerrain(options: SampleScenicTerrainOptions): ScenicTerrainSample {
  const { theme } = options;
  const recipe = RECIPES[theme];
  const distanceMeters = Number.isFinite(options.distanceMeters) ? options.distanceMeters : 0;
  const lateralOffsetWorld = Number.isFinite(options.lateralOffsetWorld) ? options.lateralOffsetWorld : 0;
  const absoluteOffset = Math.abs(lateralOffsetWorld);
  const sideRise = lateralOffsetWorld < 0 ? recipe.leftRise : recipe.rightRise;
  const corridor = THREE.MathUtils.smoothstep(absoluteOffset, 0.62, 1.45);
  const normalizedLateral = THREE.MathUtils.clamp((absoluteOffset - 0.55) / 5.65, 0, 1);
  const phase = seedPhase(options.seed, theme, 'terrain');
  const longitudinal = smoothPulse(distanceMeters, recipe.rollingScaleMeters, phase);
  const lateralDetail = (
    Math.sin(distanceMeters * 0.015 + lateralOffsetWorld * 1.31 + phase * 0.77) * 0.62
    + Math.cos(distanceMeters * 0.0063 - lateralOffsetWorld * 2.17 + phase) * 0.38
  );
  const formation = Math.pow(normalizedLateral, recipe.lateralExponent) * sideRise;
  const rolling = recipe.rollingAmplitude
    * (0.22 + normalizedLateral * 0.78)
    * (longitudinal * 0.72 + lateralDetail * recipe.roughness * 0.28);
  const rawShelf = formation + rolling + lateralOffsetWorld * recipe.crossfall;
  const step = Math.max(0.04, recipe.terraceStep);
  const terracedShelf = Math.round(rawShelf / step) * step;
  let height = -0.024 + corridor * THREE.MathUtils.lerp(
    rawShelf,
    terracedShelf,
    recipe.terraceBlend * THREE.MathUtils.smoothstep(normalizedLateral, 0.16, 0.86),
  );

  const waterwayKind = options.waterwayKind ?? 'none';
  const waterCenterOffset = scenicWaterCenterOffset(theme, options.seed, distanceMeters, waterwayKind);
  let wetness = 0;
  let waterDistance: number | null = null;
  if (waterCenterOffset !== null) {
    waterDistance = Math.abs(lateralOffsetWorld - waterCenterOffset);
    const halfWidth = Math.max(0.08, (options.waterWidth ?? 0.35) * 0.55);
    const channel = 1 - THREE.MathUtils.smoothstep(
      waterDistance,
      halfWidth,
      halfWidth + recipe.channelBankWidth,
    );
    const damp = 1 - THREE.MathUtils.smoothstep(
      waterDistance,
      halfWidth + recipe.channelBankWidth * 0.5,
      halfWidth + recipe.channelBankWidth * 2.4,
    );
    const bankRimCenter = halfWidth + recipe.channelBankWidth * 0.86;
    const bankRim = Math.exp(-Math.pow((waterDistance - bankRimCenter) / Math.max(0.08, recipe.channelBankWidth * 0.45), 2));
    height -= recipe.channelDepth * channel;
    height += bankRim * recipe.channelDepth * 0.16 * corridor;
    wetness = THREE.MathUtils.clamp(channel * 0.78 + damp * 0.42, 0, 1);
  }

  const variation = THREE.MathUtils.clamp(0.5 + longitudinal * 0.27 + lateralDetail * 0.16, 0, 1);
  const ridge = THREE.MathUtils.clamp(normalizedLateral * 0.76 + Math.max(0, height) * 0.16, 0, 1);
  const vegetation = THREE.MathUtils.clamp(
    recipe.vegetation * (0.5 + variation * 0.62) * (1 - ridge * 0.28) * (1 - wetness * 0.3),
    0,
    1,
  );
  return { height, ridge, wetness, vegetation, variation, waterCenterOffset, waterDistance };
}

export function scenicTerrainHeight(options: SampleScenicTerrainOptions): number {
  return sampleScenicTerrain(options).height;
}

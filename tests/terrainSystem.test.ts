import { describe, expect, it } from 'vitest';
import type { ScenicTheme } from '../src/types/scenic';
import {
  SCENIC_TERRAIN_RECIPES,
  sampleScenicTerrain,
  scenicTerrainHeight,
  scenicWaterCenterOffset,
} from '../src/scenic/terrainSystem';
import { getScenicWorldProfile } from '../src/scenic/worldProfiles';

const THEMES = Object.keys(SCENIC_TERRAIN_RECIPES) as ScenicTheme[];

function sample(theme: ScenicTheme, distanceMeters: number, lateralOffsetWorld: number) {
  const profile = getScenicWorldProfile(theme);
  return sampleScenicTerrain({
    theme,
    seed: 0x4f83a11,
    distanceMeters,
    lateralOffsetWorld,
    waterwayKind: profile.waterway.kind,
    waterWidth: profile.waterway.width,
  });
}

describe('scenic terrain system', () => {
  it('has a finite, exhaustive and visibly distinct recipe for every theme', () => {
    expect(THEMES).toHaveLength(10);
    for (const theme of THEMES) {
      const recipe = SCENIC_TERRAIN_RECIPES[theme];
      const numeric = Object.values(recipe).filter((value): value is number => typeof value === 'number');
      expect(numeric.every(Number.isFinite)).toBe(true);
      expect(sample(theme, 812.5, -5.6).height).toSatisfy(Number.isFinite);
      expect(sample(theme, 812.5, 5.6).height).toSatisfy(Number.isFinite);
    }
    expect(new Set(THEMES.map((theme) => SCENIC_TERRAIN_RECIPES[theme].archetype)).size).toBe(10);
  });

  it('keeps the protected road corridor consistently flat', () => {
    for (const theme of THEMES) {
      const left = sample(theme, 930, -0.35).height;
      const center = sample(theme, 930, 0).height;
      const right = sample(theme, 930, 0.35).height;
      expect(Math.abs(left - center)).toBeLessThan(0.012);
      expect(Math.abs(right - center)).toBeLessThan(0.012);
    }
  });

  it('creates glacial walls, an open snow plain, a fjord shelf and engineered city deck', () => {
    const avalancheEdge = (sample('avalanche', 700, -5.8).height + sample('avalanche', 700, 5.8).height) / 2;
    const snowEdge = (sample('snowbound', 700, -5.8).height + sample('snowbound', 700, 5.8).height) / 2;
    const forgeLeft = sample('forgeworld', 700, -5.8).height;
    const forgeRight = sample('forgeworld', 700, 5.8).height;
    const citySpread = Math.abs(sample('nmpdhq', 700, -5.8).height - sample('nmpdhq', 700, 5.8).height);

    expect(avalancheEdge).toBeGreaterThan(snowEdge + 0.65);
    expect(Math.abs(forgeRight - forgeLeft)).toBeGreaterThan(0.55);
    expect(citySpread).toBeLessThan(0.15);
  });

  it('carves the exact water center used by the streamed water ribbon', () => {
    for (const theme of THEMES.filter((candidate) => getScenicWorldProfile(candidate).waterway.kind !== 'none')) {
      const profile = getScenicWorldProfile(theme);
      const distanceMeters = 1_125;
      const center = scenicWaterCenterOffset(theme, 0x4f83a11, distanceMeters, profile.waterway.kind);
      expect(center).not.toBeNull();
      const channel = sample(theme, distanceMeters, center!).height;
      const uncarved = sampleScenicTerrain({
        theme,
        seed: 0x4f83a11,
        distanceMeters,
        lateralOffsetWorld: center!,
        waterwayKind: 'none',
        waterWidth: profile.waterway.width,
      }).height;
      const wet = sample(theme, distanceMeters, center!);
      expect(channel).toBeLessThan(uncarved - SCENIC_TERRAIN_RECIPES[theme].channelDepth * 0.75);
      expect(wet.wetness).toBeGreaterThan(0.7);
      expect(wet.waterDistance).toBeCloseTo(0, 10);
    }
  });

  it('is an absolute-coordinate sampler with no window seam inputs', () => {
    const options = {
      theme: 'forgeworld' as const,
      seed: 9934,
      distanceMeters: 1_200,
      lateralOffsetWorld: 3.15,
      waterwayKind: 'stream' as const,
      waterWidth: 0.4,
    };
    expect(scenicTerrainHeight(options)).toBe(sampleScenicTerrain(options).height);
    expect(sampleScenicTerrain(options)).toEqual(sampleScenicTerrain({ ...options }));
  });
});

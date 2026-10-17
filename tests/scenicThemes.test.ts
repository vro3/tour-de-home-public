import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isScenicTheme, SCENIC_THEME_OPTIONS } from '../src/types/scenic';
import { SCENIC_WORLD_PROFILES } from '../src/scenic/worldProfiles';

describe('scenic theme registry', () => {
  it('defines ten unique selectable worlds', () => {
    const ids = SCENIC_THEME_OPTIONS.map((theme) => theme.id);

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('recognizes every registered theme and rejects stale values', () => {
    for (const theme of SCENIC_THEME_OPTIONS) {
      expect(isScenicTheme(theme.id)).toBe(true);
    }

    expect(isScenicTheme('unknown-world')).toBe(false);
    expect(isScenicTheme(undefined)).toBe(false);
  });

  it('includes all eight original cinematic worlds', () => {
    const cinematicWorlds = SCENIC_THEME_OPTIONS.filter(
      (theme) => theme.group === 'Cinematic worlds',
    );

    expect(cinematicWorlds.map((theme) => theme.label)).toEqual([
      'Verdant Tide',
      'Glacier Vault',
      'Frozen Night',
      'Cobalt Expanse',
      'Alpine Fjord',
      'Copper Ravine',
      'Violet Metropolis',
      'Sunset Promenade',
    ]);
  });

  it('provides a complete procedural world recipe for every selectable world', () => {
    expect(Object.keys(SCENIC_WORLD_PROFILES).sort()).toEqual(
      SCENIC_THEME_OPTIONS.map((theme) => theme.id).sort(),
    );

    for (const theme of SCENIC_THEME_OPTIONS) {
      const profile = SCENIC_WORLD_PROFILES[theme.id];
      expect(profile.terrain.shoulderWidth).toBeGreaterThan(0.7);
      expect(profile.terrain.formationStrength).toBeGreaterThanOrEqual(0);
      expect(profile.scenery.treeDensity).toBeGreaterThanOrEqual(0);
      expect(profile.scenery.rockDensity).toBeGreaterThanOrEqual(0);
      expect(profile.scenery.mountainDensity).toBeGreaterThanOrEqual(0);
      expect(profile.scenery.architectureDensity).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every cinematic world paired with generated skies, biome assets, and 3D dressing', () => {
    const cinematicWorlds = SCENIC_THEME_OPTIONS.filter((theme) => theme.group === 'Cinematic worlds');

    for (const theme of cinematicWorlds) {
      const profile = SCENIC_WORLD_PROFILES[theme.id];
      expect(profile.panorama?.standard).toMatch(/^\/scenic\/skies\/.+\.webp$/);
      expect(profile.panorama?.low).toMatch(/^\/scenic\/skies\/.+-low\.webp$/);
      expect(profile.biomeBillboard?.standard).toMatch(/^\/scenic\/props\/.+\.webp$/);
      expect(profile.biomeBillboard?.low).toMatch(/^\/scenic\/props\/.+-low\.webp$/);
      for (const source of [
        profile.panorama!.standard,
        profile.panorama!.low,
        profile.biomeBillboard!.standard,
        profile.biomeBillboard!.low,
      ]) {
        const assetPath = join(process.cwd(), 'public', source.slice(1));
        expect(existsSync(assetPath)).toBe(true);
        expect(statSync(assetPath).size).toBeGreaterThan(0);
      }
      expect(
        profile.scenery.rockDensity
        + profile.scenery.treeDensity
        + profile.scenery.mountainDensity
        + profile.scenery.architectureDensity,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps every individualized near-world asset available with valid proportions', () => {
    for (const profile of Object.values(SCENIC_WORLD_PROFILES)) {
      if (!profile.individualAssets) continue;
      for (const family of Object.values(profile.individualAssets)) {
        expect(family.length).toBeGreaterThan(0);
        for (const asset of family) {
          expect(asset.aspectRatio).toBeGreaterThan(0.1);
          expect(asset.aspectRatio).toBeLessThan(4);
          expect(asset.selectionWeight ?? 1).toBeGreaterThan(0);
          expect(asset.heightScale ?? 1).toBeGreaterThan(0);
          expect(asset.groundSink ?? 0).toBeGreaterThanOrEqual(0);
          expect(asset.groundSink ?? 0).toBeLessThan(0.5);
          for (const source of [asset.standard, asset.low]) {
            const assetPath = join(process.cwd(), 'public', source.slice(1));
            expect(existsSync(assetPath)).toBe(true);
            expect(statSync(assetPath).size).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

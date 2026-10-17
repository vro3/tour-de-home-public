import { describe, expect, it } from 'vitest';
import {
  deriveBillboardVariation,
  stableBillboardHash,
} from '../src/scenic/billboardVariation';

describe('billboard visual variation', () => {
  it('is deterministic for a streamed instance ID', () => {
    const id = 'forgeworld:8ad21:tree:17:4';
    expect(deriveBillboardVariation(id, 'foliage')).toEqual(
      deriveBillboardVariation(id, 'foliage'),
    );
    expect(stableBillboardHash(id)).toBe(stableBillboardHash(id));
  });

  it('produces mirrored and unmirrored trees with independent silhouettes and wind', () => {
    const variations = Array.from({ length: 96 }, (_, index) => (
      deriveBillboardVariation(`forge-tree:${index}`, 'foliage')
    ));
    expect(variations.some((variation) => variation.mirrorX)).toBe(true);
    expect(variations.some((variation) => !variation.mirrorX)).toBe(true);
    expect(new Set(variations.map((variation) => variation.windPhase.toFixed(3))).size).toBeGreaterThan(80);
    expect(new Set(variations.map((variation) => variation.widthScale.toFixed(3))).size).toBeGreaterThan(70);
    expect(Math.max(...variations.map((variation) => variation.lean))
      - Math.min(...variations.map((variation) => variation.lean))).toBeGreaterThan(0.05);
  });

  it('keeps rocks static and waterfalls unmirrored', () => {
    const rock = deriveBillboardVariation('rock:4', 'rigid');
    const water = deriveBillboardVariation('waterfall:9', 'water');
    expect(rock.windAmplitude).toBe(0);
    expect(water.windAmplitude).toBe(0);
    expect(water.mirrorX).toBe(false);
  });
});

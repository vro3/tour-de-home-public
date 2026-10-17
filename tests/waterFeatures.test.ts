import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createStreamedWaterFeatures,
  WATER_FEATURE_BUDGETS,
  WATER_FEATURE_CONFIGS,
  type StreamedWaterFeatures,
  type WaterFeatureTransform,
  type WaterfallSheet,
} from '../src/scenic/waterFeatures';

function makeRoute(): THREE.CatmullRomCurve3 {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.4, -35),
    new THREE.Vector3(12, 0.7, -70),
    new THREE.Vector3(32, 0.2, -105),
    new THREE.Vector3(25, 1.1, -150),
  ], false, 'centripetal', 0.35);
  curve.arcLengthDivisions = 800;
  curve.updateArcLengths();
  return curve;
}

const absoluteTerrain = (distanceMeters: number, lateralOffset: number) => (
  distanceMeters * 0.0002 + Math.abs(lateralOffset) * 0.24
);

function disposeFeatures(features: StreamedWaterFeatures) {
  features.streamGeometry.dispose();
  features.waterfallGeometry.dispose();
}

function expectFiniteAttribute(geometry: THREE.BufferGeometry, name: string) {
  const attribute = geometry.getAttribute(name);
  expect(attribute).toBeDefined();
  for (let index = 0; index < attribute.array.length; index += 1) {
    expect(Number.isFinite(attribute.array[index])).toBe(true);
  }
}

function transformRecord(transform: WaterFeatureTransform) {
  return {
    cellIndex: transform.cellIndex,
    distanceMeters: transform.distanceMeters,
    lateralOffset: transform.lateralOffset,
    terrainY: transform.terrainY,
    position: transform.position.toArray(),
    quaternion: transform.quaternion.toArray(),
    scale: transform.scale.toArray(),
  };
}

function waterfallRecord(waterfall: WaterfallSheet) {
  return {
    cellIndex: waterfall.cellIndex,
    distanceMeters: waterfall.distanceMeters,
    topOffset: waterfall.topOffset,
    baseOffset: waterfall.baseOffset,
    topTerrainY: waterfall.topTerrainY,
    baseTerrainY: waterfall.baseTerrainY,
    top: waterfall.top.toArray(),
    base: waterfall.base.toArray(),
    width: waterfall.width,
  };
}

describe('streamed water features', () => {
  it('builds a finite route-following ribbon outside the protected road corridor', () => {
    const features = createStreamedWaterFeatures({
      curve: makeRoute(),
      totalDistanceMeters: 1_500,
      window: { startMeters: 120, endMeters: 1_180 },
      seed: 0x12345678,
      themeKey: 'forge-world',
      kind: 'stream',
      width: 0.52,
      roadHalfWidth: 0.35,
      roadClearance: 1.1,
      terrainHeight: absoluteTerrain,
    });

    const position = features.streamGeometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(4);
    expect(position.count).toBeLessThanOrEqual(WATER_FEATURE_BUDGETS.standard.streamVertices);
    expectFiniteAttribute(features.streamGeometry, 'position');
    expectFiniteAttribute(features.streamGeometry, 'normal');
    expectFiniteAttribute(features.streamGeometry, 'uv');
    expect(features.streamGeometry.getIndex()!.count).toBe((features.streamSamples.length - 1) * 6);

    for (const sample of features.streamSamples) {
      expect(Math.abs(sample.centerOffset) - sample.halfWidth).toBeGreaterThanOrEqual(1.45 - 1e-8);
      expect(sample.left.y).toBeCloseTo(absoluteTerrain(
        sample.distanceMeters,
        sample.centerOffset - sample.halfWidth,
      ) + WATER_FEATURE_CONFIGS.stream.surfaceLift, 8);
      expect(sample.right.y).toBeCloseTo(absoluteTerrain(
        sample.distanceMeters,
        sample.centerOffset + sample.halfWidth,
      ) + WATER_FEATURE_CONFIGS.stream.surfaceLift, 8);
    }

    disposeFeatures(features);
  });

  it('uses a shared carved-terrain centerline for water and bank dressing', () => {
    const centerOffsetAt = (distanceMeters: number) => 2.15 + Math.sin(distanceMeters * 0.01) * 0.22;
    const features = createStreamedWaterFeatures({
      curve: makeRoute(),
      totalDistanceMeters: 1_500,
      window: { startMeters: 100, endMeters: 1_200 },
      seed: 0x8a32,
      themeKey: 'shared-carve',
      kind: 'stream',
      width: 0.44,
      centerOffsetAt,
      terrainHeight: absoluteTerrain,
    });

    for (const sample of features.streamSamples) {
      expect(sample.centerOffset).toBeCloseTo(centerOffsetAt(sample.distanceMeters), 10);
    }
    for (const rock of features.rocks) {
      expect(Math.abs(rock.lateralOffset - centerOffsetAt(rock.distanceMeters))).toBeLessThan(0.9);
    }
    disposeFeatures(features);
  });

  it('anchors every waterfall top and base to independently sampled terrain', () => {
    const features = createStreamedWaterFeatures({
      curve: makeRoute(),
      totalDistanceMeters: 2_000,
      window: { startMeters: 0, endMeters: 1_900 },
      seed: 73,
      themeKey: 'alpine-water',
      kind: 'stream',
      width: 0.54,
      terrainHeight: absoluteTerrain,
      config: { waterfallChance: 1, waterfallMinDrop: 0.01 },
      budget: { waterfallVertices: 200, mistInstances: 200 },
    });

    expect(features.waterfalls.length).toBeGreaterThan(2);
    expect(features.waterfallGeometry.getAttribute('position').count).toBe(features.waterfalls.length * 4);
    expectFiniteAttribute(features.waterfallGeometry, 'position');
    expectFiniteAttribute(features.waterfallGeometry, 'normal');
    expectFiniteAttribute(features.waterfallGeometry, 'uv');

    for (const waterfall of features.waterfalls) {
      expect(waterfall.topTerrainY).toBeCloseTo(
        absoluteTerrain(waterfall.distanceMeters, waterfall.topOffset),
        10,
      );
      expect(waterfall.baseTerrainY).toBeCloseTo(
        absoluteTerrain(waterfall.distanceMeters, waterfall.baseOffset),
        10,
      );
      expect(waterfall.top.y).toBeCloseTo(
        waterfall.topTerrainY + WATER_FEATURE_CONFIGS.stream.surfaceLift,
        10,
      );
      expect(waterfall.base.y).toBeCloseTo(
        waterfall.baseTerrainY + WATER_FEATURE_CONFIGS.stream.surfaceLift,
        10,
      );
      expect(waterfall.top.y - waterfall.base.y).toBeGreaterThan(0.01);
    }

    for (const rock of features.rocks) {
      expect(rock.position.y - rock.scale.y / 2).toBeCloseTo(rock.terrainY, 10);
    }
    for (const mist of features.mist) {
      expect(mist.position.y).toBeGreaterThan(mist.terrainY);
    }

    disposeFeatures(features);
  });

  it('keeps IDs and transforms stable between overlapping streamed windows', () => {
    const common = {
      curve: makeRoute(),
      totalDistanceMeters: 2_000,
      seed: 9321,
      themeKey: 'overlap-world',
      kind: 'stream' as const,
      width: 0.5,
      terrainHeight: absoluteTerrain,
      config: { waterfallChance: 1, waterfallMinDrop: 0.01 },
      budget: { waterfallVertices: 200, mistInstances: 300, rockInstances: 300 },
    };
    const first = createStreamedWaterFeatures({
      ...common,
      window: { startMeters: 0, endMeters: 1_100 },
    });
    const second = createStreamedWaterFeatures({
      ...common,
      window: { startMeters: 440, endMeters: 1_540 },
    });

    const assertStableOverlap = <T extends { id: string }>(
      left: T[],
      right: T[],
      record: (value: T) => unknown,
    ) => {
      const rightById = new Map(right.map((value) => [value.id, value]));
      const overlap = left.filter((value) => rightById.has(value.id));
      expect(overlap.length).toBeGreaterThan(0);
      for (const value of overlap) {
        expect(record(rightById.get(value.id)!)).toEqual(record(value));
      }
    };

    assertStableOverlap(first.waterfalls, second.waterfalls, waterfallRecord);
    assertStableOverlap(first.rocks, second.rocks, transformRecord);
    assertStableOverlap(first.mist, second.mist, transformRecord);

    const firstStreamByDistance = new Map(first.streamSamples.map((sample) => [
      sample.distanceMeters,
      {
        centerOffset: sample.centerOffset,
        halfWidth: sample.halfWidth,
        left: sample.left.toArray(),
        right: sample.right.toArray(),
      },
    ]));
    const streamOverlap = second.streamSamples.filter((sample) => firstStreamByDistance.has(sample.distanceMeters));
    expect(streamOverlap.length).toBeGreaterThan(30);
    for (const sample of streamOverlap) {
      expect({
        centerOffset: sample.centerOffset,
        halfWidth: sample.halfWidth,
        left: sample.left.toArray(),
        right: sample.right.toArray(),
      }).toEqual(firstStreamByDistance.get(sample.distanceMeters));
    }

    disposeFeatures(first);
    disposeFeatures(second);
  });

  it('enforces strict geometry and instance budgets even for an enormous window', () => {
    const budget = {
      streamVertices: 38,
      waterfallVertices: 12,
      mistInstances: 5,
      rockInstances: 9,
    };
    const features = createStreamedWaterFeatures({
      curve: makeRoute(),
      totalDistanceMeters: 100_000,
      window: { startMeters: 0, endMeters: 100_000 },
      seed: 101,
      kind: 'runoff',
      width: 0.4,
      terrainHeight: absoluteTerrain,
      config: { waterfallChance: 1, waterfallMinDrop: 0.01 },
      budget,
    });

    expect(features.streamGeometry.getAttribute('position').count).toBeLessThanOrEqual(budget.streamVertices);
    expect(features.waterfallGeometry.getAttribute('position').count).toBeLessThanOrEqual(budget.waterfallVertices);
    expect(features.waterfalls.length).toBeLessThanOrEqual(Math.floor(budget.waterfallVertices / 4));
    expect(features.mist.length).toBeLessThanOrEqual(budget.mistInstances);
    expect(features.rocks.length).toBeLessThanOrEqual(budget.rockInstances);

    disposeFeatures(features);
  });

  it('uses distinct surface recipes and never invents canal waterfalls', () => {
    expect(WATER_FEATURE_CONFIGS.stream.style).toBe('water');
    expect(WATER_FEATURE_CONFIGS.ice.style).toBe('ice');
    expect(WATER_FEATURE_CONFIGS.runoff.style).toBe('runoff');
    expect(WATER_FEATURE_CONFIGS.canal.style).toBe('canal');
    expect(WATER_FEATURE_CONFIGS.canal.meanderPrimary).toBeLessThan(
      WATER_FEATURE_CONFIGS.stream.meanderPrimary,
    );

    const canal = createStreamedWaterFeatures({
      curve: makeRoute(),
      totalDistanceMeters: 2_000,
      window: { startMeters: 0, endMeters: 2_000 },
      seed: 511,
      kind: 'canal',
      width: 0.3,
      terrainHeight: absoluteTerrain,
    });
    expect(canal.style).toBe('canal');
    expect(canal.waterfalls).toEqual([]);
    expect(canal.mist).toEqual([]);
    expect(canal.waterfallGeometry.getAttribute('position').count).toBe(0);

    disposeFeatures(canal);
  });

  it('falls back to the route height when terrain samples are non-finite', () => {
    const features = createStreamedWaterFeatures({
      curve: makeRoute(),
      totalDistanceMeters: 1_500,
      window: { startMeters: 0, endMeters: 1_400 },
      seed: 18,
      kind: 'ice',
      width: 0.4,
      terrainHeight: (distanceMeters) => distanceMeters > 500 ? Number.NaN : Number.POSITIVE_INFINITY,
      config: { waterfallChance: 1 },
    });

    expectFiniteAttribute(features.streamGeometry, 'position');
    expectFiniteAttribute(features.streamGeometry, 'normal');
    for (const rock of features.rocks) {
      for (const value of [
        ...rock.position.toArray(),
        ...rock.quaternion.toArray(),
        ...rock.scale.toArray(),
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }

    disposeFeatures(features);
  });
});

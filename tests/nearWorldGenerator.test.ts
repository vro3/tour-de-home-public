import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ScenicTheme } from '../src/types/scenic';
import {
  generateNearWorld,
  getNearWorldThemeConfig,
  groupNearWorldInstances,
  NEAR_WORLD_PROP_KINDS,
  sampleNearWorldHabitat,
  sampleNearWorldRouteFrame,
  type NearWorldGenerationResult,
  type NearWorldThemeConfig,
} from '../src/scenic/nearWorldGenerator';

function makeCurve(): THREE.CatmullRomCurve3 {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 1, -40),
    new THREE.Vector3(18, 3, -78),
    new THREE.Vector3(56, 7, -98),
    new THREE.Vector3(92, 9, -83),
    new THREE.Vector3(110, 11, -45),
  ], false, 'centripetal', 0.35);
  curve.arcLengthDivisions = 1_500;
  curve.updateArcLengths();
  return curve;
}

function generate(
  startMeters: number,
  endMeters: number,
  theme: ScenicTheme = 'forgeworld',
): NearWorldGenerationResult {
  return generateNearWorld({
    curve: makeCurve(),
    totalDistanceMeters: 2_400,
    startMeters,
    endMeters,
    seed: 'turn-heavy-route',
    theme,
    worldScale: 0.1,
    terrainHeightAt: (distance, offset) => Math.sin(distance * 0.01 + offset) * 0.05,
  });
}

function serializedInstance(instance: NearWorldGenerationResult['instances'][number]) {
  return {
    ...instance,
    position: instance.position.toArray(),
    groundPosition: instance.groundPosition.toArray(),
    scale: instance.scale.toArray(),
    quaternion: instance.quaternion.toArray(),
    routeQuaternion: instance.routeQuaternion.toArray(),
  };
}

describe('near-world route streaming', () => {
  it('is byte-for-byte deterministic for repeated runs', () => {
    const first = generate(200, 1_800);
    const second = generate(200, 1_800);

    expect(first.instances.map(serializedInstance)).toEqual(second.instances.map(serializedInstance));
    expect(first.stats).toEqual(second.stats);
  });

  it('keeps IDs and transforms identical throughout overlapping windows', () => {
    const first = generate(100, 1_200);
    const second = generate(700, 1_800);
    const secondById = new Map(second.instances.map((instance) => [instance.id, serializedInstance(instance)]));
    const overlap = first.instances.filter((instance) => secondById.has(instance.id));

    expect(overlap.length).toBeGreaterThan(80);
    for (const instance of overlap) {
      expect(serializedInstance(instance)).toEqual(secondById.get(instance.id));
    }
  });

  it('fills the route continuously with varied individual prop families', () => {
    const result = generate(0, 1_600);
    const grouped = groupNearWorldInstances(result.instances);
    const occupiedHundreds = new Set(result.instances.map((instance) => Math.floor(instance.distanceMeters / 100)));

    expect(result.instances.length).toBeGreaterThan(350);
    expect(occupiedHundreds.size).toBeGreaterThanOrEqual(15);
    expect(grouped.tree.length).toBeGreaterThan(80);
    expect(grouped.rock.length).toBeGreaterThan(25);
    expect(grouped.groundCover.length).toBeGreaterThan(100);
    expect(grouped.reflector).toHaveLength(0);
    expect(grouped.streamBank.length).toBeGreaterThan(10);
    expect(grouped.waterfallMist).toHaveLength(0);
    expect(new Set(result.instances.map((instance) => instance.variant)).size).toBeGreaterThan(6);
  });

  it('rejects candidates beyond a non-aligned route finish instead of stacking them at the endpoint', () => {
    const totalDistanceMeters = 1_234;
    const result = generateNearWorld({
      curve: makeCurve(),
      totalDistanceMeters,
      startMeters: 900,
      endMeters: totalDistanceMeters,
      seed: 42,
      theme: 'forgeworld',
      worldScale: 0.1,
    });

    expect(result.instances.length).toBeGreaterThan(50);
    expect(result.instances.every((instance) => (
      instance.distanceMeters >= 900 && instance.distanceMeters <= totalDistanceMeters
    ))).toBe(true);
    expect(result.instances.filter((instance) => instance.distanceMeters === totalDistanceMeters)).toHaveLength(0);
  });

  it('applies deterministic absolute-coordinate placement suitability without rerolling survivors', () => {
    const baseConfig = getNearWorldThemeConfig('forgeworld');
    const options = {
      curve: makeCurve(),
      totalDistanceMeters: 2_400,
      startMeters: 0,
      endMeters: 1_600,
      seed: 'suitability-route',
      theme: 'forgeworld' as const,
      worldScale: 0.1,
      config: {
        ...baseConfig,
        maxInstancesPerCell: 200,
        maxInstancesPerWindow: 10_000,
      },
    };
    const baseline = generateNearWorld(options);
    const placementSuitabilityAt = (
      kind: NearWorldGenerationResult['instances'][number]['kind'],
      distanceMeters: number,
      lateralOffsetWorld: number,
    ) => kind !== 'tree' || (distanceMeters >= 400 && lateralOffsetWorld < 0);
    const gated = generateNearWorld({ ...options, placementSuitabilityAt });
    const repeated = generateNearWorld({ ...options, placementSuitabilityAt });
    const baselineById = new Map(baseline.instances.map((instance) => [
      instance.id,
      serializedInstance(instance),
    ]));

    expect(gated.instances.length).toBeLessThan(baseline.instances.length);
    expect(gated.instances.filter((instance) => instance.kind === 'tree').length).toBeGreaterThan(10);
    expect(gated.instances.filter((instance) => instance.kind === 'tree').every((instance) => (
      instance.distanceMeters >= 400 && instance.lateralOffsetWorld < 0
    ))).toBe(true);
    expect(gated.instances.map(serializedInstance)).toEqual(repeated.instances.map(serializedInstance));
    for (const instance of gated.instances) {
      expect(serializedInstance(instance)).toEqual(baselineById.get(instance.id));
    }
  });

  it('forms deterministic groves and clearings instead of uniform scatter', () => {
    const result = generate(0, 1_600);
    const treeCounts = Array.from({ length: 16 }, (_, cell) => result.instances.filter((instance) => (
      instance.kind === 'tree'
      && Math.floor(instance.distanceMeters / 100) === cell
    )).length);
    const habitat = Array.from({ length: 24 }, (_, index) => sampleNearWorldHabitat(
      'forgeworld',
      'turn-heavy-route',
      'tree',
      index * 50,
    ));

    expect(Math.max(...treeCounts) - Math.min(...treeCounts)).toBeGreaterThan(12);
    expect(Math.max(...habitat) - Math.min(...habitat)).toBeGreaterThan(0.55);
    expect(result.instances.every((instance) => instance.habitat >= 0 && instance.habitat <= 1)).toBe(true);
    expect(new Set(result.instances.filter((instance) => instance.kind === 'tree').map((instance) => instance.clusterId)).size).toBeGreaterThan(4);
  });

  it('maintains a road-clear zone while distributing near/mid and both sides', () => {
    const result = generate(0, 1_600);
    const clearance = getNearWorldThemeConfig('forgeworld').roadClearanceMeters;
    const bands = new Set(result.instances.map((instance) => instance.band));
    const sides = new Set(result.instances.map((instance) => instance.side));

    expect(result.instances.every((instance) => Math.abs(instance.lateralOffsetMeters) >= clearance)).toBe(true);
    expect(bands).toEqual(new Set(['near', 'mid']));
    expect(sides).toEqual(new Set([-1, 1]));
  });

  it('samples route heading, frame and position rather than laying props on a straight axis', () => {
    const result = generate(0, 2_000);
    const headings = result.instances.map((instance) => instance.headingRadians);
    const positions = result.instances.map((instance) => instance.groundPosition);

    expect(Math.max(...headings) - Math.min(...headings)).toBeGreaterThan(1);
    expect(Math.max(...positions.map((position) => position.x)) - Math.min(...positions.map((position) => position.x))).toBeGreaterThan(50);
    expect(Math.max(...positions.map((position) => position.z)) - Math.min(...positions.map((position) => position.z))).toBeGreaterThan(50);
  });

  it('returns finite transforms and applies terrain height in scene units', () => {
    const result = generate(0, 1_000);
    for (const instance of result.instances) {
      const values = [
        instance.distanceMeters,
        instance.lateralOffsetMeters,
        ...instance.position.toArray(),
        ...instance.groundPosition.toArray(),
        ...instance.scale.toArray(),
        ...instance.quaternion.toArray(),
        ...instance.routeQuaternion.toArray(),
      ];
      expect(values.every(Number.isFinite)).toBe(true);
      expect(instance.scale.x).toBeGreaterThan(0);
      expect(instance.scale.y).toBeGreaterThan(0);
      expect(instance.scale.z).toBeGreaterThan(0);
    }
  });
});

describe('near-world density and safety budgets', () => {
  it('provides materially different biome recipes for natural, sparse and urban themes', () => {
    const forge = getNearWorldThemeConfig('forgeworld');
    const snow = getNearWorldThemeConfig('snowbound');
    const city = getNearWorldThemeConfig('nmpdhq');

    expect(forge.kinds.tree.densityPerKilometer).toBeGreaterThan(snow.kinds.tree.densityPerKilometer * 10);
    expect(city.kinds.structure.densityPerKilometer).toBeGreaterThan(forge.kinds.structure.densityPerKilometer * 5);
    expect(city.kinds.tree.densityPerKilometer).toBeGreaterThan(0);
    expect(city.kinds.tree.densityPerKilometer).toBeLessThan(forge.kinds.tree.densityPerKilometer / 10);
    expect(forge.kinds.reflector.densityPerKilometer).toBe(0);
    expect(forge.kinds.waterfallMist.densityPerKilometer).toBe(0);
  });

  it('uses a smaller low-detail density and draw budget', () => {
    const standardConfig = getNearWorldThemeConfig('forgeworld', 'standard');
    const lowConfig = getNearWorldThemeConfig('forgeworld', 'low');
    const standard = generateNearWorld({
      curve: makeCurve(), totalDistanceMeters: 2_400, startMeters: 0, endMeters: 2_000,
      seed: 42, theme: 'forgeworld', quality: 'standard',
    });
    const low = generateNearWorld({
      curve: makeCurve(), totalDistanceMeters: 2_400, startMeters: 0, endMeters: 2_000,
      seed: 42, theme: 'forgeworld', quality: 'low',
    });

    expect(lowConfig.maxInstancesPerCell).toBeLessThan(standardConfig.maxInstancesPerCell);
    expect(lowConfig.maxInstancesPerWindow).toBeLessThan(standardConfig.maxInstancesPerWindow);
    expect(low.instances.length).toBeLessThan(standard.instances.length * 0.65);
  });

  it('enforces cell/window budgets and clamps unbounded streaming requests', () => {
    const base = getNearWorldThemeConfig('forgeworld');
    const constrained: NearWorldThemeConfig = {
      ...base,
      maxInstancesPerCell: 3,
      maxInstancesPerWindow: 17,
      maxWindowMeters: 500,
    };
    const result = generateNearWorld({
      curve: makeCurve(), totalDistanceMeters: 5_000, startMeters: 0, endMeters: 5_000,
      focusMeters: 2_600, seed: 9, theme: 'forgeworld', config: constrained,
    });

    expect(result.window.wasClamped).toBe(true);
    expect(result.window.endMeters - result.window.startMeters).toBe(500);
    expect(result.instances.length).toBeLessThanOrEqual(17);
    expect(result.stats.visitedCells).toBe(10);
    expect(result.stats.droppedByCellBudget + result.stats.droppedByWindowBudget).toBeGreaterThan(0);
  });

  it('sanitizes degenerate frames and hostile numeric inputs', () => {
    const degenerate = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(1, 2, 3),
    ]);
    const frame = sampleNearWorldRouteFrame(degenerate, Number.NaN, Number.POSITIVE_INFINITY);
    const result = generateNearWorld({
      curve: degenerate,
      totalDistanceMeters: Number.NaN,
      startMeters: Number.NEGATIVE_INFINITY,
      endMeters: Number.POSITIVE_INFINITY,
      seed: Number.NaN,
      theme: 'daybreak',
      worldScale: Number.NaN,
    });

    expect([...frame.point.toArray(), ...frame.tangent.toArray(), ...frame.right.toArray(), ...frame.routeQuaternion.toArray()].every(Number.isFinite)).toBe(true);
    expect(result.instances.every((instance) => Object.values(serializedInstance(instance)).flat(3).every((value) => typeof value !== 'number' || Number.isFinite(value)))).toBe(true);
  });

  it('exposes every renderer group for an urban biome recipe', () => {
    const grouped = groupNearWorldInstances(generate(0, 500, 'nmpdhq').instances);
    expect(Object.keys(grouped).sort()).toEqual([...NEAR_WORLD_PROP_KINDS].sort());
    expect(grouped.tree.length).toBeGreaterThan(0);
    expect(grouped.structure.length).toBeGreaterThan(0);
  });
});

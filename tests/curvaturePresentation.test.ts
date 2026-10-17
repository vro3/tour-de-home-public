import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  blendScenicPlateWeights,
  sampleCurvaturePresentation,
  smoothCurvaturePresentation,
  type CurvaturePresentation,
  type ScenicPlateWeights,
} from '../src/scenic/curvaturePresentation';

function makeCurve(points: THREE.Vector3[]): THREE.CatmullRomCurve3 {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
  curve.arcLengthDivisions = 1_000;
  curve.updateArcLengths();
  return curve;
}

function makeQuarterTurn(side: 'left' | 'right', radius = 100): THREE.CatmullRomCurve3 {
  const direction = side === 'right' ? 1 : -1;
  const points = Array.from({ length: 13 }, (_, index) => {
    const angle = index / 12 * Math.PI / 2;
    return new THREE.Vector3(
      direction * radius * (1 - Math.cos(angle)),
      0,
      -radius * Math.sin(angle),
    );
  });
  return makeCurve(points);
}

function expectNormalized(weights: ScenicPlateWeights): void {
  expect(weights.straight).toBeGreaterThanOrEqual(0);
  expect(weights.left).toBeGreaterThanOrEqual(0);
  expect(weights.right).toBeGreaterThanOrEqual(0);
  expect(weights.straight + weights.left + weights.right).toBeCloseTo(1, 12);
}

describe('sampleCurvaturePresentation', () => {
  it('classifies a straight route without introducing phantom turn weight', () => {
    const curve = makeCurve([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 2, -50),
      new THREE.Vector3(0, 5, -100),
      new THREE.Vector3(0, 9, -150),
    ]);

    const presentation = sampleCurvaturePresentation(curve, 75);

    expect(presentation.headingDelta).toBeCloseTo(0, 12);
    expect(presentation.turnStrength).toBe(0);
    expect(presentation).toMatchObject({ straight: 1, left: 0, right: 0 });
  });

  it('uses signed compass heading to distinguish right and left bends', () => {
    const right = makeQuarterTurn('right');
    const left = makeQuarterTurn('left');
    const rightPresentation = sampleCurvaturePresentation(right, right.getLength() / 2);
    const leftPresentation = sampleCurvaturePresentation(left, left.getLength() / 2);

    expect(rightPresentation.headingDelta).toBeGreaterThan(0);
    expect(rightPresentation.right).toBeGreaterThan(rightPresentation.left);
    expect(leftPresentation.headingDelta).toBeLessThan(0);
    expect(leftPresentation.left).toBeGreaterThan(leftPresentation.right);
    expect(Math.abs(leftPresentation.headingDelta)).toBeCloseTo(rightPresentation.headingDelta, 6);
    expectNormalized(rightPresentation);
    expectNormalized(leftPresentation);
  });

  it('maps real distance to world-scaled curves through routeLengthMeters', () => {
    const curve = makeQuarterTurn('right', 10);
    const presentation = sampleCurvaturePresentation(curve, 500, {
      routeLengthMeters: 1_000,
      sampleSpanMeters: 400,
    });

    expect(presentation.headingDelta).toBeGreaterThan(0);
    expect(presentation.right).toBeGreaterThan(0.9);
  });

  it('is deterministic, normalized, and finite at and beyond both endpoints', () => {
    const curve = makeQuarterTurn('right');
    const distances = [Number.NEGATIVE_INFINITY, -100, 0, curve.getLength(), 10_000, Number.POSITIVE_INFINITY, Number.NaN];

    for (const distance of distances) {
      const first = sampleCurvaturePresentation(curve, distance);
      const second = sampleCurvaturePresentation(curve, distance);

      expect(first).toEqual(second);
      expect(Object.values(first).every(Number.isFinite)).toBe(true);
      expect(first.turnStrength).toBeGreaterThanOrEqual(0);
      expect(first.turnStrength).toBeLessThanOrEqual(1);
      expectNormalized(first);
    }
  });

  it('returns a safe straight result for a degenerate curve', () => {
    const curve = makeCurve([
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(1, 2, 3),
    ]);

    expect(sampleCurvaturePresentation(curve, 10)).toEqual({
      straight: 1,
      left: 0,
      right: 0,
      headingDelta: 0,
      turnStrength: 0,
    });
  });
});

describe('curvature presentation blending', () => {
  const straight: CurvaturePresentation = {
    straight: 1,
    left: 0,
    right: 0,
    headingDelta: 0,
    turnStrength: 0,
  };
  const right: CurvaturePresentation = {
    straight: 0,
    left: 0,
    right: 1,
    headingDelta: Math.PI / 4,
    turnStrength: 1,
  };

  it('exponentially smooths half way in one half-life without losing normalization', () => {
    const smoothed = smoothCurvaturePresentation(straight, right, 0.25, 0.25);

    expect(smoothed.straight).toBeCloseTo(0.5, 12);
    expect(smoothed.right).toBeCloseTo(0.5, 12);
    expect(smoothed.left).toBe(0);
    expect(smoothed.headingDelta).toBeCloseTo(Math.PI / 8, 12);
    expect(smoothed.turnStrength).toBeCloseTo(0.5, 12);
    expectNormalized(smoothed);
  });

  it('normalizes and crossfades future authored scenic plate weights', () => {
    const mixed = blendScenicPlateWeights(right, { straight: 1, left: 3 }, 0.4);

    expect(mixed.straight).toBeCloseTo(0.1, 12);
    expect(mixed.left).toBeCloseTo(0.3, 12);
    expect(mixed.right).toBeCloseTo(0.6, 12);
    expectNormalized(mixed);
  });

  it('sanitizes malformed smoothing and authored-blend inputs', () => {
    const malformed = {
      straight: Number.NaN,
      left: -4,
      right: Number.POSITIVE_INFINITY,
      headingDelta: Number.NaN,
      turnStrength: Number.POSITIVE_INFINITY,
    };

    const unchanged = smoothCurvaturePresentation(malformed, right, Number.NaN);
    const authored = blendScenicPlateWeights(malformed, { left: Number.NaN, right: -2 }, 1);

    expect(unchanged).toEqual(straight);
    expect(authored).toEqual({ straight: 1, left: 0, right: 0 });
  });
});

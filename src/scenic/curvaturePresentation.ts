import * as THREE from 'three';

const EPSILON = 1e-9;
const LN_2 = Math.log(2);

export interface ScenicPlateWeights {
  straight: number;
  left: number;
  right: number;
}

/**
 * A render-ready description of the road bend around the requested distance.
 * `headingDelta` is in radians and follows compass heading: positive is right,
 * negative is left. `turnStrength` is the unsigned classified strength [0, 1].
 */
export interface CurvaturePresentation extends ScenicPlateWeights {
  headingDelta: number;
  turnStrength: number;
}

export interface CurvaturePresentationOptions {
  /**
   * Real route length represented by the curve. Supply this when scene units
   * are not meters (ScenicRide currently uses one scene unit per ten meters).
   */
  routeLengthMeters?: number;
  /** Distance over which the change in heading is measured. */
  sampleSpanMeters?: number;
  /** Bend angle below which the presentation remains visually straight. */
  straightThresholdDegrees?: number;
  /** Bend angle at which a left/right presentation reaches full weight. */
  fullTurnDegrees?: number;
  /** Number of sub-spans used to unwrap and accumulate the heading change. */
  headingSamples?: number;
}

const DEFAULT_OPTIONS = {
  sampleSpanMeters: 80,
  straightThresholdDegrees: 2,
  fullTurnDegrees: 18,
  headingSamples: 6,
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function normalizedWeights(weights: Partial<ScenicPlateWeights>): ScenicPlateWeights {
  const straight = Math.max(0, finiteOr(weights.straight ?? 0, 0));
  const left = Math.max(0, finiteOr(weights.left ?? 0, 0));
  const right = Math.max(0, finiteOr(weights.right ?? 0, 0));
  const total = straight + left + right;

  if (!Number.isFinite(total) || total <= EPSILON) {
    return { straight: 1, left: 0, right: 0 };
  }

  return {
    straight: straight / total,
    left: left / total,
    right: right / total,
  };
}

function horizontalHeading(curve: THREE.CatmullRomCurve3, u: number): number {
  const tangent = curve.getTangentAt(clamp01(u));
  const horizontalLengthSquared = tangent.x * tangent.x + tangent.z * tangent.z;

  if (!Number.isFinite(horizontalLengthSquared) || horizontalLengthSquared <= EPSILON) return 0;

  // The scenic world maps east to +X and north to -Z. atan2 therefore gives
  // a compass-style clockwise heading, for which right turns are positive.
  return Math.atan2(tangent.x, -tangent.z);
}

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function safeDistance(distanceMeters: number, routeLengthMeters: number): number {
  if (Number.isNaN(distanceMeters)) return 0;
  if (distanceMeters === Number.POSITIVE_INFINITY) return routeLengthMeters;
  if (!Number.isFinite(distanceMeters)) return 0;
  return Math.min(routeLengthMeters, Math.max(0, distanceMeters));
}

/**
 * Samples spatial curvature and turns it into normalized visual blend weights.
 * The function has no frame history, so identical inputs always produce the
 * same result. Use `smoothCurvaturePresentation` to soften changes over time.
 */
export function sampleCurvaturePresentation(
  curve: THREE.CatmullRomCurve3,
  distanceMeters: number,
  options: CurvaturePresentationOptions = {},
): CurvaturePresentation {
  const curveLength = finiteOr(curve.getLength(), 0);
  const routeLengthMeters = positiveOr(options.routeLengthMeters, curveLength);
  if (routeLengthMeters <= EPSILON || curveLength <= EPSILON) {
    return { straight: 1, left: 0, right: 0, headingDelta: 0, turnStrength: 0 };
  }

  const distance = safeDistance(distanceMeters, routeLengthMeters);
  const requestedSpan = positiveOr(options.sampleSpanMeters, DEFAULT_OPTIONS.sampleSpanMeters);
  const span = Math.min(routeLengthMeters, requestedSpan);
  // Shift the full sampling window inwards at either endpoint. This avoids a
  // shrinking denominator and keeps the result stable at route boundaries.
  const startMeters = Math.min(
    Math.max(0, distance - span / 2),
    Math.max(0, routeLengthMeters - span),
  );
  const endMeters = Math.min(routeLengthMeters, startMeters + span);
  const requestedSamples = Math.round(positiveOr(options.headingSamples, DEFAULT_OPTIONS.headingSamples));
  const headingSamples = Math.min(64, Math.max(1, requestedSamples));

  let previousHeading = horizontalHeading(curve, startMeters / routeLengthMeters);
  let headingDelta = 0;
  for (let index = 1; index <= headingSamples; index += 1) {
    const distanceAlongWindow = THREE.MathUtils.lerp(startMeters, endMeters, index / headingSamples);
    const heading = horizontalHeading(curve, distanceAlongWindow / routeLengthMeters);
    headingDelta += shortestAngleDelta(previousHeading, heading);
    previousHeading = heading;
  }
  headingDelta = finiteOr(headingDelta, 0);

  const threshold = THREE.MathUtils.degToRad(Math.max(
    0,
    finiteOr(options.straightThresholdDegrees ?? DEFAULT_OPTIONS.straightThresholdDegrees, DEFAULT_OPTIONS.straightThresholdDegrees),
  ));
  const fullTurn = THREE.MathUtils.degToRad(Math.max(
    THREE.MathUtils.radToDeg(threshold) + EPSILON,
    positiveOr(options.fullTurnDegrees, DEFAULT_OPTIONS.fullTurnDegrees),
  ));
  const turnStrength = smoothstep(threshold, fullTurn, Math.abs(headingDelta));
  const weights = normalizedWeights({
    straight: 1 - turnStrength,
    left: headingDelta < 0 ? turnStrength : 0,
    right: headingDelta > 0 ? turnStrength : 0,
  });

  return { ...weights, headingDelta, turnStrength };
}

/**
 * Pure exponential damping for per-frame presentation updates. `halfLifeSeconds`
 * is the time needed to move halfway from the previous value to the target.
 */
export function smoothCurvaturePresentation(
  previous: CurvaturePresentation,
  target: CurvaturePresentation,
  deltaSeconds: number,
  halfLifeSeconds = 0.2,
): CurvaturePresentation {
  const elapsed = Math.max(0, finiteOr(deltaSeconds, 0));
  const halfLife = positiveOr(halfLifeSeconds, 0.2);
  const blend = clamp01(1 - Math.exp(-LN_2 * elapsed / halfLife));
  const fromWeights = normalizedWeights(previous);
  const toWeights = normalizedWeights(target);
  const weights = normalizedWeights({
    straight: THREE.MathUtils.lerp(fromWeights.straight, toWeights.straight, blend),
    left: THREE.MathUtils.lerp(fromWeights.left, toWeights.left, blend),
    right: THREE.MathUtils.lerp(fromWeights.right, toWeights.right, blend),
  });

  return {
    ...weights,
    headingDelta: THREE.MathUtils.lerp(
      finiteOr(previous.headingDelta, 0),
      finiteOr(target.headingDelta, 0),
      blend,
    ),
    turnStrength: clamp01(THREE.MathUtils.lerp(
      clamp01(previous.turnStrength),
      clamp01(target.turnStrength),
      blend,
    )),
  };
}

/**
 * Blends procedural curvature weights with an authored plate mix. This keeps
 * authored asset policy out of curvature sampling while guaranteeing a safe,
 * normalized result for material opacity or shader uniforms.
 */
export function blendScenicPlateWeights(
  curvature: ScenicPlateWeights,
  authored: Partial<ScenicPlateWeights> | undefined,
  authoredInfluence = 1,
): ScenicPlateWeights {
  const base = normalizedWeights(curvature);
  if (!authored) return base;

  const authoredWeights = normalizedWeights(authored);
  const blend = clamp01(authoredInfluence);
  return normalizedWeights({
    straight: THREE.MathUtils.lerp(base.straight, authoredWeights.straight, blend),
    left: THREE.MathUtils.lerp(base.left, authoredWeights.left, blend),
    right: THREE.MathUtils.lerp(base.right, authoredWeights.right, blend),
  });
}

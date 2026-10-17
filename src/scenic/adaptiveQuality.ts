import type { ScenicQualityMode } from '../types/scenic';

export type { ScenicQualityMode } from '../types/scenic';

export type ScenicFeatureTier = 'rich' | 'balanced' | 'efficient';

export type ScenicPerformanceSignal = 'overloaded' | 'healthy' | 'neutral';

export interface ScenicQualityEnvironment {
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  hardwareConcurrency?: number | null;
  deviceMemoryGb?: number | null;
  prefersReducedMotion?: boolean;
  qualityMode?: ScenicQualityMode;
}

export interface ScenicPerformanceWindow {
  durationMs: number;
  frameCount: number;
  meanFrameTimeMs: number;
  frameTimeP95Ms: number;
  slowFrameRatio: number;
}

export interface ScenicFrameSummaryOptions {
  /** Frames at or above this duration count as slow. */
  slowFrameThresholdMs?: number;
  /** Caps exceptional rAF gaps; integrations should also reset when the document is hidden. */
  maximumFrameTimeMs?: number;
}

export interface AdaptiveScenicQualityConfig {
  /** Highest DPR the scenic renderer asks the browser to allocate. */
  preferredDpr: number;
  /** A hard pixel-fill budget applied before adaptive resolution scaling. */
  maximumCanvasPixels: number;
  /** A soft floor. The hard pixel budget can still force a lower DPR. */
  minimumDpr: number;
  minimumWindowDurationMs: number;
  overloadFrameTimeP95Ms: number;
  recoveryFrameTimeP95Ms: number;
  overloadSlowFrameRatio: number;
  recoverySlowFrameRatio: number;
  overloadWindowsBeforeDegrade: number;
  recoveryWindowsBeforeRestore: number;
  degradeCooldownMs: number;
  restoreCooldownMs: number;
}

export interface ScenicQualityStage {
  resolutionScale: number;
  featureTier: ScenicFeatureTier;
  motionScale: number;
  useEnvironmentMap: boolean;
  useSurfaceDetailMaps: boolean;
  propDensity: number;
  particleDensity: number;
  maximumPanoramaFaceSize: 512 | 768 | 1024;
  legacyLowDetail: boolean;
}

export interface AdaptiveScenicQualityState {
  mode: ScenicQualityMode;
  level: number;
  overloadWindowStreak: number;
  recoveryWindowStreak: number;
  cooldownRemainingMs: number;
  elapsedObservedMs: number;
  transitionCount: number;
  initialReason: ScenicQualityInitialReason;
  config: Readonly<AdaptiveScenicQualityConfig>;
}

export type ScenicQualityInitialReason =
  | 'full-fidelity'
  | 'reduced-motion'
  | 'limited-hardware'
  | 'limited-hardware-and-motion';

export interface ScenicRenderPlan extends ScenicQualityStage {
  level: number;
  targetDpr: number;
  internalWidth: number;
  internalHeight: number;
  estimatedCanvasPixels: number;
  pixelBudgetLimited: boolean;
}

export interface ScenicQualityTransition {
  direction: 'degrade' | 'restore';
  fromLevel: number;
  toLevel: number;
  changed: 'resolution' | 'features';
}

export interface AdaptiveScenicQualityDecision {
  state: AdaptiveScenicQualityState;
  signal: ScenicPerformanceSignal;
  transition: ScenicQualityTransition | null;
}

export const DEFAULT_ADAPTIVE_SCENIC_QUALITY_CONFIG: Readonly<AdaptiveScenicQualityConfig> = Object.freeze({
  preferredDpr: 1.55,
  maximumCanvasPixels: 5_000_000,
  minimumDpr: 0.65,
  minimumWindowDurationMs: 1_500,
  overloadFrameTimeP95Ms: 20.5,
  // A healthy 60 Hz rAF cadence is ~16.67 ms. Leave practical jitter room
  // while preserving a clear neutral band below the 20.5 ms overload edge.
  recoveryFrameTimeP95Ms: 18,
  overloadSlowFrameRatio: 0.18,
  recoverySlowFrameRatio: 0.04,
  overloadWindowsBeforeDegrade: 3,
  recoveryWindowsBeforeRestore: 10,
  degradeCooldownMs: 8_000,
  restoreCooldownMs: 24_000,
});

/**
 * Ordered from highest visual fidelity to the emergency efficiency tier.
 * Resolution absorbs the first three degradations; scenery features only step
 * down after overload continues through additional observation windows.
 */
export const SCENIC_QUALITY_STAGES: readonly Readonly<ScenicQualityStage>[] = Object.freeze([
  Object.freeze({
    resolutionScale: 1,
    featureTier: 'rich',
    motionScale: 1,
    useEnvironmentMap: true,
    useSurfaceDetailMaps: true,
    propDensity: 1,
    particleDensity: 1,
    maximumPanoramaFaceSize: 1024,
    legacyLowDetail: false,
  }),
  Object.freeze({
    resolutionScale: 0.92,
    featureTier: 'rich',
    motionScale: 1,
    useEnvironmentMap: true,
    useSurfaceDetailMaps: true,
    propDensity: 1,
    particleDensity: 1,
    maximumPanoramaFaceSize: 1024,
    legacyLowDetail: false,
  }),
  Object.freeze({
    resolutionScale: 0.84,
    featureTier: 'rich',
    motionScale: 1,
    useEnvironmentMap: true,
    useSurfaceDetailMaps: true,
    propDensity: 1,
    particleDensity: 1,
    maximumPanoramaFaceSize: 1024,
    legacyLowDetail: false,
  }),
  Object.freeze({
    resolutionScale: 0.74,
    featureTier: 'rich',
    motionScale: 1,
    useEnvironmentMap: true,
    useSurfaceDetailMaps: true,
    propDensity: 1,
    particleDensity: 1,
    maximumPanoramaFaceSize: 1024,
    legacyLowDetail: false,
  }),
  Object.freeze({
    resolutionScale: 0.74,
    featureTier: 'balanced',
    motionScale: 0.65,
    useEnvironmentMap: true,
    useSurfaceDetailMaps: true,
    propDensity: 1,
    particleDensity: 0.86,
    maximumPanoramaFaceSize: 1024,
    legacyLowDetail: false,
  }),
  Object.freeze({
    resolutionScale: 0.72,
    featureTier: 'balanced',
    motionScale: 0.5,
    useEnvironmentMap: false,
    useSurfaceDetailMaps: true,
    propDensity: 1,
    particleDensity: 0.72,
    maximumPanoramaFaceSize: 768,
    legacyLowDetail: false,
  }),
  Object.freeze({
    resolutionScale: 0.68,
    featureTier: 'efficient',
    motionScale: 0.35,
    useEnvironmentMap: false,
    useSurfaceDetailMaps: false,
    propDensity: 0.82,
    particleDensity: 0.58,
    maximumPanoramaFaceSize: 512,
    legacyLowDetail: false,
  }),
  Object.freeze({
    resolutionScale: 0.62,
    featureTier: 'efficient',
    motionScale: 0.2,
    useEnvironmentMap: false,
    useSurfaceDetailMaps: false,
    propDensity: 0.62,
    particleDensity: 0.42,
    maximumPanoramaFaceSize: 512,
    legacyLowDetail: true,
  }),
]);

function finiteOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveInteger(value: number, fallback: number): number {
  const finite = finiteOr(value, fallback);
  return Math.max(1, Math.round(finite));
}

function resolveConfig(overrides: Partial<AdaptiveScenicQualityConfig>): AdaptiveScenicQualityConfig {
  const defaults = DEFAULT_ADAPTIVE_SCENIC_QUALITY_CONFIG;
  const preferredDpr = clamp(finiteOr(overrides.preferredDpr, defaults.preferredDpr), 0.25, 4);
  const minimumDpr = clamp(finiteOr(overrides.minimumDpr, defaults.minimumDpr), 0.25, preferredDpr);
  const overloadFrameTimeP95Ms = clamp(
    finiteOr(overrides.overloadFrameTimeP95Ms, defaults.overloadFrameTimeP95Ms),
    4,
    100,
  );
  const recoveryFrameTimeP95Ms = clamp(
    finiteOr(overrides.recoveryFrameTimeP95Ms, defaults.recoveryFrameTimeP95Ms),
    2,
    overloadFrameTimeP95Ms - 0.1,
  );
  const overloadSlowFrameRatio = clamp(
    finiteOr(overrides.overloadSlowFrameRatio, defaults.overloadSlowFrameRatio),
    0,
    1,
  );
  const recoverySlowFrameRatio = clamp(
    finiteOr(overrides.recoverySlowFrameRatio, defaults.recoverySlowFrameRatio),
    0,
    overloadSlowFrameRatio,
  );

  return {
    preferredDpr,
    maximumCanvasPixels: Math.max(100_000, finiteOr(
      overrides.maximumCanvasPixels,
      defaults.maximumCanvasPixels,
    )),
    minimumDpr,
    minimumWindowDurationMs: Math.max(250, finiteOr(
      overrides.minimumWindowDurationMs,
      defaults.minimumWindowDurationMs,
    )),
    overloadFrameTimeP95Ms,
    recoveryFrameTimeP95Ms,
    overloadSlowFrameRatio,
    recoverySlowFrameRatio,
    overloadWindowsBeforeDegrade: positiveInteger(
      overrides.overloadWindowsBeforeDegrade ?? defaults.overloadWindowsBeforeDegrade,
      defaults.overloadWindowsBeforeDegrade,
    ),
    recoveryWindowsBeforeRestore: positiveInteger(
      overrides.recoveryWindowsBeforeRestore ?? defaults.recoveryWindowsBeforeRestore,
      defaults.recoveryWindowsBeforeRestore,
    ),
    degradeCooldownMs: Math.max(0, finiteOr(overrides.degradeCooldownMs, defaults.degradeCooldownMs)),
    restoreCooldownMs: Math.max(0, finiteOr(overrides.restoreCooldownMs, defaults.restoreCooldownMs)),
  };
}

function initialLevel(environment: ScenicQualityEnvironment): number {
  if (environment.qualityMode === 'high') return 0;
  if (environment.qualityMode === 'efficient') return SCENIC_QUALITY_STAGES.length - 1;
  const threads = finiteOr(environment.hardwareConcurrency, 8);
  const memoryGb = finiteOr(environment.deviceMemoryGb, 8);
  const limited = threads <= 4 || memoryGb <= 4;
  const severelyLimited = threads <= 2 || memoryGb <= 2;
  const hardwareLevel = severelyLimited ? 3 : limited ? 2 : 0;
  return Math.max(hardwareLevel, environment.prefersReducedMotion ? 1 : 0);
}

function initialReason(environment: ScenicQualityEnvironment): ScenicQualityInitialReason {
  const limited = initialLevel({
    ...environment,
    qualityMode: 'auto',
    prefersReducedMotion: false,
  }) > 0;
  const reducedMotion = Boolean(environment.prefersReducedMotion);
  if (limited && reducedMotion) return 'limited-hardware-and-motion';
  if (limited) return 'limited-hardware';
  if (reducedMotion) return 'reduced-motion';
  return 'full-fidelity';
}

export function createAdaptiveScenicQualityState(
  environment: ScenicQualityEnvironment,
  configOverrides: Partial<AdaptiveScenicQualityConfig> = {},
): AdaptiveScenicQualityState {
  return {
    mode: environment.qualityMode ?? 'auto',
    level: initialLevel(environment),
    overloadWindowStreak: 0,
    recoveryWindowStreak: 0,
    cooldownRemainingMs: 0,
    elapsedObservedMs: 0,
    transitionCount: 0,
    initialReason: initialReason(environment),
    config: Object.freeze(resolveConfig(configOverrides)),
  };
}

/** Resets hysteresis when the rider explicitly changes the quality mode. */
export function setAdaptiveScenicQualityMode(
  state: AdaptiveScenicQualityState,
  mode: ScenicQualityMode,
  environment: ScenicQualityEnvironment,
): AdaptiveScenicQualityState {
  const level = initialLevel({ ...environment, qualityMode: mode });
  if (state.mode === mode && state.level === level) return state;
  return {
    ...state,
    mode,
    level,
    overloadWindowStreak: 0,
    recoveryWindowStreak: 0,
    cooldownRemainingMs: 0,
    initialReason: initialReason(environment),
  };
}

export function summarizeScenicFrameTimes(
  frameTimesMs: readonly number[],
  options: ScenicFrameSummaryOptions = {},
): ScenicPerformanceWindow | null {
  const maximumFrameTimeMs = Math.max(16, finiteOr(options.maximumFrameTimeMs, 250));
  const slowFrameThresholdMs = Math.max(1, finiteOr(options.slowFrameThresholdMs, 20.5));
  const accepted = frameTimesMs
    .filter((frameTime) => Number.isFinite(frameTime) && frameTime > 0)
    .map((frameTime) => Math.min(frameTime, maximumFrameTimeMs));

  if (accepted.length === 0) return null;

  const sorted = [...accepted].sort((left, right) => left - right);
  const durationMs = accepted.reduce((total, frameTime) => total + frameTime, 0);
  const slowFrames = accepted.filter((frameTime) => frameTime >= slowFrameThresholdMs).length;
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);

  return {
    durationMs,
    frameCount: accepted.length,
    meanFrameTimeMs: durationMs / accepted.length,
    frameTimeP95Ms: sorted[p95Index],
    slowFrameRatio: slowFrames / accepted.length,
  };
}

export function classifyScenicPerformance(
  observation: ScenicPerformanceWindow,
  config: Readonly<AdaptiveScenicQualityConfig> = DEFAULT_ADAPTIVE_SCENIC_QUALITY_CONFIG,
): ScenicPerformanceSignal {
  if (!(
    Number.isFinite(observation.durationMs)
    && observation.durationMs >= config.minimumWindowDurationMs
    && Number.isFinite(observation.frameCount)
    && observation.frameCount > 0
    && Number.isFinite(observation.meanFrameTimeMs)
    && observation.meanFrameTimeMs > 0
    && Number.isFinite(observation.frameTimeP95Ms)
    && observation.frameTimeP95Ms > 0
    && Number.isFinite(observation.slowFrameRatio)
    && observation.slowFrameRatio >= 0
    && observation.slowFrameRatio <= 1
  )) return 'neutral';

  if (
    observation.frameTimeP95Ms >= config.overloadFrameTimeP95Ms
    || observation.slowFrameRatio >= config.overloadSlowFrameRatio
  ) return 'overloaded';

  if (
    observation.frameTimeP95Ms <= config.recoveryFrameTimeP95Ms
    && observation.slowFrameRatio <= config.recoverySlowFrameRatio
  ) return 'healthy';

  return 'neutral';
}

function transitionKind(fromLevel: number, toLevel: number): 'resolution' | 'features' {
  const from = SCENIC_QUALITY_STAGES[fromLevel];
  const to = SCENIC_QUALITY_STAGES[toLevel];
  const featuresMatch = from.featureTier === to.featureTier
    && from.motionScale === to.motionScale
    && from.useEnvironmentMap === to.useEnvironmentMap
    && from.useSurfaceDetailMaps === to.useSurfaceDetailMaps
    && from.propDensity === to.propDensity
    && from.particleDensity === to.particleDensity
    && from.maximumPanoramaFaceSize === to.maximumPanoramaFaceSize
    && from.legacyLowDetail === to.legacyLowDetail;
  return featuresMatch ? 'resolution' : 'features';
}

export function updateAdaptiveScenicQuality(
  state: AdaptiveScenicQualityState,
  observation: ScenicPerformanceWindow,
): AdaptiveScenicQualityDecision {
  const signal = classifyScenicPerformance(observation, state.config);

  // High and Efficient are rider-selected fixed modes. Avoid per-window state
  // churn while still exposing the current performance signal to diagnostics.
  if (state.mode !== 'auto') {
    return { state, signal, transition: null };
  }

  const durationMs = Math.max(0, finiteOr(observation.durationMs, 0));
  const cooldownRemainingMs = Math.max(0, state.cooldownRemainingMs - durationMs);
  const nextBase: AdaptiveScenicQualityState = {
    ...state,
    cooldownRemainingMs,
    elapsedObservedMs: state.elapsedObservedMs + durationMs,
    overloadWindowStreak: signal === 'overloaded' ? state.overloadWindowStreak + 1 : 0,
    recoveryWindowStreak: signal === 'healthy' ? state.recoveryWindowStreak + 1 : 0,
  };

  const canDegrade = signal === 'overloaded'
    && nextBase.overloadWindowStreak >= state.config.overloadWindowsBeforeDegrade
    && cooldownRemainingMs === 0
    && state.level < SCENIC_QUALITY_STAGES.length - 1;
  const canRestore = signal === 'healthy'
    && nextBase.recoveryWindowStreak >= state.config.recoveryWindowsBeforeRestore
    && cooldownRemainingMs === 0
    && state.level > 0;

  if (!canDegrade && !canRestore) {
    return { state: nextBase, signal, transition: null };
  }

  const direction = canDegrade ? 'degrade' : 'restore';
  const toLevel = clamp(state.level + (canDegrade ? 1 : -1), 0, SCENIC_QUALITY_STAGES.length - 1);
  const nextState: AdaptiveScenicQualityState = {
    ...nextBase,
    level: toLevel,
    overloadWindowStreak: 0,
    recoveryWindowStreak: 0,
    cooldownRemainingMs: canDegrade ? state.config.degradeCooldownMs : state.config.restoreCooldownMs,
    transitionCount: state.transitionCount + 1,
  };

  return {
    state: nextState,
    signal,
    transition: {
      direction,
      fromLevel: state.level,
      toLevel,
      changed: transitionKind(state.level, toLevel),
    },
  };
}

/** Derives renderer settings without touching browser or Three.js state. */
export function deriveScenicRenderPlan(
  state: AdaptiveScenicQualityState,
  environment: ScenicQualityEnvironment,
): ScenicRenderPlan {
  const level = clamp(Math.round(state.level), 0, SCENIC_QUALITY_STAGES.length - 1);
  const stage = SCENIC_QUALITY_STAGES[level];
  const cssWidth = Math.max(1, finiteOr(environment.cssWidth, 1));
  const cssHeight = Math.max(1, finiteOr(environment.cssHeight, 1));
  const devicePixelRatio = clamp(finiteOr(environment.devicePixelRatio, 1), 0.25, 4);
  const pixelBudgetDpr = Math.sqrt(state.config.maximumCanvasPixels / (cssWidth * cssHeight));
  const uncappedBaseDpr = Math.min(devicePixelRatio, state.config.preferredDpr);
  const baseDpr = Math.min(uncappedBaseDpr, pixelBudgetDpr);
  const scaledDpr = baseDpr * stage.resolutionScale;
  const targetDpr = Math.floor(Math.min(
    baseDpr,
    Math.max(state.config.minimumDpr, scaledDpr),
  ) * 1_000) / 1_000;
  const internalWidth = Math.max(1, Math.floor(cssWidth * targetDpr));
  const internalHeight = Math.max(1, Math.floor(cssHeight * targetDpr));
  const reducedMotion = Boolean(environment.prefersReducedMotion);

  return {
    ...stage,
    level,
    motionScale: reducedMotion ? 0 : stage.motionScale,
    targetDpr,
    internalWidth,
    internalHeight,
    estimatedCanvasPixels: internalWidth * internalHeight,
    pixelBudgetLimited: baseDpr < uncappedBaseDpr - 0.001,
  };
}

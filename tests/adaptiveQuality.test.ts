import { describe, expect, it } from 'vitest';
import {
  SCENIC_QUALITY_STAGES,
  classifyScenicPerformance,
  createAdaptiveScenicQualityState,
  deriveScenicRenderPlan,
  setAdaptiveScenicQualityMode,
  summarizeScenicFrameTimes,
  updateAdaptiveScenicQuality,
  type AdaptiveScenicQualityState,
  type ScenicPerformanceWindow,
  type ScenicQualityEnvironment,
} from '../src/scenic/adaptiveQuality';

const desktop: ScenicQualityEnvironment = {
  cssWidth: 1_920,
  cssHeight: 1_080,
  devicePixelRatio: 2,
  hardwareConcurrency: 10,
  deviceMemoryGb: 16,
  prefersReducedMotion: false,
};

function observation(
  frameTimeP95Ms: number,
  slowFrameRatio: number,
  durationMs = 2_000,
): ScenicPerformanceWindow {
  return {
    durationMs,
    frameCount: 120,
    meanFrameTimeMs: frameTimeP95Ms * 0.8,
    frameTimeP95Ms,
    slowFrameRatio,
  };
}

function updateMany(
  initialState: AdaptiveScenicQualityState,
  windows: readonly ScenicPerformanceWindow[],
): AdaptiveScenicQualityState {
  return windows.reduce(
    (state, window) => updateAdaptiveScenicQuality(state, window).state,
    initialState,
  );
}

describe('adaptive scenic quality initialization', () => {
  it('starts visually rich and enforces the canvas pixel budget', () => {
    const environment = { ...desktop, cssWidth: 3_840, cssHeight: 2_160 };
    const state = createAdaptiveScenicQualityState(environment);
    const plan = deriveScenicRenderPlan(state, environment);

    expect(state).toMatchObject({ level: 0, initialReason: 'full-fidelity' });
    expect(plan).toMatchObject({
      featureTier: 'rich',
      useEnvironmentMap: true,
      useSurfaceDetailMaps: true,
      propDensity: 1,
      pixelBudgetLimited: true,
    });
    expect(plan.estimatedCanvasPixels).toBeLessThanOrEqual(5_000_000);
    expect(plan.targetDpr).toBeLessThan(1);
  });

  it('uses resolution-only initial safeguards for low hardware and honors reduced motion', () => {
    const limited = { ...desktop, hardwareConcurrency: 4 };
    const reduced = { ...desktop, prefersReducedMotion: true };
    const limitedState = createAdaptiveScenicQualityState(limited);
    const reducedState = createAdaptiveScenicQualityState(reduced);

    expect(limitedState).toMatchObject({ level: 2, initialReason: 'limited-hardware' });
    expect(deriveScenicRenderPlan(limitedState, limited)).toMatchObject({
      featureTier: 'rich',
      propDensity: 1,
      useEnvironmentMap: true,
    });
    expect(reducedState).toMatchObject({ level: 1, initialReason: 'reduced-motion' });
    expect(deriveScenicRenderPlan(reducedState, reduced).motionScale).toBe(0);
  });

  it('supports fixed high and efficient modes while retaining hard safety limits', () => {
    const constrained = { ...desktop, hardwareConcurrency: 2, qualityMode: 'high' as const };
    const highState = createAdaptiveScenicQualityState(constrained);
    const efficientState = setAdaptiveScenicQualityMode(highState, 'efficient', constrained);

    expect(highState).toMatchObject({ mode: 'high', level: 0 });
    const fixedDecision = updateAdaptiveScenicQuality(highState, observation(40, 0.8));
    expect(fixedDecision.state).toBe(highState);
    expect(efficientState).toMatchObject({ mode: 'efficient', level: 7 });
    expect(deriveScenicRenderPlan(efficientState, constrained).legacyLowDetail).toBe(true);
    expect(deriveScenicRenderPlan(efficientState, constrained).estimatedCanvasPixels)
      .toBeLessThanOrEqual(5_000_000);
  });
});

describe('adaptive scenic quality decisions', () => {
  it('recognizes a healthy 60 Hz trace and can restore quality from it', () => {
    const sixtyHertzFrames = Array.from({ length: 120 }, () => 1_000 / 60);
    const summary = summarizeScenicFrameTimes(sixtyHertzFrames);
    expect(summary).not.toBeNull();

    let state = createAdaptiveScenicQualityState(desktop, {
      recoveryWindowsBeforeRestore: 2,
      restoreCooldownMs: 0,
    });
    state = { ...state, level: 2 };

    expect(classifyScenicPerformance(summary!, state.config)).toBe('healthy');
    state = updateAdaptiveScenicQuality(state, summary!).state;
    expect(state.level).toBe(2);
    const decision = updateAdaptiveScenicQuality(state, summary!);
    expect(decision).toMatchObject({
      signal: 'healthy',
      transition: { direction: 'restore', fromLevel: 2, toLevel: 1 },
    });
  });

  it('requires sustained overload before degrading and resets a broken streak', () => {
    let state = createAdaptiveScenicQualityState(desktop);
    const overloaded = observation(24, 0.3);
    const neutral = observation(18, 0.08);

    state = updateAdaptiveScenicQuality(state, overloaded).state;
    state = updateAdaptiveScenicQuality(state, neutral).state;
    state = updateMany(state, [overloaded, overloaded]);
    expect(state.level).toBe(0);

    const decision = updateAdaptiveScenicQuality(state, overloaded);
    expect(decision).toMatchObject({
      signal: 'overloaded',
      transition: {
        direction: 'degrade',
        fromLevel: 0,
        toLevel: 1,
        changed: 'resolution',
      },
    });
  });

  it('degrades DPR three times before reducing visual features', () => {
    let state = createAdaptiveScenicQualityState(desktop, {
      overloadWindowsBeforeDegrade: 1,
      degradeCooldownMs: 0,
    });
    const overloaded = observation(25, 0.4);

    for (let expectedLevel = 1; expectedLevel <= 3; expectedLevel += 1) {
      const previousPlan = deriveScenicRenderPlan(state, desktop);
      const decision = updateAdaptiveScenicQuality(state, overloaded);
      state = decision.state;
      const nextPlan = deriveScenicRenderPlan(state, desktop);
      expect(state.level).toBe(expectedLevel);
      expect(decision.transition?.changed).toBe('resolution');
      expect(nextPlan.targetDpr).toBeLessThan(previousPlan.targetDpr);
      expect(nextPlan).toMatchObject({
        featureTier: 'rich',
        motionScale: 1,
        useEnvironmentMap: true,
        useSurfaceDetailMaps: true,
        propDensity: 1,
      });
    }

    const featureDecision = updateAdaptiveScenicQuality(state, overloaded);
    const featurePlan = deriveScenicRenderPlan(featureDecision.state, desktop);
    expect(featureDecision.transition).toMatchObject({ changed: 'features', toLevel: 4 });
    expect(featurePlan).toMatchObject({
      featureTier: 'balanced',
      useEnvironmentMap: true,
      useSurfaceDetailMaps: true,
      propDensity: 1,
    });
    expect(featurePlan.motionScale).toBeLessThan(1);
  });

  it('honors the degradation cooldown between consecutive quality changes', () => {
    const overloaded = observation(25, 0.4);
    let state = createAdaptiveScenicQualityState(desktop);
    state = updateMany(state, [overloaded, overloaded, overloaded]);
    expect(state).toMatchObject({ level: 1, cooldownRemainingMs: 8_000 });

    state = updateMany(state, [overloaded, overloaded, overloaded]);
    expect(state.level).toBe(1);
    expect(state.cooldownRemainingMs).toBe(2_000);

    state = updateAdaptiveScenicQuality(state, overloaded).state;
    expect(state).toMatchObject({ level: 2, cooldownRemainingMs: 8_000 });
  });

  it('restores one step only after a much longer healthy streak', () => {
    const overloaded = observation(25, 0.4);
    const healthy = observation(14, 0.01);
    let state = createAdaptiveScenicQualityState(desktop, {
      overloadWindowsBeforeDegrade: 1,
      recoveryWindowsBeforeRestore: 5,
      degradeCooldownMs: 0,
      restoreCooldownMs: 0,
    });
    state = updateMany(state, Array.from({ length: 5 }, () => overloaded));
    expect(state.level).toBe(5);

    state = updateMany(state, Array.from({ length: 4 }, () => healthy));
    expect(state.level).toBe(5);

    const decision = updateAdaptiveScenicQuality(state, healthy);
    expect(decision.transition).toMatchObject({
      direction: 'restore',
      fromLevel: 5,
      toLevel: 4,
      changed: 'features',
    });
  });

  it('is deterministic for identical environments and observation streams', () => {
    const windows = [
      observation(24, 0.25),
      observation(23, 0.2),
      observation(25, 0.3),
      observation(18, 0.06),
      observation(14, 0.01),
    ];
    const first = updateMany(createAdaptiveScenicQualityState(desktop), windows);
    const second = updateMany(createAdaptiveScenicQualityState(desktop), windows);
    expect(first).toEqual(second);
    expect(deriveScenicRenderPlan(first, desktop)).toEqual(deriveScenicRenderPlan(second, desktop));
  });
});

describe('scenic frame summaries', () => {
  it('calculates deterministic p95 and slow-frame ratios without mutating input', () => {
    const frames = Array.from({ length: 100 }, (_, index) => index < 90 ? 16 : 24);
    const before = [...frames];
    const summary = summarizeScenicFrameTimes(frames, { slowFrameThresholdMs: 20 });

    expect(frames).toEqual(before);
    expect(summary).toMatchObject({
      durationMs: 1_680,
      frameCount: 100,
      meanFrameTimeMs: 16.8,
      frameTimeP95Ms: 24,
      slowFrameRatio: 0.1,
    });
  });

  it('rejects unusable samples and caps exceptional frame gaps', () => {
    expect(summarizeScenicFrameTimes([0, -4, Number.NaN])).toBeNull();
    expect(summarizeScenicFrameTimes([16, 2_000], { maximumFrameTimeMs: 100 })).toMatchObject({
      durationMs: 116,
      frameTimeP95Ms: 100,
      slowFrameRatio: 0.5,
    });
  });

  it('keeps every quality stage within valid visual ranges', () => {
    for (const stage of SCENIC_QUALITY_STAGES) {
      expect(stage.resolutionScale).toBeGreaterThan(0);
      expect(stage.resolutionScale).toBeLessThanOrEqual(1);
      expect(stage.motionScale).toBeGreaterThanOrEqual(0);
      expect(stage.motionScale).toBeLessThanOrEqual(1);
      expect(stage.propDensity).toBeGreaterThan(0);
      expect(stage.propDensity).toBeLessThanOrEqual(1);
    }
  });
});

import type { TelemetrySample, TrainerConnectionState } from '../types/cycling';

export const TRAINER_TELEMETRY_TIMEOUT_MS = 2_500;

export function hasFreshTrainerTelemetry(
  sample: TelemetrySample,
  connectionState: TrainerConnectionState,
  nowMs: number,
  timeoutMs: number = TRAINER_TELEMETRY_TIMEOUT_MS,
): boolean {
  const ageMs = nowMs - sample.timestamp;
  return connectionState === 'connected'
    && Number.isFinite(sample.timestamp)
    && ageMs >= 0
    && ageMs <= timeoutMs;
}

export function makeTrainerTelemetrySafe(
  sample: TelemetrySample,
  connectionState: TrainerConnectionState,
  nowMs: number,
  timeoutMs: number = TRAINER_TELEMETRY_TIMEOUT_MS,
): TelemetrySample {
  if (hasFreshTrainerTelemetry(sample, connectionState, nowMs, timeoutMs)) return sample;

  return {
    ...sample,
    powerWatts: 0,
    cadenceRpm: 0,
    flywheelSpeedKph: 0,
  };
}

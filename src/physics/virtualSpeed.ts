import { RiderProfile } from '../types/cycling';

export const DEFAULT_RIDER_PROFILE: RiderProfile = {
  riderWeightKg: 75.0,
  bikeWeightKg: 8.0,
  drivetrainEfficiency: 0.97,
  crr: 0.004,
  cda: 0.32,
  airDensity: 1.225,
};

export class VirtualSpeedEngine {
  private profile: RiderProfile;
  private currentSpeedMps: number = 0;
  private smoothedPowerWatts: number = 0;
  private readonly timeConstantTauSeconds: number = 2.5; // True 2.5 second EMA time constant
  private readonly vFloor: number = 0.5; // m/s (~1.8 km/h floor to prevent div by 0)
  private readonly maxAcceleration: number = 4.0; // m/s^2 clamp
  private readonly maxDeceleration: number = -6.0; // m/s^2 clamp

  constructor(profile: RiderProfile = DEFAULT_RIDER_PROFILE) {
    this.profile = profile;
  }

  public updateProfile(newProfile: Partial<RiderProfile>) {
    this.profile = { ...this.profile, ...newProfile };
  }

  public reset() {
    this.currentSpeedMps = 0;
    this.smoothedPowerWatts = 0;
  }

  public restore(speedKph: number, powerWatts: number = 0) {
    this.currentSpeedMps = Math.max(0, speedKph / 3.6);
    this.smoothedPowerWatts = Math.max(0, powerWatts);
  }

  /**
   * Integrate 1 timestep (e.g. dt = 0.1s at 10Hz)
   * dv/dt = (eta * P / max(v, v_floor) - F_g - F_rr - F_aero) / m
   */
  public step(rawPowerWatts: number, gradePercent: number, dtSeconds: number, headwindMps: number = 0): {
    speedKph: number;
    speedMps: number;
    distanceDeltaMeters: number;
  } {
    // True time-constant based Exponential Moving Average: alpha = 1 - exp(-dt / tau)
    const alpha = 1 - Math.exp(-dtSeconds / this.timeConstantTauSeconds);
    this.smoothedPowerWatts = (alpha * rawPowerWatts) + ((1 - alpha) * this.smoothedPowerWatts);

    const totalMass = this.profile.riderWeightKg + this.profile.bikeWeightKg;
    const g = 9.81;
    const theta = Math.atan(gradePercent / 100);

    // Forces (in Newtons)
    const F_gravity = totalMass * g * Math.sin(theta);
    const F_rolling = totalMass * g * this.profile.crr * Math.cos(theta);
    
    const relativeAirSpeed = this.currentSpeedMps + headwindMps;
    const F_aero = 0.5 * this.profile.airDensity * this.profile.cda * relativeAirSpeed * Math.abs(relativeAirSpeed);

    // Drive Force from Power (Watts)
    const effectivePower = Math.max(0, this.smoothedPowerWatts) * this.profile.drivetrainEfficiency;
    const effectiveSpeed = Math.max(this.currentSpeedMps, this.vFloor);
    const F_drive = effectivePower / effectiveSpeed;

    // Net Force & Acceleration (F_net = m * a)
    const F_net = F_drive - F_gravity - F_rolling - F_aero;
    let acceleration = F_net / totalMass;

    // Clamp acceleration to physically realistic ranges
    acceleration = Math.max(this.maxDeceleration, Math.min(this.maxAcceleration, acceleration));

    // Update velocity
    this.currentSpeedMps = Math.max(0, this.currentSpeedMps + (acceleration * dtSeconds));

    // Coasting stop threshold: if power is 0 and speed is tiny, bring to full stop
    if (rawPowerWatts === 0 && this.currentSpeedMps < 0.2) {
      this.currentSpeedMps = 0;
    }

    const distanceDeltaMeters = this.currentSpeedMps * dtSeconds;
    const speedKph = this.currentSpeedMps * 3.6;

    return {
      speedKph,
      speedMps: this.currentSpeedMps,
      distanceDeltaMeters,
    };
  }

  /**
   * Integrate real elapsed time in stable substeps. Browser timers can be delayed
   * substantially in a background tab; discarding that delay corrupts distance.
   */
  public advance(rawPowerWatts: number, gradePercent: number, elapsedSeconds: number, headwindMps: number = 0): {
    speedKph: number;
    speedMps: number;
    distanceDeltaMeters: number;
  } {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return {
        speedKph: this.currentSpeedMps * 3.6,
        speedMps: this.currentSpeedMps,
        distanceDeltaMeters: 0,
      };
    }

    const maxStepSeconds = 0.25;
    let remainingSeconds = elapsedSeconds;
    let distanceDeltaMeters = 0;
    let result = {
      speedKph: this.currentSpeedMps * 3.6,
      speedMps: this.currentSpeedMps,
      distanceDeltaMeters: 0,
    };

    while (remainingSeconds > 0) {
      const stepSeconds = Math.min(maxStepSeconds, remainingSeconds);
      result = this.step(rawPowerWatts, gradePercent, stepSeconds, headwindMps);
      distanceDeltaMeters += result.distanceDeltaMeters;
      remainingSeconds -= stepSeconds;
    }

    return { ...result, distanceDeltaMeters };
  }

  public getCurrentSpeedKph(): number {
    return this.currentSpeedMps * 3.6;
  }
}

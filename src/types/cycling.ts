export interface TelemetrySample {
  treadmillInclinePercent?: number;
  timestamp: number;          // UTC epoch ms
  activeTimeSeconds?: number; // Pause-free ride clock; absent in legacy recordings
  powerWatts: number;         // Instantaneous Power (W)
  cadenceRpm: number;         // Cadence (RPM)
  flywheelSpeedKph: number;   // Raw trainer flywheel speed (km/h)
  virtualSpeedKph: number;    // Physics-calculated road speed (km/h)
  distanceMeters: number;     // Total cumulative virtual distance (m)
  heartRateBpm?: number;      // Heart rate if paired
  gradePercent: number;       // Current road grade (%)
  elevationMeters: number;    // Current altitude (m)
  lat?: number;               // GPS Latitude
  lng?: number;               // GPS Longitude
}

export interface RiderProfile {
  riderWeightKg: number;      // e.g. 75 kg
  bikeWeightKg: number;       // e.g. 8 kg
  drivetrainEfficiency: number; // e.g. 0.97
  crr: number;                // Rolling resistance e.g. 0.004
  cda: number;                // Aero drag area e.g. 0.32
  airDensity: number;         // e.g. 1.225 kg/m^3
}

export type TrainerControlMode = 'route' | 'erg';

export interface TrainerCapabilities {
  simulation: boolean | null;
  targetPower: boolean | null;
  control: boolean;
}

export type TrainerConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface TrainerConnectionStatus {
  state: TrainerConnectionState;
  attempt?: number;
  maxAttempts?: number;
  message?: string;
}

export interface ITrainer {
  readonly activityType?: 'cycling' | 'running';
  readonly isConnected: boolean;
  readonly deviceName: string;
  readonly capabilities: TrainerCapabilities;
  readonly connectionStatus: TrainerConnectionStatus;
  connect(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  onTelemetry(callback: (sample: TelemetrySample) => void): () => void;
  onConnectionState(callback: (status: TrainerConnectionStatus) => void): () => void;
  setGrade(gradePercent: number): Promise<void>;
  setTargetPower(watts: number): Promise<void>;
  neutralize(): Promise<void>;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  elevation: number;          // meters
  cumulativeDistance: number; // meters from start
  grade: number;              // local slope percentage (%)
  heading: number;            // 0-360 degrees
}

export interface RouteModel {
  synthetic?: boolean;
  id: string;
  name: string;
  totalDistanceMeters: number;
  totalElevationGainMeters: number;
  points: RoutePoint[];
}

export type RideState = 'idle' | 'riding' | 'paused' | 'finished';

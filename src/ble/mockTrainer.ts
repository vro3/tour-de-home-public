import {
  ITrainer,
  TelemetrySample,
  TrainerCapabilities,
  TrainerConnectionStatus,
  TrainerControlMode,
} from '../types/cycling';

export class MockTrainer implements ITrainer {
  public isConnected: boolean = false;
  public deviceName: string = 'Mock Trainer (Simulator)';
  public connectionStatus: TrainerConnectionStatus = { state: 'disconnected' };
  public readonly capabilities: TrainerCapabilities = {
    simulation: true,
    targetPower: true,
    control: true,
  };
  
  private telemetryCallback: ((sample: TelemetrySample) => void) | null = null;
  private connectionCallbacks = new Set<(status: TrainerConnectionStatus) => void>();
  private intervalId: number | null = null;
  
  // Controllable parameters (default 220W matching App.tsx)
  public targetWatts: number = 220;
  public targetCadence: number = 90;
  public currentGrade: number = 0;
  public controlMode: TrainerControlMode = 'route';
  private ergTargetWatts: number = 200;
  private cumulativeDistanceMeters: number = 0;

  public async connect(): Promise<void> {
    this.emitConnectionState({ state: 'connecting', message: 'Starting simulator…' });
    this.isConnected = true;
    this.startStreaming();
    this.emitConnectionState({ state: 'connected' });
  }

  public async reconnect(): Promise<void> {
    await this.connect();
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.emitConnectionState({ state: 'disconnected' });
  }

  public onTelemetry(callback: (sample: TelemetrySample) => void): () => void {
    this.telemetryCallback = callback;
    return () => {
      if (this.telemetryCallback === callback) this.telemetryCallback = null;
    };
  }

  public onConnectionState(callback: (status: TrainerConnectionStatus) => void): () => void {
    this.connectionCallbacks.add(callback);
    callback(this.connectionStatus);
    return () => this.connectionCallbacks.delete(callback);
  }

  public async setGrade(gradePercent: number): Promise<void> {
    this.currentGrade = gradePercent;
    this.controlMode = 'route';
  }

  public async setTargetPower(watts: number): Promise<void> {
    this.ergTargetWatts = Math.max(25, Math.min(1000, Math.round(watts)));
    this.controlMode = 'erg';
  }

  public async neutralize(): Promise<void> {
    this.currentGrade = 0;
    this.ergTargetWatts = 25;
    this.controlMode = 'route';
  }

  public setPower(watts: number) {
    this.targetWatts = Math.max(0, watts);
  }

  public setCadence(rpm: number) {
    this.targetCadence = Math.max(0, rpm);
  }

  private startStreaming() {
    if (this.intervalId !== null) clearInterval(this.intervalId);

    this.intervalId = window.setInterval(() => {
      if (!this.isConnected || !this.telemetryCallback) return;

      const noise = (Math.random() - 0.5) * 4;
      const requestedWatts = this.controlMode === 'erg' ? this.ergTargetWatts : this.targetWatts;
      const liveWatts = requestedWatts > 0 ? Math.max(0, Math.round(requestedWatts + noise)) : 0;
      const liveCadence = this.targetCadence > 0 ? Math.max(0, Math.round(this.targetCadence + (noise * 0.5))) : 0;
      
      const flywheelSpeedKph = liveCadence > 0 ? (liveCadence / 90) * 32 : 0;

      const sample: TelemetrySample = {
        timestamp: Date.now(),
        powerWatts: liveWatts,
        cadenceRpm: liveCadence,
        flywheelSpeedKph,
        virtualSpeedKph: 0,
        distanceMeters: this.cumulativeDistanceMeters,
        gradePercent: this.currentGrade,
        elevationMeters: 0,
      };

      this.telemetryCallback(sample);
    }, 1000);
  }

  private emitConnectionState(status: TrainerConnectionStatus) {
    this.connectionStatus = status;
    for (const callback of this.connectionCallbacks) callback(status);
  }
}

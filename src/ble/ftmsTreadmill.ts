import type { ITrainer, TelemetrySample, TrainerConnectionStatus } from '../types/cycling';

// Bluetooth SIG Fitness Machine Service / Treadmill Data. This collector never opens a control point.
export function parseTreadmillData(value: DataView): { speedKph?: number; incline?: number; heartRate?: number } | null {
  if (value.byteLength < 2) return null;
  const flags = value.getUint16(0, true);
  let offset = 2;
  const result: { speedKph?: number; incline?: number; heartRate?: number } = {};
  const read = (size: number) => { if (offset + size > value.byteLength) throw new Error('truncated'); const at = offset; offset += size; return at; };
  try {
    if (!(flags & 1)) result.speedKph = value.getUint16(read(2), true) / 100;
    if (flags & 2) read(2); // Average speed
    if (flags & 4) read(3); // Total distance: never use lifetime distance as course distance
    if (flags & 8) { result.incline = value.getInt16(read(2), true) / 10; read(2); }
    if (flags & 16) read(4); // Positive/negative elevation gain
    if (flags & 32) read(1); // Instantaneous pace
    if (flags & 64) read(1); // Average pace
    if (flags & 128) read(5); // Energy
    if (flags & 256) result.heartRate = value.getUint8(read(1));
    if (flags & 512) read(1); // Metabolic equivalent
    if (flags & 1024) read(2); // Elapsed time
    if (flags & 2048) read(2); // Remaining time
    if (flags & 4096) read(4); // Force and power
  } catch { return null; }
  if (result.speedKph !== undefined && (result.speedKph > 60 || !Number.isFinite(result.speedKph))) return null;
  return result;
}

export class FtmsTreadmill implements ITrainer {
  readonly activityType = 'running' as const;
  readonly capabilities = { simulation: false, targetPower: false, control: false };
  isConnected = false;
  deviceName = 'FTMS Treadmill';
  connectionStatus: TrainerConnectionStatus = { state: 'disconnected' };
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private telemetry: ((sample: TelemetrySample) => void) | null = null;
  private listeners = new Set<(status: TrainerConnectionStatus) => void>();
  private generation = 0;
  private stopped = false;
  private incline?: number;
  private heartRate?: number;
  private changed = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const data = parseTreadmillData(value);
    if (!data) return;
    this.incline = data.incline ?? this.incline;
    this.heartRate = data.heartRate ?? this.heartRate;
    // More Data packets may omit speed. They must not refresh the speed's freshness clock.
    if (data.speedKph === undefined) return;
    this.telemetry?.({ timestamp: Date.now(), powerWatts: 0, cadenceRpm: 0,
      flywheelSpeedKph: data.speedKph, virtualSpeedKph: data.speedKph, distanceMeters: 0,
      gradePercent: 0, treadmillInclinePercent: this.incline, elevationMeters: 0, heartRateBpm: this.heartRate });
  };
  private dropped = () => {
    this.detach();
    if (this.stopped) return;
    const generation = ++this.generation;
    this.emit({ state: 'reconnecting', message: 'Treadmill signal lost. Activity paused; use the treadmill controls to stop the belt.' });
    void this.retry(generation);
  };
  private emit(status: TrainerConnectionStatus) {
    this.connectionStatus = status;
    this.isConnected = status.state === 'connected';
    this.listeners.forEach(cb => cb(status));
  }
  private detach() {
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.changed);
    this.characteristic = null;
    this.isConnected = false;
    this.incline = undefined;
    this.heartRate = undefined;
  }
  private async attach(generation: number) {
    if (!this.device?.gatt) throw new Error('Treadmill Bluetooth is unavailable.');
    this.detach();
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(0x1826);
    const characteristic = await service.getCharacteristic(0x2acd);
    await characteristic.startNotifications();
    if (generation !== this.generation || this.stopped) {
      await characteristic.stopNotifications().catch(() => {});
      return;
    }
    this.characteristic = characteristic;
    characteristic.addEventListener('characteristicvaluechanged', this.changed);
    this.emit({ state: 'connected' });
  }
  async connect() {
    if (!navigator.bluetooth) throw new Error('Treadmill sync requires Web Bluetooth in Chrome or Edge.');
    this.stopped = false;
    const generation = ++this.generation;
    this.emit({ state: 'connecting' });
    try {
      this.device?.removeEventListener('gattserverdisconnected', this.dropped);
      this.device?.gatt?.disconnect();
      this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x1826] }] });
      this.deviceName = this.device.name || 'FTMS Treadmill';
      this.device.addEventListener('gattserverdisconnected', this.dropped);
      await this.attach(generation);
    } catch (e) {
      await this.disconnect();
      this.emit({ state: 'failed', message: 'Could not read FTMS Treadmill Data. Choose a treadmill that broadcasts standard FTMS data.' });
      throw e;
    }
  }
  private async retry(generation: number) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      if (generation !== this.generation || this.stopped) return;
      try { await this.attach(generation); return; } catch { if (generation !== this.generation || this.stopped) return; this.detach(); }
    }
    if (generation === this.generation && !this.stopped) this.emit({ state: 'failed', message: 'Treadmill reconnect failed. Retry when ready; the comparison remains paused.' });
  }
  async reconnect() {
    if (!this.device) return this.connect();
    this.stopped = false;
    const generation = ++this.generation;
    this.emit({ state: 'connecting' });
    try { await this.attach(generation); }
    catch (e) { this.emit({ state: 'failed', message: 'Treadmill reconnect failed.' }); throw e; }
  }
  async disconnect() {
    this.stopped = true;
    ++this.generation;
    this.detach();
    this.device?.removeEventListener('gattserverdisconnected', this.dropped);
    this.device?.gatt?.disconnect();
    this.emit({ state: 'disconnected' });
  }
  onTelemetry(callback: (sample: TelemetrySample) => void) { this.telemetry = callback; return () => { this.telemetry = null; }; }
  onConnectionState(callback: (status: TrainerConnectionStatus) => void) { this.listeners.add(callback); callback(this.connectionStatus); return () => { this.listeners.delete(callback); }; }
  async setGrade() { throw new Error('Adjust incline on the treadmill console.'); }
  async setTargetPower() { throw new Error('Treadmills do not support cycling ERG control.'); }
  async neutralize() { /* Read-only: never stop/start or change a moving belt remotely. */ }
}

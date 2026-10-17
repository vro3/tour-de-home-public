import {
  ITrainer,
  TelemetrySample,
  TrainerCapabilities,
  TrainerConnectionStatus,
} from '../types/cycling';

// Standard Bluetooth SIG UUIDs for Fitness Machine Service
const FTMS_SERVICE_UUID = 0x1826;
const FTMS_FEATURE_UUID = 0x2ACC;
const INDOOR_BIKE_DATA_UUID = 0x2AD2;
const CONTROL_POINT_UUID = 0x2AD9;
const REQUEST_CONTROL = 0x00;
const SET_TARGET_POWER = 0x05;
const STOP_OR_PAUSE = 0x08;
const SET_SIMULATION_PARAMETERS = 0x11;

const POWER_TARGET_SETTING_BIT = 3;
const SIMULATION_TARGET_SETTING_BIT = 13;
// Eight waits of 2, 4, 6, 8, then 10 seconds keep recovery active for one minute.
const MAX_RECONNECT_ATTEMPTS = 8;
const RECONNECT_BASE_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

function reconnectDelayMs(attempt: number): number {
  return Math.min(attempt * RECONNECT_BASE_DELAY_MS, MAX_RECONNECT_DELAY_MS);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Bluetooth error.';
}

export function makeTargetPowerPayload(watts: number): Uint8Array {
  const clampedWatts = Math.max(25, Math.min(1000, Math.round(watts)));
  const buffer = new ArrayBuffer(3);
  const view = new DataView(buffer);
  view.setUint8(0, SET_TARGET_POWER);
  view.setInt16(1, clampedWatts, true);
  return new Uint8Array(buffer);
}

export function makePausePayload(): Uint8Array {
  // FTMS Stop or Pause parameter 0x02 requests Pause. Unlike a low ERG
  // target, this does not intentionally leave the trainer applying load.
  return new Uint8Array([STOP_OR_PAUSE, 0x02]);
}

export function makeSimulationPayload(
  windMps: number = 0,
  gradePercent: number = 0,
  crr: number = 0.004,
  cwKgPerM: number = 0.30
): Uint8Array {
  const buffer = new ArrayBuffer(7);
  const view = new DataView(buffer);
  
  view.setUint8(0, SET_SIMULATION_PARAMETERS); // OpCode: Set Indoor Bike Simulation Parameters
  view.setInt16(1, Math.round(windMps * 1000), true); // Little-endian, resolution 0.001 m/s
  view.setInt16(3, Math.round(gradePercent * 100), true); // Little-endian, resolution 0.01%
  view.setUint8(5, Math.round(crr * 10_000)); // Resolution 0.0001
  view.setUint8(6, Math.round(cwKgPerM * 100)); // Resolution 0.01 kg/m
  
  return new Uint8Array(buffer);
}

export interface ParsedIndoorBikeData {
  instantaneousSpeedKph: number;
  instantaneousCadenceRpm: number;
  instantaneousPowerWatts: number;
  cumulativeDistanceMeters: number;
  heartRateBpm?: number;
}

export function parseIndoorBikeData(
  value: DataView,
  previousDistanceMeters: number = 0,
): ParsedIndoorBikeData {
  const parsed: ParsedIndoorBikeData = {
    instantaneousSpeedKph: 0,
    instantaneousCadenceRpm: 0,
    instantaneousPowerWatts: 0,
    cumulativeDistanceMeters: previousDistanceMeters,
  };
  if (value.byteLength < 2) return parsed;

  const flags = value.getUint16(0, true);
  let offset = 2;
  const hasBytes = (count: number) => offset + count <= value.byteLength;
  const skip = (count: number) => {
    if (!hasBytes(count)) return false;
    offset += count;
    return true;
  };

  // Bit 0 is inverted by the FTMS specification: zero means instantaneous speed is present.
  if ((flags & (1 << 0)) === 0) {
    if (!hasBytes(2)) return parsed;
    parsed.instantaneousSpeedKph = value.getUint16(offset, true) * 0.01;
    offset += 2;
  }
  if ((flags & (1 << 1)) !== 0 && !skip(2)) return parsed; // Average speed

  if ((flags & (1 << 2)) !== 0) {
    if (!hasBytes(2)) return parsed;
    parsed.instantaneousCadenceRpm = value.getUint16(offset, true) * 0.5;
    offset += 2;
  }
  if ((flags & (1 << 3)) !== 0 && !skip(2)) return parsed; // Average cadence

  if ((flags & (1 << 4)) !== 0) {
    if (!hasBytes(3)) return parsed;
    const b0 = value.getUint8(offset);
    const b1 = value.getUint8(offset + 1);
    const b2 = value.getUint8(offset + 2);
    parsed.cumulativeDistanceMeters = b0 | (b1 << 8) | (b2 << 16);
    offset += 3;
  }
  if ((flags & (1 << 5)) !== 0 && !skip(2)) return parsed; // Resistance level

  if ((flags & (1 << 6)) !== 0) {
    if (!hasBytes(2)) return parsed;
    parsed.instantaneousPowerWatts = value.getInt16(offset, true);
    offset += 2;
  }
  if ((flags & (1 << 7)) !== 0 && !skip(2)) return parsed; // Average power
  if ((flags & (1 << 8)) !== 0 && !skip(5)) return parsed; // Expended energy fields

  if ((flags & (1 << 9)) !== 0) {
    if (!hasBytes(1)) return parsed;
    parsed.heartRateBpm = value.getUint8(offset);
  }

  return parsed;
}

export class FtmsTrainer implements ITrainer {
  public isConnected: boolean = false;
  public deviceName: string = 'Wahoo KICKR CORE';
  public connectionStatus: TrainerConnectionStatus = { state: 'disconnected' };
  public readonly capabilities: TrainerCapabilities = {
    simulation: null,
    targetPower: null,
    control: false,
  };
  
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private controlPointChar: BluetoothRemoteGATTCharacteristic | null = null;
  private bikeDataChar: BluetoothRemoteGATTCharacteristic | null = null;
  
  private telemetryCallback: ((sample: TelemetrySample) => void) | null = null;
  private connectionCallbacks = new Set<(status: TrainerConnectionStatus) => void>();
  private controlQueue: Array<{
    opcode: number;
    payload: Uint8Array;
    resolve: () => void;
    reject: (err: any) => void;
  }> = [];
  private isProcessingQueue: boolean = false;
  private pendingControlResponse: {
    opcode: number;
    resolve: () => void;
    reject: (err: any) => void;
    timerId: number;
  } | null = null;
  
  private currentGrade: number = 0;
  private lastCumulativeDistanceMeters: number = 0;
  private intentionalDisconnect: boolean = false;
  private reconnectGeneration: number = 0;
  private autoReconnectInFlight: boolean = false;
  private readonly handleGattDisconnected = () => {
    this.resetGattConnection();
    if (this.intentionalDisconnect) {
      this.emitConnectionState({ state: 'disconnected' });
      return;
    }

    this.emitConnectionState({
      state: 'reconnecting',
      attempt: 1,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      message: 'Trainer signal lost. Reconnecting…',
    });
    if (!this.autoReconnectInFlight) {
      void this.attemptAutoReconnect(this.reconnectGeneration);
    }
  };
  private readonly handleControlPointChanged = (event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic | null;
    if (characteristic?.value) this.handleControlPointIndication(characteristic.value);
  };
  private readonly handleBikeDataChanged = (event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic | null;
    if (characteristic?.value) this.handleIndoorBikeData(characteristic.value);
  };

  public async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not supported in this browser. Please use Chrome or Edge.');
    }

    this.intentionalDisconnect = false;
    this.reconnectGeneration += 1;
    this.emitConnectionState({ state: 'connecting', message: 'Connecting to trainer…' });

    try {
      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this.handleGattDisconnected);
      }

      // 1. Request user to select FTMS trainer
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE_UUID] }],
        optionalServices: [FTMS_SERVICE_UUID, 0x1818, 0x1816],
      });

      this.deviceName = this.device.name || 'Smart Trainer';
      this.device.addEventListener('gattserverdisconnected', this.handleGattDisconnected);
      await this.initGattConnection();
      this.emitConnectedState();
    } catch (error) {
      this.resetGattConnection();
      this.emitConnectionState({ state: 'failed', message: `Could not connect: ${errorMessage(error)}` });
      throw error;
    }
  }

  public async reconnect(): Promise<void> {
    if (!this.device?.gatt) {
      await this.connect();
      return;
    }

    this.intentionalDisconnect = false;
    this.reconnectGeneration += 1;
    const generation = this.reconnectGeneration;
    this.emitConnectionState({ state: 'connecting', message: 'Retrying trainer connection…' });

    try {
      await this.initGattConnection();
      if (generation !== this.reconnectGeneration || this.intentionalDisconnect) return;
      this.emitConnectedState();
    } catch (error) {
      this.resetGattConnection();
      this.emitConnectionState({ state: 'failed', message: `Reconnect failed: ${errorMessage(error)}` });
      throw error;
    }
  }

  private async initGattConnection(): Promise<void> {
    if (!this.device || !this.device.gatt) {
      throw new Error('Device GATT is unavailable.');
    }

    this.detachCharacteristicListeners();
    this.capabilities.simulation = null;
    this.capabilities.targetPower = null;
    this.capabilities.control = false;
    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(FTMS_SERVICE_UUID);

    // 2. Check Supported Features (0x2ACC)
    try {
      const featureChar = await service.getCharacteristic(FTMS_FEATURE_UUID);
      const featureData = await featureChar.readValue();
      if (featureData.byteLength < 8) {
        throw new Error(`FTMS Feature response is truncated (${featureData.byteLength} bytes).`);
      }
      const targetSettingFeatures = featureData.getUint32(4, true);
      this.capabilities.targetPower = (targetSettingFeatures & (1 << POWER_TARGET_SETTING_BIT)) !== 0;
      this.capabilities.simulation = (targetSettingFeatures & (1 << SIMULATION_TARGET_SETTING_BIT)) !== 0;
      console.log(`[FTMS] Device ${this.deviceName} capabilities:`, this.capabilities);
    } catch (e) {
      console.warn('[FTMS] Could not read feature characteristic:', e);
    }

    // 3. Setup Control Point (0x2AD9)
    try {
      this.controlPointChar = await service.getCharacteristic(CONTROL_POINT_UUID);
      await this.controlPointChar.startNotifications();
      this.controlPointChar.addEventListener('characteristicvaluechanged', this.handleControlPointChanged);

      // Request Control (Opcode 0x00)
      await this.sendControlCommand(new Uint8Array([REQUEST_CONTROL]), REQUEST_CONTROL);
      this.capabilities.control = true;
      console.log('[FTMS] Successfully acquired control of trainer.');
    } catch (e) {
      this.capabilities.control = false;
      console.warn('[FTMS] Control Point setup failed (trainer may be read-only):', e);
    }

    // 4. Setup Indoor Bike Data (0x2AD2)
    this.bikeDataChar = await service.getCharacteristic(INDOOR_BIKE_DATA_UUID);
    await this.bikeDataChar.startNotifications();
    this.bikeDataChar.addEventListener('characteristicvaluechanged', this.handleBikeDataChanged);

    this.isConnected = true;
  }

  private handleControlPointIndication(value: DataView) {
    if (value.byteLength < 3) return;
    const responseCode = value.getUint8(0); // Should be 0x80
    const requestOpcode = value.getUint8(1);
    const resultCode = value.getUint8(2);

    if (responseCode === 0x80 && this.pendingControlResponse && this.pendingControlResponse.opcode === requestOpcode) {
      const { resolve, reject, timerId } = this.pendingControlResponse;
      clearTimeout(timerId);
      this.pendingControlResponse = null;
      this.isProcessingQueue = false;

      if (resultCode === 0x01) {
        resolve();
      } else {
        reject(new Error(`FTMS Control Opcode 0x${requestOpcode.toString(16)} failed with result code 0x${resultCode.toString(16)}`));
      }

      // Process next item in queue if available
      this.processNextQueueItem();
    }
  }

  private async sendControlCommand(payload: Uint8Array, opcode: number): Promise<void> {
    if (!this.controlPointChar) {
      throw new Error('Trainer resistance control is unavailable. Telemetry may still be connected.');
    }

    return new Promise((resolve, reject) => {
      this.controlQueue.push({ opcode, payload, resolve, reject });
      this.processNextQueueItem();
    });
  }

  private async processNextQueueItem() {
    if (this.isProcessingQueue || this.controlQueue.length === 0 || !this.controlPointChar) return;
    this.isProcessingQueue = true;

    const item = this.controlQueue.shift();
    if (!item) {
      this.isProcessingQueue = false;
      return;
    }

    const pendingResponse = {
      opcode: item.opcode,
      resolve: item.resolve,
      reject: item.reject,
      timerId: 0,
    };
    try {
      // 3 second timeout for indication
      const timerId = window.setTimeout(() => {
        if (this.pendingControlResponse === pendingResponse) {
          console.warn(`[FTMS] Control opcode 0x${item.opcode.toString(16)} indication timed out.`);
          pendingResponse.reject(new Error('FTMS indication timeout.'));
          this.pendingControlResponse = null;
          this.isProcessingQueue = false;
          this.processNextQueueItem();
        }
      }, 3000);
      pendingResponse.timerId = timerId;
      this.pendingControlResponse = pendingResponse;

      await this.controlPointChar.writeValue(item.payload as unknown as BufferSource);
      // NOTE: Queue remains locked until indication arrives or timeout fires!
    } catch (err) {
      if (this.pendingControlResponse === pendingResponse) {
        clearTimeout(pendingResponse.timerId);
        this.pendingControlResponse = null;
      }
      item.reject(err);
      this.isProcessingQueue = false;
      this.processNextQueueItem();
    }
  }

  private handleIndoorBikeData(value: DataView) {
    const parsed = parseIndoorBikeData(value, this.lastCumulativeDistanceMeters);
    this.lastCumulativeDistanceMeters = parsed.cumulativeDistanceMeters;

    if (this.telemetryCallback) {
      const sample: TelemetrySample = {
        timestamp: Date.now(),
        powerWatts: Math.max(0, parsed.instantaneousPowerWatts),
        cadenceRpm: Math.max(0, Math.round(parsed.instantaneousCadenceRpm)),
        flywheelSpeedKph: parsed.instantaneousSpeedKph,
        virtualSpeedKph: 0,
        distanceMeters: this.lastCumulativeDistanceMeters,
        heartRateBpm: parsed.heartRateBpm,
        gradePercent: this.currentGrade,
        elevationMeters: 0,
      };
      this.telemetryCallback(sample);
    }
  }

  public async setGrade(gradePercent: number): Promise<void> {
    this.currentGrade = gradePercent;
    if (!this.isConnected) throw new Error('Trainer is not connected.');
    if (!this.controlPointChar || !this.capabilities.control) {
      throw new Error('Trainer resistance control is unavailable. Telemetry may still be connected.');
    }
    if (this.capabilities.simulation === false) {
      throw new Error(`${this.deviceName} does not advertise FTMS route-simulation support.`);
    }

    const payload = makeSimulationPayload(0, gradePercent);
    await this.sendControlCommand(payload, SET_SIMULATION_PARAMETERS);
  }

  public async setTargetPower(watts: number): Promise<void> {
    const currentTargetPower = Math.max(25, Math.min(1000, Math.round(watts)));
    if (!this.isConnected) throw new Error('Trainer is not connected.');
    if (!this.controlPointChar || !this.capabilities.control) {
      throw new Error('Trainer resistance control is unavailable. Telemetry may still be connected.');
    }
    if (this.capabilities.targetPower === false) {
      throw new Error(`${this.deviceName} does not advertise FTMS target-power support.`);
    }

    await this.sendControlCommand(makeTargetPowerPayload(currentTargetPower), SET_TARGET_POWER);
  }

  public async neutralize(): Promise<void> {
    this.currentGrade = 0;
    if (!this.isConnected) return;
    if (!this.controlPointChar || !this.capabilities.control) {
      throw new Error('Trainer resistance control is unavailable.');
    }

    let simulationError: unknown;
    if (this.capabilities.simulation !== false) {
      try {
        await this.sendControlCommand(makeSimulationPayload(0, 0), SET_SIMULATION_PARAMETERS);
        return;
      } catch (error) {
        simulationError = error;
      }
    }

    try {
      await this.sendControlCommand(makePausePayload(), STOP_OR_PAUSE);
      return;
    } catch (pauseError) {
      if (!simulationError) simulationError = pauseError;
    }

    throw simulationError instanceof Error
      ? simulationError
      : new Error('Trainer does not advertise a supported neutral resistance mode.');
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

  public async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.reconnectGeneration += 1;
    this.failPendingControlCommands(new Error('Trainer disconnected.'));
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.resetGattConnection();
    this.emitConnectionState({ state: 'disconnected' });
  }

  private resetGattConnection() {
    this.isConnected = false;
    this.capabilities.control = false;
    this.failPendingControlCommands(new Error('Trainer connection lost.'));
    this.detachCharacteristicListeners();
    this.controlPointChar = null;
    this.bikeDataChar = null;
    this.server = null;
  }

  private emitConnectionState(status: TrainerConnectionStatus) {
    this.connectionStatus = status;
    for (const callback of this.connectionCallbacks) callback(status);
  }

  private failPendingControlCommands(error: Error) {
    if (this.pendingControlResponse) {
      clearTimeout(this.pendingControlResponse.timerId);
      this.pendingControlResponse.reject(error);
      this.pendingControlResponse = null;
    }
    for (const item of this.controlQueue.splice(0)) {
      item.reject(error);
    }
    this.isProcessingQueue = false;
  }

  private detachCharacteristicListeners() {
    this.controlPointChar?.removeEventListener('characteristicvaluechanged', this.handleControlPointChanged);
    this.bikeDataChar?.removeEventListener('characteristicvaluechanged', this.handleBikeDataChanged);
  }

  private async attemptAutoReconnect(generation: number) {
    if (!this.device || !this.device.gatt) return;
    if (this.autoReconnectInFlight) return;
    this.autoReconnectInFlight = true;
    console.log('[FTMS] Attempting auto-reconnection...');

    try {
      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (this.intentionalDisconnect || generation !== this.reconnectGeneration) return;
        this.emitConnectionState({
          state: 'reconnecting',
          attempt,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
          message: `Trainer signal lost. Reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})…`,
        });
        try {
          await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs(attempt)));
          if (this.intentionalDisconnect || generation !== this.reconnectGeneration) return;
          await this.initGattConnection();
          this.emitConnectedState();
          console.log('[FTMS] Auto-reconnection successful!');
          return;
        } catch (e) {
          this.resetGattConnection();
          console.warn(`[FTMS] Reconnect attempt ${attempt} failed.`);
        }
      }

      this.emitConnectionState({
        state: 'failed',
        message: 'Trainer connection was lost. Automatic reconnect failed; the ride has been paused.',
      });
    } finally {
      this.autoReconnectInFlight = false;
    }
  }

  private emitConnectedState() {
    this.emitConnectionState({
      state: 'connected',
      message: this.capabilities.control
        ? 'Trainer telemetry and resistance control are ready.'
        : 'Trainer telemetry is connected; resistance control is unavailable.',
    });
  }
}

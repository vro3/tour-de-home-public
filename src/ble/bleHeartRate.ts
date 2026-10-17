// Standard BLE Heart Rate service (0x180D) client. Works with any broadcaster —
// a Garmin watch in Broadcast Heart Rate mode, a chest strap, an armband.
// Bluetooth LE only: browsers cannot receive ANT+ broadcasts.

const HEART_RATE_SERVICE = 'heart_rate';
const HEART_RATE_MEASUREMENT = 'heart_rate_measurement';

export type HeartRateListener = (bpm: number | null) => void;

export class BleHeartRateMonitor {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private listener: HeartRateListener | null = null;

  public get deviceName(): string {
    return this.device?.name ?? 'Heart Rate Monitor';
  }

  public get isConnected(): boolean {
    return Boolean(this.device?.gatt?.connected);
  }

  public onHeartRate(listener: HeartRateListener): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  public async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not available in this browser. Use Chrome.');
    }
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HEART_RATE_SERVICE] }],
    });
    this.device.addEventListener('gattserverdisconnected', this.handleDisconnected);

    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    this.characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    this.characteristic.addEventListener('characteristicvaluechanged', this.handleMeasurement);
    await this.characteristic.startNotifications();
  }

  public async disconnect(): Promise<void> {
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.handleMeasurement);
    try {
      await this.characteristic?.stopNotifications();
    } catch {
      // Already gone — nothing to stop.
    }
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnected);
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.characteristic = null;
    this.device = null;
    this.listener?.(null);
  }

  private handleDisconnected = () => {
    this.characteristic = null;
    this.listener?.(null);
  };

  private handleMeasurement = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    if (!value) return;
    // Flags bit 0: heart-rate value format (0 = uint8, 1 = uint16 little-endian).
    const flags = value.getUint8(0);
    const bpm = (flags & 0x01) === 0 ? value.getUint8(1) : value.getUint16(1, true);
    if (bpm > 0 && bpm < 255) this.listener?.(bpm);
  };
}

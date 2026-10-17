// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FtmsTrainer } from '../src/ble/ftmsTrainer';
import type { TrainerConnectionStatus } from '../src/types/cycling';

const FTMS_FEATURE_UUID = 0x2ACC;
const INDOOR_BIKE_DATA_UUID = 0x2AD2;
const CONTROL_POINT_UUID = 0x2AD9;

interface TrainerHarness {
  trainer: FtmsTrainer;
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  connectGatt: ReturnType<typeof vi.fn>;
  statuses: TrainerConnectionStatus[];
}

async function createConnectedTrainer(): Promise<TrainerHarness> {
  const bikeDataCharacteristic = Object.assign(new EventTarget(), {
    startNotifications: vi.fn().mockResolvedValue(undefined),
  }) as unknown as BluetoothRemoteGATTCharacteristic;
  const service = {
    getCharacteristic: vi.fn(async (uuid: BluetoothCharacteristicUUID) => {
      if (uuid === FTMS_FEATURE_UUID) throw new Error('Feature characteristic unavailable');
      if (uuid === CONTROL_POINT_UUID) throw new Error('Control point unavailable');
      if (uuid === INDOOR_BIKE_DATA_UUID) return bikeDataCharacteristic;
      throw new Error(`Unexpected characteristic: ${String(uuid)}`);
    }),
  } as unknown as BluetoothRemoteGATTService;
  const server = {
    connected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getPrimaryService: vi.fn().mockResolvedValue(service),
  } as unknown as BluetoothRemoteGATTServer;
  const connectGatt = vi.fn().mockResolvedValue(server);
  const device = Object.assign(new EventTarget(), {
    id: 'kickr-core-test',
    name: 'KICKR CORE Test',
    gatt: {
      connected: true,
      connect: connectGatt,
      disconnect: vi.fn(),
    },
  }) as unknown as BluetoothDevice;
  const requestDevice = vi.fn().mockResolvedValue(device);
  vi.stubGlobal('navigator', { bluetooth: { requestDevice } });

  const trainer = new FtmsTrainer();
  const statuses: TrainerConnectionStatus[] = [];
  trainer.onConnectionState((status) => statuses.push({ ...status }));
  await trainer.connect();
  connectGatt.mockReset();
  statuses.length = 0;

  return { trainer, device, server, connectGatt, statuses };
}

function countedReconnectStatuses(statuses: TrainerConnectionStatus[]): TrainerConnectionStatus[] {
  return statuses.filter((status) => (
    status.state === 'reconnecting' && status.message?.includes('/')
  ));
}

describe('FTMS automatic reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps retrying long enough for a power cycle and reconnects on attempt six', async () => {
    const harness = await createConnectedTrainer();
    harness.connectGatt.mockImplementation(async () => {
      if (harness.connectGatt.mock.calls.length < 6) {
        throw new Error('Trainer is still booting');
      }
      return harness.server;
    });

    harness.device.dispatchEvent(new Event('gattserverdisconnected'));

    expect(harness.trainer.connectionStatus).toMatchObject({
      state: 'reconnecting',
      attempt: 1,
      maxAttempts: 8,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(harness.connectGatt).toHaveBeenCalledTimes(5);
    expect(harness.trainer.connectionStatus).toMatchObject({
      state: 'reconnecting',
      attempt: 6,
      maxAttempts: 8,
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(harness.connectGatt).toHaveBeenCalledTimes(5);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.connectGatt).toHaveBeenCalledTimes(6);
    expect(harness.trainer.connectionStatus.state).toBe('connected');
    expect(harness.trainer.isConnected).toBe(true);
    expect(harness.statuses.some((status) => status.state === 'failed')).toBe(false);
    expect(countedReconnectStatuses(harness.statuses).map((status) => status.attempt)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('uses eight attempts and a capped delay before reporting terminal failure', async () => {
    const harness = await createConnectedTrainer();
    harness.connectGatt.mockRejectedValue(new Error('Trainer unavailable'));

    harness.device.dispatchEvent(new Event('gattserverdisconnected'));

    await vi.advanceTimersByTimeAsync(50_000);
    expect(harness.connectGatt).toHaveBeenCalledTimes(7);
    expect(harness.trainer.connectionStatus).toMatchObject({
      state: 'reconnecting',
      attempt: 8,
      maxAttempts: 8,
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(harness.connectGatt).toHaveBeenCalledTimes(7);
    expect(harness.trainer.connectionStatus.state).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.connectGatt).toHaveBeenCalledTimes(8);
    expect(harness.trainer.connectionStatus).toEqual({
      state: 'failed',
      message: 'Trainer connection was lost. Automatic reconnect failed; the ride has been paused.',
    });
    expect(countedReconnectStatuses(harness.statuses).map((status) => status.attempt)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FtmsTreadmill, parseTreadmillData } from '../src/ble/ftmsTreadmill';
const view = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);
async function harness() {
  const characteristic = Object.assign(new EventTarget(), { value: view([0, 0, 0xe8, 3]), startNotifications: vi.fn().mockResolvedValue(undefined), stopNotifications: vi.fn().mockResolvedValue(undefined) });
  const getCharacteristic = vi.fn().mockResolvedValue(characteristic);
  const service = { getCharacteristic };
  const server = { getPrimaryService: vi.fn().mockResolvedValue(service) };
  const connect = vi.fn().mockResolvedValue(server);
  const device = Object.assign(new EventTarget(), { name: 'Test treadmill', gatt: { connect, disconnect: vi.fn() } });
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: vi.fn().mockResolvedValue(device) } });
  const treadmill = new FtmsTreadmill();
  const telemetry = vi.fn(); treadmill.onTelemetry(telemetry);
  await treadmill.connect();
  return { treadmill, characteristic, getCharacteristic, device, connect, server, telemetry };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('read-only treadmill sync', () => {
  it('parses optional fields without confusing speed, incline and heart-rate offsets', () => {
    const bytes = [0xfe, 0x1f, 0xe8, 3, 0x84, 3, 100, 0, 0, 0xf1, 0xff, 0, 0, 1, 0, 2, 0, 6, 7, 1, 0, 2, 0, 3, 145, 50, 20, 0, 40, 0, 1, 0, 2, 0];
    expect(parseTreadmillData(view(bytes))).toEqual({ speedKph: 10, incline: -1.5, heartRate: 145 });
    expect(parseTreadmillData(view([1, 0]))).toEqual({});
    expect(parseTreadmillData(view(bytes.slice(0, -1)))).toBeNull();
    expect(parseTreadmillData(view([0, 0, 0xff, 0xff]))).toBeNull();
  });
  it('subscribes only to treadmill data and never requests control or writes belt commands', async () => {
    const h = await harness();
    expect(h.getCharacteristic.mock.calls).toEqual([[0x2acd]]);
    expect(h.treadmill.capabilities.control).toBe(false);
    h.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(h.telemetry).toHaveBeenCalledWith(expect.objectContaining({ flywheelSpeedKph: 10, powerWatts: 0 }));
    h.characteristic.value = view([1, 0]);
    h.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(h.telemetry).toHaveBeenCalledTimes(1);
    await expect(h.treadmill.setGrade()).rejects.toThrow(/console/);
    await expect(h.treadmill.setTargetPower()).rejects.toThrow(/ERG/);
    await h.treadmill.neutralize();
    expect(h.getCharacteristic.mock.calls).toEqual([[0x2acd]]);
  });
  it('reconnects with one notification listener and cancels retries on intentional disconnect', async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.device.dispatchEvent(new Event('gattserverdisconnected'));
    expect(h.treadmill.connectionStatus.state).toBe('reconnecting');
    h.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(h.telemetry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.treadmill.isConnected).toBe(true);
    h.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(h.telemetry).toHaveBeenCalledTimes(1);
    h.device.dispatchEvent(new Event('gattserverdisconnected'));
    await h.treadmill.disconnect();
    const attempts = h.connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.connect).toHaveBeenCalledTimes(attempts);
    expect(h.treadmill.connectionStatus.state).toBe('disconnected');
  });
});

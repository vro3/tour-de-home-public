// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/" }

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isScenicQualityMode,
  SCENIC_QUALITY_OPTIONS,
} from '../src/types/scenic';

const harness = vi.hoisted(() => ({
  receivedQualityMode: null as string | null,
}));

vi.mock('../src/ble/mockTrainer', () => {
  class FakeMockTrainer {
    public isConnected = false;
    public deviceName = 'Mock Trainer (Simulator)';
    public connectionStatus = { state: 'disconnected' as const };
    public readonly capabilities = { simulation: true, targetPower: true, control: true };
    private connectionCallbacks = new Set<(status: { state: string }) => void>();

    public async connect() {
      this.isConnected = true;
      this.connectionStatus = { state: 'connected' } as typeof this.connectionStatus;
      for (const callback of this.connectionCallbacks) callback(this.connectionStatus);
    }

    public async reconnect() {
      await this.connect();
    }

    public async disconnect() {
      this.isConnected = false;
      this.connectionStatus = { state: 'disconnected' };
      for (const callback of this.connectionCallbacks) callback(this.connectionStatus);
    }

    public onTelemetry() {
      return () => {};
    }

    public onConnectionState(callback: (status: { state: string }) => void) {
      this.connectionCallbacks.add(callback);
      callback(this.connectionStatus);
      return () => this.connectionCallbacks.delete(callback);
    }

    public async setGrade() {}
    public async setTargetPower() {}
    public async neutralize() {}
    public setPower() {}
    public setCadence() {}
  }

  return { MockTrainer: FakeMockTrainer };
});

vi.mock('../src/ble/ftmsTrainer', () => ({ FtmsTrainer: class {} }));
vi.mock('../src/ble/bleHeartRate', () => ({ BleHeartRateMonitor: class {} }));

vi.mock('../src/storage/rideHistory', () => ({ loadRideHistory: vi.fn().mockResolvedValue([]), loadPreviousRide: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../src/storage/rideJournal', () => ({
  rideJournal: {
    restoreUnfinishedSession: vi.fn().mockResolvedValue(null),
    startSession: vi.fn().mockResolvedValue({}),
    recordSample: vi.fn().mockResolvedValue(undefined),
    updateControlMode: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(null),
    clearUnfinishedSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/storage/appPreferences', () => ({
  loadSelectedRoute: vi.fn().mockResolvedValue(null),
  saveSelectedRoute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/wakeLock', () => ({
  wakeLockManager: {
    requestWakeLock: vi.fn().mockResolvedValue(true),
    releaseWakeLock: vi.fn(),
  },
}));

vi.mock('../src/components/RoutePicker', () => ({ RoutePicker: () => <div>Route picker</div> }));
vi.mock('../src/components/Hud', () => ({ HUD: () => null }));
vi.mock('../src/components/ElevationRibbon', () => ({ ElevationRibbon: () => null }));
vi.mock('../src/components/MockTrainerControls', () => ({ MockTrainerControls: () => null }));
vi.mock('../src/components/ConnectModal', () => ({ ConnectModal: () => null }));
vi.mock('../src/components/SummaryModal', () => ({ SummaryModal: () => null }));
vi.mock('../src/components/CrashRecoveryModal', () => ({ CrashRecoveryModal: () => null }));
vi.mock('../src/components/EndRideModal', () => ({ EndRideModal: () => null }));
vi.mock('../src/components/ScenicClimbBar', () => ({ ScenicClimbBar: () => null }));
vi.mock('../src/components/Map3D', () => ({ Map3D: () => null }));
vi.mock('../src/components/ScenicHud', () => ({
  ScenicHud: ({ onToggleControls }: { onToggleControls: () => void }) => (
    <button type="button" onClick={onToggleControls}>Open ride controls</button>
  ),
}));
vi.mock('../src/components/ScenicRide', () => ({
  ScenicRide: ({ qualityMode }: { qualityMode: string }) => {
    harness.receivedQualityMode = qualityMode;
    return <output data-testid="scenic-quality-prop">{qualityMode}</output>;
  },
}));

import { App } from '../src/App';

const QUALITY_STORAGE_KEY = 'tour_de_home_scenic_quality';
const storageValues = new Map<string, string>();

function startDemoRide() {
  const demoButtons = screen.getAllByRole('button', { name: 'Demo Selected Route' });
  fireEvent.click(demoButtons[demoButtons.length - 1]);
}

beforeEach(() => {
  storageValues.clear();
  const localStorage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => storageValues.set(key, String(value)),
    removeItem: (key: string) => storageValues.delete(key),
    clear: () => storageValues.clear(),
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    get length() { return storageValues.size; },
  } as Storage;
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorage });
  harness.receivedQualityMode = null;
});

afterEach(() => {
  cleanup();
  storageValues.clear();
});

describe('scenic quality options', () => {
  it('exposes the supported labels and validates only their ids', () => {
    expect(SCENIC_QUALITY_OPTIONS).toEqual([
      { id: 'auto', label: 'Auto' },
      { id: 'high', label: 'High' },
      { id: 'efficient', label: 'Efficient' },
    ]);
    expect(['auto', 'high', 'efficient'].every(isScenicQualityMode)).toBe(true);
    expect(isScenicQualityMode('ultra')).toBe(false);
    expect(isScenicQualityMode(null)).toBe(false);
  });
});

describe('persisted scenic quality UI', () => {
  it('restores, changes, persists, and passes the selected mode to ScenicRide', async () => {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, 'high');
    render(<App />);
    startDemoRide();

    await waitFor(() => expect(harness.receivedQualityMode).toBe('high'));
    expect(screen.getByTestId('scenic-quality-prop').textContent).toBe('high');
    fireEvent.click(screen.getByRole('button', { name: 'Open ride controls' }));

    const selector = screen.getByRole('combobox', { name: 'Scenic quality' }) as HTMLSelectElement;
    expect([...selector.options].map(({ value, text }) => [value, text])).toEqual([
      ['auto', 'Auto'],
      ['high', 'High'],
      ['efficient', 'Efficient'],
    ]);
    expect(selector.value).toBe('high');

    fireEvent.change(selector, { target: { value: 'efficient' } });
    await waitFor(() => {
      expect(window.localStorage.getItem(QUALITY_STORAGE_KEY)).toBe('efficient');
      expect(harness.receivedQualityMode).toBe('efficient');
    });
    expect(screen.getByTestId('scenic-quality-prop').textContent).toBe('efficient');

    cleanup();
    harness.receivedQualityMode = null;
    render(<App />);
    startDemoRide();
    await waitFor(() => expect(harness.receivedQualityMode).toBe('efficient'));
  });
});

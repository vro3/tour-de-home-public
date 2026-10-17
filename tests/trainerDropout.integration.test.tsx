// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/" }

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TelemetrySample,
  TrainerConnectionStatus,
} from '../src/types/cycling';

const harness = vi.hoisted(() => ({
  controlAvailable: true,
  gradeCalls: 0,
  neutralizeCalls: 0,
  gradeFailuresRemaining: 0,
  startSessionError: null as Error | null,
  endSessionError: null as Error | null,
  endSessionCalls: 0,
  trainer: null as null | {
    emitConnection(status: TrainerConnectionStatus): void;
    emitTelemetry(sample: TelemetrySample): void;
  },
}));

vi.mock('../src/ble/mockTrainer', () => {
  class FakeMockTrainer {
    public isConnected = false;
    public deviceName = 'Mock Trainer (Simulator)';
    public connectionStatus: TrainerConnectionStatus = { state: 'disconnected' };
    public readonly capabilities = { simulation: true, targetPower: true, control: harness.controlAvailable };
    private telemetryCallback: ((sample: TelemetrySample) => void) | null = null;
    private connectionCallbacks = new Set<(status: TrainerConnectionStatus) => void>();

    public constructor() {
      harness.trainer = this;
    }

    public async connect() {
      this.emitConnection({ state: 'connecting', message: 'Starting simulator…' });
      this.isConnected = true;
      this.emitConnection({ state: 'connected' });
    }

    public async reconnect() {
      this.emitConnection({ state: 'connecting', message: 'Retrying trainer connection…' });
      this.isConnected = true;
      this.emitConnection({ state: 'connected' });
    }

    public async disconnect() {
      this.isConnected = false;
      this.emitConnection({ state: 'disconnected' });
    }

    public onTelemetry(callback: (sample: TelemetrySample) => void) {
      this.telemetryCallback = callback;
      return () => {
        if (this.telemetryCallback === callback) this.telemetryCallback = null;
      };
    }

    public onConnectionState(callback: (status: TrainerConnectionStatus) => void) {
      this.connectionCallbacks.add(callback);
      callback(this.connectionStatus);
      return () => this.connectionCallbacks.delete(callback);
    }

    public async setGrade() {
      harness.gradeCalls += 1;
      if (harness.gradeFailuresRemaining > 0) {
        harness.gradeFailuresRemaining -= 1;
        throw new Error('Transient grade failure');
      }
    }
    public async setTargetPower() {}
    public async neutralize() {
      harness.neutralizeCalls += 1;
    }
    public setPower() {}
    public setCadence() {}

    public emitTelemetry(sample: TelemetrySample) {
      this.telemetryCallback?.(sample);
    }

    public emitConnection(status: TrainerConnectionStatus) {
      this.connectionStatus = status;
      this.isConnected = status.state === 'connected';
      for (const callback of this.connectionCallbacks) callback(status);
    }
  }

  return { MockTrainer: FakeMockTrainer };
});

vi.mock('../src/ble/ftmsTrainer', () => ({
  FtmsTrainer: class {},
}));

vi.mock('../src/ble/ftmsTreadmill', async () => {
  const { MockTrainer } = await import('../src/ble/mockTrainer');
  return { FtmsTreadmill: class extends MockTrainer {
    readonly activityType = 'running';
    readonly capabilities = { simulation: false, targetPower: false, control: false };
  } };
});

vi.mock('../src/storage/rideHistory', () => ({ loadRideHistory: vi.fn().mockResolvedValue([]), loadPreviousRide: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../src/storage/rideJournal', () => ({
  rideJournal: {
    restoreUnfinishedSession: vi.fn().mockResolvedValue(null),
    startSession: vi.fn(async () => {
      if (harness.startSessionError) throw harness.startSessionError;
      return {};
    }),
    recordSample: vi.fn().mockResolvedValue(undefined),
    updateControlMode: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn(async () => {
      harness.endSessionCalls += 1;
      if (harness.endSessionError) throw harness.endSessionError;
      return null;
    }),
    clearUnfinishedSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/utils/wakeLock', () => ({
  wakeLockManager: {
    requestWakeLock: vi.fn().mockResolvedValue(true),
    releaseWakeLock: vi.fn(),
  },
}));

vi.mock('../src/components/RoutePicker', () => ({
  RoutePicker: ({ onSelectRoute }: { onSelectRoute: (route: any) => void }) => (
    <div>
      Route picker
      <button
        type="button"
        onClick={() => onSelectRoute({
          id: 'custom-test-route',
          name: 'Custom Test Route',
          totalDistanceMeters: 1_000,
          totalElevationGainMeters: 50,
          points: [
            { lat: 45, lng: 6, elevation: 100, cumulativeDistance: 0, grade: 2, heading: 0 },
            { lat: 45.01, lng: 6.01, elevation: 150, cumulativeDistance: 1_000, grade: 5, heading: 45 },
          ],
        })}
      >
        Choose Custom Test Route
      </button>
      <button
        type="button"
        onClick={() => onSelectRoute({
          id: 'tiny-finish-route',
          name: 'Tiny Finish Route',
          totalDistanceMeters: 0.05,
          totalElevationGainMeters: 0,
          points: [
            { lat: 45, lng: 6, elevation: 100, cumulativeDistance: 0, grade: 0, heading: 0 },
            { lat: 45.000001, lng: 6, elevation: 100, cumulativeDistance: 0.05, grade: 0, heading: 0 },
          ],
        })}
      >
        Choose Tiny Finish Route
      </button>
    </div>
  ),
}));

vi.mock('../src/components/Hud', () => ({
  HUD: ({ telemetry, controlError }: { telemetry: TelemetrySample; controlError: string | null }) => (
    <div>
      <output data-testid="power">{telemetry.powerWatts}</output>
      {controlError && <div>{controlError}</div>}
    </div>
  ),
}));

vi.mock('../src/components/ScenicHud', () => ({
  ScenicHud: ({ telemetry, controlError, onToggleControls }: { telemetry: TelemetrySample; controlError: string | null; onToggleControls: () => void }) => (
    <div>
      <output data-testid="power">{telemetry.powerWatts}</output>
      {controlError && <div>{controlError}</div>}
      <button type="button" onClick={onToggleControls}>Open ride controls</button>
    </div>
  ),
}));

vi.mock('../src/components/ElevationRibbon', () => ({ ElevationRibbon: () => null }));
vi.mock('../src/components/MockTrainerControls', () => ({ MockTrainerControls: () => null }));
vi.mock('../src/components/ConnectModal', () => ({ ConnectModal: ({ isOpen, onConnectTreadmill }: any) => isOpen ? <button onClick={onConnectTreadmill}>Pair test treadmill</button> : null }));
vi.mock('../src/components/SummaryModal', () => ({ SummaryModal: () => null }));
vi.mock('../src/components/CrashRecoveryModal', () => ({ CrashRecoveryModal: () => null }));
vi.mock('../src/components/Map3D', () => ({ Map3D: () => <div>Map view</div> }));
vi.mock('../src/components/ScenicRide', () => ({ ScenicRide: () => <div>Scenic view</div> }));

import { App } from '../src/App';
import { loadRideHistory } from '../src/storage/rideHistory';
import { rideJournal } from '../src/storage/rideJournal';
import { PRESET_ROUTES } from '../src/route/presets';

const sample: TelemetrySample = {
  timestamp: Date.now(),
  powerWatts: 245,
  cadenceRpm: 91,
  flywheelSpeedKph: 32,
  virtualSpeedKph: 28,
  distanceMeters: 100,
  gradePercent: 4,
  elevationMeters: 250,
  lat: 45,
  lng: 6,
};

describe('trainer dropout recovery', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    } as Storage;
    Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorage });
    vi.mocked(loadRideHistory).mockResolvedValue([]);
    harness.trainer = null;
    harness.controlAvailable = true;
    harness.gradeCalls = 0;
    harness.neutralizeCalls = 0;
    harness.gradeFailuresRemaining = 0;
    harness.startSessionError = null;
    harness.endSessionError = null;
    harness.endSessionCalls = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('zeros stale power, exposes reconnect state, pauses on failure, and supports retry', async () => {
    render(<App />);
    const demoButtons = screen.getAllByRole('button', { name: /Quick Demo Ride|Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);

    await screen.findByText('Simulator');
    expect(harness.trainer).not.toBeNull();

    act(() => harness.trainer!.emitTelemetry({ ...sample, timestamp: Date.now() }));
    await waitFor(() => expect(screen.getByTestId('power').textContent).toBe('245'));

    act(() => harness.trainer!.emitConnection({
      state: 'reconnecting',
      attempt: 1,
      maxAttempts: 8,
      message: 'Trainer signal lost. Reconnecting (1/8)…',
    }));

    expect((await screen.findAllByText('Trainer signal lost. Reconnecting (1/8)…')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('power').textContent).toBe('0');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();

    act(() => harness.trainer!.emitConnection({ state: 'connected' }));
    expect(await screen.findByText('Simulator')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(harness.gradeCalls).toBe(1);

    act(() => harness.trainer!.emitConnection({
      state: 'failed',
      message: 'Trainer connection was lost. Automatic reconnect failed; the ride has been paused.',
    }));

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
    expect(screen.getByTestId('power').textContent).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Simulator');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy());
    expect(harness.gradeCalls).toBe(2);
  });

  it('launches the selected course in demo mode and offers a safe return home', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Custom Test Route' }));

    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);

    await screen.findByText('Simulator');
    expect(screen.getByText('Custom Test Route')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open ride controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'End ride and return home' }));

    expect(await screen.findByRole('heading', { name: 'Return home?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Finish, Save & Exit/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Discard Ride & Go Home/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Discard Ride & Go Home/ }));
    await screen.findByText('Route picker');
    expect(screen.getByText('Custom Test Route')).toBeTruthy();
  });

  it('labels a telemetry-only trainer instead of claiming resistance control is ready', async () => {
    harness.controlAvailable = false;
    render(<App />);

    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);

    expect(await screen.findByLabelText(/Telemetry only · no resistance/)).toBeTruthy();
    expect(await screen.findByText(/trainer resistance control is unavailable/i)).toBeTruthy();
    expect(screen.queryByText('Simulator Active')).toBeNull();
  });

  it('does not resume a paused trainer through global shortcuts behind the Home dialog', async () => {
    render(<App />);
    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);
    await screen.findByText('Simulator');

    fireEvent.click(screen.getByRole('button', { name: 'Open ride controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'End ride and return home' }));
    await screen.findByRole('heading', { name: 'Return home?' });
    fireEvent.keyDown(window, { code: 'Space' });

    expect(screen.getByRole('heading', { name: 'Return home?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
  });

  it('leaves ride shortcuts alone while a scenic select owns focus', async () => {
    render(<App />);
    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);
    await screen.findByText('Simulator');

    fireEvent.click(screen.getByRole('button', { name: 'Open ride controls' }));
    const worldSelect = screen.getByRole('combobox', { name: 'Scenic world' });
    worldSelect.focus();
    fireEvent.keyDown(worldSelect, { code: 'Space' });

    expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy();
  });

  it('does not toggle a ride repeatedly while Space is held', async () => {
    render(<App />);
    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);
    await screen.findByText('Simulator');

    fireEvent.keyDown(window, { code: 'Space' });
    await screen.findByRole('button', { name: 'Resume' });
    fireEvent.keyDown(window, { code: 'Space', repeat: true });

    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
  });

  it('retries a route-resistance command after a transient failure', async () => {
    harness.gradeFailuresRemaining = 1;
    render(<App />);
    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);

    await screen.findByText('Simulator');
    expect(harness.gradeCalls).toBe(1);
    await waitFor(() => expect(harness.gradeCalls).toBeGreaterThanOrEqual(2), { timeout: 2_500 });
  });

  it('stays on the home screen and explains an initial journal failure', async () => {
    harness.startSessionError = new Error('IndexedDB unavailable');
    render(<App />);
    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);

    expect((await screen.findByRole('alert')).textContent).toMatch(/ride has not started/i);
    expect(screen.getByText('Route picker')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
  });

  it('finalizes at the route endpoint instead of exposing Resume forever', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Tiny Finish Route' }));
    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);
    await screen.findByText('Simulator');

    act(() => harness.trainer!.emitTelemetry({ ...sample, timestamp: Date.now() }));
    await waitFor(() => expect(harness.endSessionCalls).toBe(1), { timeout: 2_500 });

    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
  });

  it('keeps a failed final journal write paused and retryable', async () => {
    harness.endSessionError = new Error('IndexedDB completion write failed');
    render(<App />);
    const demoButtons = screen.getAllByRole('button', { name: /Demo Selected Route/ });
    fireEvent.click(demoButtons[demoButtons.length - 1]);
    await screen.findByText('Simulator');

    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));

    expect(await screen.findByText(/recoverable journal is intact/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
  });
  it('freezes ghost time and gap through pause and repeated trainer reconnects', async () => {
    vi.mocked(loadRideHistory).mockResolvedValue([{
      id: 'opponent', startTime: 1000, endTime: 200000, routeName: PRESET_ROUTES[0].name,
      route: PRESET_ROUTES[0], totalDistanceMeters: 300, totalElevationGainMeters: 0,
      activeTimerSeconds: 60, controlMode: 'route', ergTargetWatts: 200,
      samples: [{ ...sample, activeTimeSeconds: 60, distanceMeters: 300 }],
    }]);
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Previous ride to race'), { target: { value: 'opponent' } });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Demo Selected Route/ }).at(-1)!); });
    expect(rideJournal.startSession).toHaveBeenLastCalledWith(PRESET_ROUTES[0], 'route', 200, 'opponent');
    const state = () => {
      const element = screen.getByRole('region', { name: 'Race Yourself comparison' });
      return { time: Number(element.getAttribute('data-race-seconds')), ghost: element.getAttribute('data-ghost-distance'), gap: screen.getByLabelText('Live time gap').textContent };
    };
    await act(async () => {
      harness.trainer!.emitTelemetry({ ...sample, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(state().time).toBeCloseTo(1.2, 2);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Pause/ })); });
    const paused = state();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(state()).toEqual(paused);
    for (const connection of ['reconnecting', 'failed', 'disconnected'] as const) {
      await act(async () => {
        harness.trainer!.emitConnection({ state: 'connected' });
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      });
      await act(async () => {
        harness.trainer!.emitTelemetry({ ...sample, timestamp: Date.now() });
        await vi.advanceTimersByTimeAsync(500);
        harness.trainer!.emitConnection({ state: connection });
      });
      const dropped = state();
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(state()).toEqual(dropped);
      await act(async () => { harness.trainer!.emitConnection({ state: 'connected' }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(state()).toEqual(dropped);
      expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    }
    expect(state().time).toBeCloseTo(2.7, 2);
  });

  it('uses belt speed, freezes on stop and stale data, and requires explicit resume after reconnect', async () => {
    render(<App />);
    await screen.findByText('Route picker');
    fireEvent.click(screen.getAllByRole('button', { name: /Connect.*Trainer/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Pair test treadmill' }));
    await waitFor(() => expect(harness.trainer).not.toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pair test treadmill' })).toBeNull());
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /LOAD COURSE/ }).at(-1)!); });
    const belt = (speed: number) => harness.trainer!.emitTelemetry({ ...sample, powerWatts: 0, cadenceRpm: 0, flywheelSpeedKph: speed, timestamp: Date.now() });
    await act(async () => { belt(7.2); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy();
    await act(async () => { belt(7.2); await vi.advanceTimersByTimeAsync(900); });
    expect(rideJournal.startSession).toHaveBeenLastCalledWith(PRESET_ROUTES[0], 'route', 200, undefined, 'running');
    const latest = () => vi.mocked(rideJournal.recordSample).mock.calls.at(-1)!;
    expect(latest()[0].distanceMeters).toBeCloseTo(2, 1);
    await act(async () => { belt(0); await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    const frozen = latest()[1];
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); belt(7.2); });
    expect(latest()[1]).toBe(frozen);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.getByText(/speed signal is stale/)).toBeTruthy();
    const stale = latest()[1];
    await act(async () => { harness.trainer!.emitConnection({ state: 'reconnecting' }); await vi.advanceTimersByTimeAsync(30_000); harness.trainer!.emitConnection({ state: 'connected' }); belt(7.2); });
    expect(latest()[1]).toBe(stale);
    expect(harness.gradeCalls).toBe(0);
  });

});

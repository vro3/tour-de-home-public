import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetrySample } from '../src/types/cycling';

const storage = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  blockNextSet: false,
  failNextSet: false,
  setStarted: null as Promise<void> | null,
  signalSetStarted: null as (() => void) | null,
  setGate: null as Promise<void> | null,
  releaseSet: null as (() => void) | null,
  failPutAfter: -1,
  lastWrittenKeys: [] as string[],
}));

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => structuredClone(storage.values.get(key))),
  getMany: vi.fn(async (keys: string[]) => keys.map((key) => structuredClone(storage.values.get(key)))),
  promisifyRequest: (transaction: { done: Promise<void> }) => transaction.done,
  createStore: () => async (_mode: string, callback: (store: unknown) => Promise<void>) => {
    const staged = new Map(storage.values);
    let aborted = false;
    storage.lastWrittenKeys = [];
    const transaction = {
      abort: () => { aborted = true; },
      done: Promise.resolve().then(async () => {
        if (storage.blockNextSet) {
          storage.blockNextSet = false;
          storage.signalSetStarted?.();
          await storage.setGate;
        }
        if (aborted || storage.failNextSet) {
          storage.failNextSet = false;
          throw new Error('IndexedDB write failed');
        }
        storage.values = staged;
      }),
    };
    return callback({
      transaction,
      put: (value: unknown, key: string) => {
        if (storage.failPutAfter === 0) {
          storage.failPutAfter = -1;
          throw new Error('DataCloneError');
        }
        if (storage.failPutAfter > 0) storage.failPutAfter--;
        staged.set(key, structuredClone(value));
        storage.lastWrittenKeys.push(key);
      },
      delete: (key: string) => { staged.delete(key); },
    });
  },
}));

import { RideJournal } from '../src/storage/rideJournal';

const sample: TelemetrySample = {
  timestamp: 1_700_000_000_000,
  powerWatts: 220,
  cadenceRpm: 90,
  flywheelSpeedKph: 31,
  virtualSpeedKph: 28,
  distanceMeters: 42,
  gradePercent: 4,
  elevationMeters: 108,
  lat: 45,
  lng: 6,
};

describe('ride journal durability', () => {
  beforeEach(() => {
    storage.values.clear();
    storage.blockNextSet = false;
    storage.failNextSet = false;
    storage.setStarted = null;
    storage.signalSetStarted = null;
    storage.setGate = null;
    storage.releaseSet = null;
    storage.failPutAfter = -1;
    storage.lastWrittenKeys = [];
  });

  it('flushes the latest telemetry atomically when a ride ends', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);

    const finished = await journal.endSession(1, sample);

    expect(finished).toMatchObject({
      activeTimerSeconds: 1,
      totalDistanceMeters: 42,
      samples: [sample],
    });
    expect(storage.values.has('tour_de_home_active_ride_journal')).toBe(false);
    expect([...storage.values.keys()].some((key) => key.startsWith('tour_de_home_completed_ride_'))).toBe(true);
  });

  it('recovers a valid ride that crashed before its first telemetry sample', async () => {
    const writer = new RideJournal();
    await writer.startSession(null);

    const restored = await new RideJournal().restoreUnfinishedSession();

    expect(restored).toMatchObject({
      routeName: 'Free Ride',
      totalDistanceMeters: 0,
      activeTimerSeconds: 0,
      samples: [],
    });
  });

  it('restores defaults for a ride saved before timer and control fields existed', async () => {
    const oldSavedRide = {
      id: 'ride_legacy_schema',
      startTime: 1_700_000_000_000,
      routeName: 'Legacy Ride',
      totalDistanceMeters: 84,
      totalElevationGainMeters: 3,
      samples: [
        sample,
        { ...sample, timestamp: sample.timestamp + 1_000, distanceMeters: 84 },
      ],
    };
    storage.values.set('tour_de_home_active_ride_journal', oldSavedRide);

    const restored = await new RideJournal().restoreUnfinishedSession();

    expect(restored).toMatchObject({
      id: 'ride_legacy_schema',
      activeTimerSeconds: 2,
      controlMode: 'route',
      ergTargetWatts: 200,
    });
  });

  it('does not retain an in-memory ride when its initial journal write fails', async () => {
    const journal = new RideJournal();
    storage.failNextSet = true;

    await expect(journal.startSession(null)).rejects.toThrow('IndexedDB write failed');
    await journal.recordSample(sample, 1);

    expect(await journal.endSession(1, sample)).toBeNull();
    expect(storage.values.has('tour_de_home_active_ride_journal')).toBe(false);
  });

  it('serializes a delayed sample before discard so it cannot resurrect the active key', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);

    storage.blockNextSet = true;
    storage.setStarted = new Promise<void>((resolve) => {
      storage.signalSetStarted = resolve;
    });
    storage.setGate = new Promise<void>((resolve) => {
      storage.releaseSet = resolve;
    });

    const recording = journal.recordSample(sample, 1);
    await storage.setStarted;
    const clearing = journal.clearUnfinishedSession();
    storage.releaseSet?.();
    await Promise.all([recording, clearing]);

    expect(storage.values.has('tour_de_home_active_ride_journal')).toBe(false);
  });

  it('keeps returned sessions isolated from later caller mutation', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);
    const mutableSample = { ...sample };
    await journal.recordSample(mutableSample, 1);
    mutableSample.powerWatts = 999;

    const finished = await journal.endSession(1);

    expect(finished?.samples[0].powerWatts).toBe(220);
  });
});

const activeKey = 'tour_de_home_active_ride_journal';

describe('incremental journal transactions', () => {
  beforeEach(() => {
    storage.values.clear();
    storage.failNextSet = false;
    storage.failPutAfter = -1;
    storage.blockNextSet = false;
  });

  it('writes only one sample and metadata per successful tick, and no samples for control updates', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);
    for (let i = 0; i < 100; i++) {
      await journal.recordSample({ ...sample, timestamp: sample.timestamp + i * 1000 }, i + 1);
      expect(storage.lastWrittenKeys).toEqual([activeKey, `${activeKey}:sample:${i}`]);
    }
    await journal.updateControlMode('erg', 250);
    expect(storage.lastWrittenKeys).toEqual([activeKey]);
    expect(storage.values.get(activeKey)).not.toHaveProperty('samples');
    expect(storage.values.get(activeKey)).not.toHaveProperty('route');
    expect(await new RideJournal().restoreUnfinishedSession()).toMatchObject({ controlMode: 'erg', ergTargetWatts: 250, activeTimerSeconds: 100 });
  });

  it('recovers the previous committed prefix after a failure and retries uncommitted samples on the next write', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);
    await journal.recordSample(sample, 1);
    storage.failNextSet = true;
    await expect(journal.recordSample({ ...sample, timestamp: sample.timestamp + 1000, distanceMeters: 84 }, 2)).rejects.toThrow();
    expect(await new RideJournal().restoreUnfinishedSession()).toMatchObject({ samples: [sample], totalDistanceMeters: 42, activeTimerSeconds: 1 });
    await journal.recordSample({ ...sample, timestamp: sample.timestamp + 2000, distanceMeters: 126 }, 3);
    const recovered = await new RideJournal().restoreUnfinishedSession();
    expect(recovered?.samples).toHaveLength(3);
    expect(recovered?.totalDistanceMeters).toBe(126);
    expect(recovered?.activeTimerSeconds).toBe(3);
  });

  it('aborts an earlier metadata put if cloning a later sample throws synchronously', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);
    storage.failPutAfter = 1;
    await expect(journal.recordSample(sample, 1)).rejects.toThrow('DataCloneError');
    expect(await new RideJournal().restoreUnfinishedSession()).toMatchObject({ samples: [], activeTimerSeconds: 0 });
  });

  it.each(['tour_de_home_active_ride_journal', 'veloquest_active_ride_journal'])('migrates %s atomically and can resume afterwards', async (key) => {
    const legacy = { id: 'old', startTime: 123, routeName: 'old', totalDistanceMeters: 42, totalElevationGainMeters: 0, samples: [sample] };
    storage.values.set(key, legacy);
    storage.failNextSet = true;
    expect((await new RideJournal().restoreUnfinishedSession())?.samples).toEqual([sample]);
    expect(storage.values.get(key)).toEqual(legacy);
    const journal = new RideJournal();
    expect(await journal.restoreUnfinishedSession()).toMatchObject({ activeTimerSeconds: 1, controlMode: 'route', ergTargetWatts: 200 });
    await journal.recordSample({ ...sample, timestamp: sample.timestamp + 1000 }, 2);
    expect((await new RideJournal().restoreUnfinishedSession())?.samples).toHaveLength(2);
    expect(storage.values.has('veloquest_active_ride_journal')).toBe(false);
  });

  it('overwrites a duplicate active-time point and persists final telemetry without duplicating it', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);
    await journal.recordSample(sample, 1);
    await journal.recordSample({ ...sample, powerWatts: 250 }, 1);
    expect((await new RideJournal().restoreUnfinishedSession())?.samples).toEqual([{ ...sample, powerWatts: 250, activeTimeSeconds: 1 }]);
    const finished = await journal.endSession(1, { ...sample, powerWatts: 260 });
    expect(finished?.samples).toEqual([{ ...sample, powerWatts: 260, activeTimeSeconds: 1 }]);
    expect([...storage.values.keys()]).toEqual([`tour_de_home_completed_${finished?.id}`]);
  });

  it('keeps active data if completion fails, then atomically moves it to history on retry', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);
    await journal.recordSample(sample, 1);
    storage.failNextSet = true;
    await expect(journal.endSession(1)).rejects.toThrow();
    expect((await new RideJournal().restoreUnfinishedSession())?.samples).toEqual([{ ...sample, activeTimeSeconds: 1 }]);
    expect([...storage.values.keys()].some(key => key.startsWith('tour_de_home_completed_'))).toBe(false);
    await journal.endSession(1);
    expect(await new RideJournal().restoreUnfinishedSession()).toBeNull();
    expect(storage.values.size).toBe(1);
  });

  it('removes samples and route on discard or replacement and isolates the original route', async () => {
    const journal = new RideJournal();
    const route = { id: 'r', name: 'route', totalDistanceMeters: 100, totalElevationGainMeters: 1, points: [{ lat: 1, lng: 1, elevation: 1, cumulativeDistance: 0, grade: 0, heading: 0 }] };
    await journal.startSession(route);
    route.points[0].lat = 999;
    await journal.recordSample(sample, 1);
    expect((await new RideJournal().restoreUnfinishedSession())?.route?.points[0].lat).toBe(1);
    await journal.startSession(null);
    expect(storage.values.size).toBe(2);
    await journal.clearUnfinishedSession();
    expect(storage.values.size).toBe(0);
  });

  it('does not silently truncate a journal with a missing committed sample', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);
    await journal.recordSample(sample, 1);
    storage.values.delete(`${activeKey}:sample:0`);
    await expect(new RideJournal().restoreUnfinishedSession()).rejects.toThrow('incomplete');
    expect(storage.values.has(activeKey)).toBe(true);
  });

  it.each(['tour_de_home_active_ride_journal', 'veloquest_active_ride_journal'])('keeps %s recoverable when migration cannot write, then retries the complete conversion', async (key) => {
    const route = { id: 'old-route', name: 'Old route', totalDistanceMeters: 100, totalElevationGainMeters: 1, points: [] };
    const old = { id: 'old', startTime: 123, routeName: route.name, route, totalDistanceMeters: 42, totalElevationGainMeters: 0, samples: [sample] };
    storage.values.set(key, structuredClone(old));
    storage.failNextSet = true;
    const journal = new RideJournal();

    const recovered = await journal.restoreUnfinishedSession();
    expect(recovered?.samples).toEqual([sample]);
    expect(recovered?.route).toEqual(route);
    expect(storage.values.get(key)).toEqual(old);

    storage.failNextSet = true;
    await expect(journal.recordSample({ ...sample, timestamp: sample.timestamp + 1000 }, 2)).rejects.toThrow();
    expect(storage.values.get(key)).toEqual(old);
    await journal.updateControlMode('erg', 250);

    expect(storage.values.get(activeKey)).toMatchObject({ journalVersion: 2, sampleCount: 2 });
    const restored = await new RideJournal().restoreUnfinishedSession();
    expect(restored?.samples).toHaveLength(2);
    expect(restored?.route).toEqual(route);
    expect(restored?.controlMode).toBe('erg');
    expect(storage.values.has('veloquest_active_ride_journal')).toBe(false);
  });

  it('can finish a recovered legacy ride directly after a failed migration', async () => {
    storage.values.set('veloquest_active_ride_journal', { id: 'old', startTime: 123, routeName: 'Old ride', totalDistanceMeters: 42, totalElevationGainMeters: 0, samples: [sample] });
    storage.failNextSet = true;
    const journal = new RideJournal();
    await journal.restoreUnfinishedSession();
    const finished = await journal.endSession(1);
    expect(finished?.samples).toEqual([sample]);
    expect([...storage.values.keys()]).toEqual(['tour_de_home_completed_old']);
  });
  it('preserves fractional active time and the opponent through restart without charging wall-clock downtime', async () => {
    const journal = new RideJournal();
    await journal.startSession(null, 'route', 200, 'previous-ride');
    await journal.recordSample(sample, 1.25);
    const restarted = new RideJournal();
    const recovered = await restarted.restoreUnfinishedSession();
    expect(recovered?.activeTimerSeconds).toBe(1.25);
    expect(recovered?.raceAgainstId).toBe('previous-ride');
    await restarted.recordSample({ ...sample, timestamp: sample.timestamp + 300_000, distanceMeters: 50 }, 1.75);
    const finished = await restarted.endSession(1.75);
    expect(finished?.samples.map(s => s.activeTimeSeconds)).toEqual([1.25, 1.75]);
    expect(finished?.activeTimerSeconds).toBe(1.75);
  });

  it('keeps distinct active points even if a trainer reuses a telemetry timestamp', async () => {
    const journal = new RideJournal();
    await journal.startSession(null);
    await journal.recordSample(sample, 1);
    await journal.recordSample({ ...sample, distanceMeters: 48 }, 2);
    expect((await journal.endSession(2))?.samples.map(s => s.distanceMeters)).toEqual([42, 48]);
  });

});

import { createStore, get, getMany, promisifyRequest } from 'idb-keyval';
import { TelemetrySample, RouteModel, TrainerControlMode } from '../types/cycling';

export interface SavedRideSession {
  sport?: 'cycling' | 'running';
  importedFromFit?: boolean;
  id: string;
  startTime: number;
  endTime?: number;
  routeName: string;
  route?: RouteModel;
  totalDistanceMeters: number;
  totalElevationGainMeters: number;
  activeTimerSeconds: number;
  controlMode: TrainerControlMode;
  ergTargetWatts: number;
  samples: TelemetrySample[];
  raceAgainstId?: string;
}

const ACTIVE_RIDE_KEY = 'tour_de_home_active_ride_journal';
const LEGACY_ACTIVE_RIDE_KEY = 'veloquest_active_ride_journal';
const ROUTE_KEY = `${ACTIVE_RIDE_KEY}:route`;
const sampleKey = (index: number) => `${ACTIVE_RIDE_KEY}:sample:${index}`;

type JournalHeader = Omit<SavedRideSession, 'route' | 'samples'> & {
  journalVersion: 2;
  sampleCount: number;
};
type StoredRide = SavedRideSession | JournalHeader;
const isIncremental = (ride: StoredRide): ride is JournalHeader =>
  'journalVersion' in ride && ride.journalVersion === 2;

// Same database/store as the original idb-keyval journal and completed history.
const journalStore = createStore('keyval-store', 'keyval');

function writeAtomically(entries: [IDBValidKey, unknown][], deletions: IDBValidKey[] = []): Promise<void> {
  return journalStore('readwrite', (store) => {
    const completion = promisifyRequest(store.transaction);
    try {
      for (const [key, value] of entries) store.put(value, key);
      for (const key of deletions) store.delete(key);
    } catch (error) {
      // A synchronous clone failure must not commit preceding puts/deletes.
      store.transaction.abort();
      return completion.then(() => { throw error; }, () => { throw error; });
    }
    return completion;
  });
}

function activeKeys(ride?: StoredRide): IDBValidKey[] {
  const keys: IDBValidKey[] = [ACTIVE_RIDE_KEY, LEGACY_ACTIVE_RIDE_KEY, ROUTE_KEY];
  if (ride && isIncremental(ride)) {
    for (let i = 0; i < ride.sampleCount; i++) keys.push(sampleKey(i));
  }
  return keys;
}

export class RideJournal {
  private currentRide: SavedRideSession | null = null;
  private lastRecordedElevation: number | null = null;
  private dirtySampleStart = 0;
  private pendingMigration = false;
  private operationTail: Promise<void> = Promise.resolve();

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private snapshot(session: SavedRideSession): SavedRideSession {
    return {
      ...session,
      route: session.route ? {
        ...session.route,
        points: session.route.points.map((point) => ({ ...point })),
      } : undefined,
      samples: session.samples.map((sample) => ({ ...sample })),
    };
  }

  private header(session: SavedRideSession): JournalHeader {
    const { route: _route, samples, ...metadata } = session;
    return { ...metadata, journalVersion: 2, sampleCount: samples.length };
  }

  private sampleEntries(session: SavedRideSession, start: number): [IDBValidKey, unknown][] {
    return session.samples.slice(start).map((sample, offset) => [sampleKey(start + offset), sample]);
  }

  private async persistProgress(): Promise<void> {
    if (!this.currentRide) return;
    await writeAtomically([
      [ACTIVE_RIDE_KEY, this.header(this.currentRide)],
      ...(this.pendingMigration ? [[ROUTE_KEY, this.currentRide.route ?? null] as [IDBValidKey, unknown]] : []),
      ...this.sampleEntries(this.currentRide, this.dirtySampleStart),
    ], this.pendingMigration ? [LEGACY_ACTIVE_RIDE_KEY] : []);
    // Keep failed writes dirty so a subsequent sample/control update retries them.
    this.dirtySampleStart = this.currentRide.samples.length;
    this.pendingMigration = false;
  }

  private applySample(sample: TelemetrySample, activeTimerSeconds?: number): void {
    if (!this.currentRide) return;

    const sampleSnapshot = { ...sample };
    if (activeTimerSeconds !== undefined && Number.isFinite(activeTimerSeconds)) {
      sampleSnapshot.activeTimeSeconds = Math.max(this.currentRide.activeTimerSeconds, activeTimerSeconds, 0);
    }
    const previous = this.currentRide.samples.at(-1);
    if (previous && (sampleSnapshot.activeTimeSeconds !== undefined
      ? previous.activeTimeSeconds === sampleSnapshot.activeTimeSeconds
      : previous.timestamp === sampleSnapshot.timestamp)) {
      this.currentRide.samples[this.currentRide.samples.length - 1] = sampleSnapshot;
    } else {
      this.currentRide.samples.push(sampleSnapshot);
    }
    this.dirtySampleStart = Math.min(this.dirtySampleStart, this.currentRide.samples.length - 1);
    this.currentRide.totalDistanceMeters = Math.max(
      this.currentRide.totalDistanceMeters,
      Math.max(0, sampleSnapshot.distanceMeters),
    );
    if (activeTimerSeconds !== undefined && Number.isFinite(activeTimerSeconds)) {
      this.currentRide.activeTimerSeconds = Math.max(
        this.currentRide.activeTimerSeconds,
        Math.max(0, activeTimerSeconds),
      );
    }

    if (Number.isFinite(sampleSnapshot.elevationMeters)) {
      if (this.lastRecordedElevation !== null) {
        const elevationGain = sampleSnapshot.elevationMeters - this.lastRecordedElevation;
        if (elevationGain > 0) this.currentRide.totalElevationGainMeters += elevationGain;
      }
      this.lastRecordedElevation = sampleSnapshot.elevationMeters;
    }
  }

  public async startSession(
    route: RouteModel | null,
    controlMode: TrainerControlMode = 'route',
    ergTargetWatts: number = 200,
    raceAgainstId?: string,
    sport: 'cycling' | 'running' = 'cycling',
  ): Promise<SavedRideSession> {
    return this.enqueue(async () => {
      const startTime = Date.now();
      const session: SavedRideSession = {
        id: `ride_${startTime}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        startTime,
        routeName: route ? route.name : 'Free Ride',
        route: route ? { ...route, points: route.points.map((point) => ({ ...point })) } : undefined,
        totalDistanceMeters: 0,
        totalElevationGainMeters: 0,
        activeTimerSeconds: 0,
        controlMode,
        ergTargetWatts,
        samples: [],
        raceAgainstId,
        sport,
      };
      const previous = await get<StoredRide>(ACTIVE_RIDE_KEY);
      // Replace the active journal and remove its previous sample keys together.
      await writeAtomically(
        [[ACTIVE_RIDE_KEY, this.header(session)], [ROUTE_KEY, session.route ?? null]],
        activeKeys(previous).filter((key) => key !== ACTIVE_RIDE_KEY && key !== ROUTE_KEY),
      );
      this.currentRide = session;
      this.dirtySampleStart = 0;
      this.pendingMigration = false;
      this.lastRecordedElevation = null;
      return this.snapshot(this.currentRide);
    });
  }

  public async recordSample(sample: TelemetrySample, activeTimerSeconds?: number): Promise<void> {
    const sampleSnapshot = { ...sample };
    return this.enqueue(async () => {
      if (!this.currentRide) return;
      this.applySample(sampleSnapshot, activeTimerSeconds);
      await this.persistProgress();
    });
  }

  public async updateControlMode(controlMode: TrainerControlMode, ergTargetWatts: number): Promise<void> {
    return this.enqueue(async () => {
      if (!this.currentRide) return;
      this.currentRide.controlMode = controlMode;
      this.currentRide.ergTargetWatts = ergTargetWatts;
      await this.persistProgress();
    });
  }

  public async endSession(
    activeTimerSeconds?: number,
    finalSample?: TelemetrySample,
  ): Promise<SavedRideSession | null> {
    const finalSampleSnapshot = finalSample ? { ...finalSample } : undefined;
    return this.enqueue(async () => {
      if (!this.currentRide) return null;
      if (finalSampleSnapshot) this.applySample(finalSampleSnapshot, activeTimerSeconds);
      else if (activeTimerSeconds !== undefined && Number.isFinite(activeTimerSeconds)) {
        this.currentRide.activeTimerSeconds = Math.max(
          this.currentRide.activeTimerSeconds,
          Math.max(0, activeTimerSeconds),
        );
      }
      const finished = this.snapshot(this.currentRide);
      finished.endTime = Date.now();

      // History and active cleanup commit together: a crash sees either the
      // recoverable journal or the completed ride, never a half-finished move.
      await writeAtomically(
        [[`tour_de_home_completed_${finished.id}`, finished]],
        activeKeys(this.header(this.currentRide)),
      );
      this.currentRide = null;
      this.lastRecordedElevation = null;
      this.pendingMigration = false;

      return finished;
    });
  }

  public async restoreUnfinishedSession(): Promise<SavedRideSession | null> {
    return this.enqueue(async () => {
      const current = await get<StoredRide>(ACTIVE_RIDE_KEY);
      const legacy = current ? undefined : await get<SavedRideSession>(LEGACY_ACTIVE_RIDE_KEY);
      const stored = current ?? legacy;
      if (!stored) return null;

      let saved: SavedRideSession;
      if (isIncremental(stored)) {
        if (!Number.isSafeInteger(stored.sampleCount) || stored.sampleCount < 0) {
          throw new Error('Invalid ride journal sample count');
        }
        const values = await getMany<RouteModel | TelemetrySample | null>([
          ROUTE_KEY, ...Array.from({ length: stored.sampleCount }, (_, i) => sampleKey(i)),
        ]);
        const [route, ...samples] = values;
        if (route === undefined || samples.some((sample) => !sample)) {
          throw new Error('Ride journal is incomplete; retained for recovery');
        }
        const { journalVersion: _version, sampleCount: _count, ...metadata } = stored;
        saved = { ...metadata, route: (route as RouteModel | null) ?? undefined, samples: samples as TelemetrySample[] };
      } else {
        if (!Array.isArray(stored.samples)) return null;
        saved = stored;
      }

      saved.activeTimerSeconds ??= saved.samples.length;
      saved.controlMode ??= 'route';
      saved.ergTargetWatts ??= 200;
      let pendingMigration = false;
      if (!isIncremental(stored)) {
        // Both historical key names migrate in one transaction. If it fails,
        // keep recovery/export available from the readable original. A later
        // progress write retries the route and every sample atomically.
        try {
          await writeAtomically([
            [ACTIVE_RIDE_KEY, this.header(saved)],
            [ROUTE_KEY, saved.route ?? null],
            ...this.sampleEntries(saved, 0),
          ], [LEGACY_ACTIVE_RIDE_KEY]);
        } catch {
          pendingMigration = true;
        }
      }
      this.currentRide = this.snapshot(saved);
      this.pendingMigration = pendingMigration;
      this.dirtySampleStart = pendingMigration ? 0 : saved.samples.length;
      this.lastRecordedElevation = saved.samples.at(-1)?.elevationMeters ?? null;
      return this.snapshot(saved);
    });
  }

  public async clearUnfinishedSession(): Promise<void> {
    return this.enqueue(async () => {
      const stored = await get<StoredRide>(ACTIVE_RIDE_KEY);
      await writeAtomically([], activeKeys(stored));
      this.currentRide = null;
      this.lastRecordedElevation = null;
      this.dirtySampleStart = 0;
      this.pendingMigration = false;
    });
  }
}

export const rideJournal = new RideJournal();

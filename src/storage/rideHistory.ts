import { get, getMany, keys, set } from 'idb-keyval';
import type { SavedRideSession } from './rideJournal';

const prefix = 'tour_de_home_completed_';

export async function loadRideHistory(): Promise<SavedRideSession[]> {
  const historyKeys = (await keys()).filter(key => typeof key === 'string' && key.startsWith(prefix));
  const rides = await getMany<SavedRideSession>(historyKeys);
  return rides.filter((ride): ride is SavedRideSession => Boolean(ride && typeof ride.id === 'string' && Number.isFinite(ride.startTime)))
    .sort((a, b) => b.startTime - a.startTime);
}

export async function loadPreviousRide(id: string): Promise<SavedRideSession | undefined> {
  return get<SavedRideSession>(prefix + id);
}

export async function saveImportedRide(ride: SavedRideSession): Promise<void> {
  await set(prefix + ride.id, ride);
}

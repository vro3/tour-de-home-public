import type { RouteModel } from '../types/cycling';
import type { SavedRideSession } from '../storage/rideJournal';

export interface GhostPoint { seconds: number; distance: number }
export interface GhostRide {
  id: string;
  startedAt: number;
  points: GhostPoint[];
  duration: number;
  distance: number;
  complete: boolean;
}

// Names and IDs can be reused for changed GPX files. Compare the actual course.
export function sameCourse(a: RouteModel | undefined, b: RouteModel): boolean {
  return Boolean(a && a.totalDistanceMeters === b.totalDistanceMeters
    && Array.isArray(a.points) && a.points.length === b.points.length
    && a.points.every((p, i) => {
      const q = b.points[i];
      return p && p.lat === q.lat && p.lng === q.lng && p.elevation === q.elevation
        && p.cumulativeDistance === q.cumulativeDistance && p.grade === q.grade;
    }));
}

export function buildGhost(ride: SavedRideSession, route: RouteModel): GhostRide | null {
  if (!ride || !ride.endTime || !sameCourse(ride.route, route) || !Array.isArray(ride.samples)) return null;
  const points: GhostPoint[] = [{ seconds: 0, distance: 0 }];
  for (const sample of ride.samples) {
    if (!sample) return null;
    const seconds = sample.activeTimeSeconds;
    const distance = sample.distanceMeters;
    const previous = points.at(-1)!;
    // Never infer pauses from wall-clock timestamps or the number of samples.
    if (seconds === undefined || !Number.isFinite(seconds) || !Number.isFinite(distance)
      || seconds < previous.seconds || distance < previous.distance || distance > route.totalDistanceMeters + 0.01) return null;
    if (seconds === previous.seconds) {
      if (distance !== previous.distance) return null;
      continue;
    }
    points.push({ seconds, distance });
  }
  const last = points.at(-1)!;
  if (points.length < 2 || last.distance <= 0 || last.seconds <= 0) return null;
  return { id: ride.id, startedAt: ride.startTime, points, duration: last.seconds,
    distance: last.distance, complete: last.distance >= route.totalDistanceMeters - 0.01 };
}

function lowerBound(points: GhostPoint[], value: number, field: keyof GhostPoint): number {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid][field] < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function ghostDistanceAt(ghost: GhostRide, seconds: number): number {
  const i = lowerBound(ghost.points, Math.max(0, seconds), 'seconds');
  if (i === 0) return 0;
  if (i === ghost.points.length) return ghost.distance;
  const a = ghost.points[i - 1], b = ghost.points[i];
  return a.distance + (b.distance - a.distance) * (seconds - a.seconds) / (b.seconds - a.seconds);
}

// Positive gap means today's rider reached this point sooner than the ghost.
export function ghostGapAt(ghost: GhostRide, distance: number, seconds: number): number | null {
  if (distance > ghost.distance + 0.01 || distance < 0) return null;
  const d = Math.min(distance, ghost.distance);
  const i = lowerBound(ghost.points, d, 'distance');
  const b = ghost.points[i];
  if (!b) return null;
  if (b.distance === d) {
    // During a stationary interval, equal replays remain tied throughout it.
    let end = i;
    while (end + 1 < ghost.points.length && ghost.points[end + 1].distance === d) end++;
    return Math.max(b.seconds, Math.min(seconds, ghost.points[end].seconds)) - seconds;
  }
  const a = ghost.points[i - 1];
  return a.seconds + (b.seconds - a.seconds) * (d - a.distance) / (b.distance - a.distance) - seconds;
}

export function gapLabel(gap: number | null): string {
  if (gap === null) return 'Beyond previous ride';
  if (Math.abs(gap) < 0.05) return 'Level with your ghost';
  const value = Math.abs(gap);
  const time = value < 60 ? `${value.toFixed(1)}s` : `${Math.floor(value / 60)}m ${(value % 60).toFixed(0)}s`;
  return `${time} ${gap > 0 ? 'ahead' : 'behind'}`;
}

import { describe, expect, it } from 'vitest';
import { buildGhost, ghostDistanceAt, ghostGapAt, sameCourse } from '../src/ride/ghostRace';
import type { SavedRideSession } from '../src/storage/rideJournal';
import type { RouteModel, TelemetrySample } from '../src/types/cycling';

const route: RouteModel = { id: 'course', name: 'Course', totalDistanceMeters: 100, totalElevationGainMeters: 0,
  points: [0, 100].map(d => ({ lat: 45 + d / 10000, lng: 6, elevation: 100, cumulativeDistance: d, grade: 0, heading: 0 })) };
function ride(points: [number, number][]): SavedRideSession {
  return { id: 'previous', startTime: 1000, endTime: 100000, routeName: route.name, route,
    totalDistanceMeters: points.at(-1)![1], totalElevationGainMeters: 0, activeTimerSeconds: points.at(-1)![0],
    controlMode: 'route', ergTargetWatts: 200,
    samples: points.map(([time, distance]) => ({ timestamp: 1000 + time * 1000,
      activeTimeSeconds: time, distanceMeters: distance } as TelemetrySample)) };
}

describe('pause-safe ghost replay', () => {
  it('replays an identical ride at zero gap, including variable speed and stationary intervals', () => {
    const ghost = buildGhost(ride([[2, 10], [4, 30], [9, 30], [12, 100]]), route)!;
    for (let t = 0; t <= 12; t += 0.125) {
      expect(ghostGapAt(ghost, ghostDistanceAt(ghost, t), t)).toBeCloseTo(0, 7);
    }
  });
  it('reports ahead/behind at the same distance and interpolates between saved samples', () => {
    const ghost = buildGhost(ride([[10, 50], [20, 100]]), route)!;
    expect(ghostGapAt(ghost, 25, 3)).toBe(2);
    expect(ghostGapAt(ghost, 25, 8)).toBe(-3);
    expect(ghostDistanceAt(ghost, 7)).toBe(35);
  });
  it('ignores arbitrarily long wall-clock pauses and reconnects', () => {
    const recorded = ride([[1.25, 20], [2.75, 100]]);
    const before = buildGhost(recorded, route)!;
    recorded.samples[1].timestamp += 86_400_000;
    const after = buildGhost(recorded, route)!;
    expect(after).toEqual(before);
    expect(ghostGapAt(after, 60, 2)).toBe(0);
  });
  it('stops a partial ghost and does not invent a comparison beyond its recorded distance', () => {
    const ghost = buildGhost(ride([[5, 20]]), route)!;
    expect(ghost.complete).toBe(false);
    expect(ghostDistanceAt(ghost, 500)).toBe(20);
    expect(ghostGapAt(ghost, 21, 6)).toBeNull();
  });
  it('holds a finished ghost at the line and preserves the finish time gap', () => {
    const ghost = buildGhost(ride([[20, 100]]), route)!;
    expect(ghost.complete).toBe(true);
    expect(ghostDistanceAt(ghost, 25)).toBe(100);
    expect(ghostGapAt(ghost, 100, 25)).toBe(-5);
  });
  it('matches geometry, not a reused name or identifier', () => {
    expect(sameCourse({ ...route, id: 'renamed', name: 'Different label' }, route)).toBe(true);
    const changed = { ...route, points: route.points.map(p => ({ ...p, elevation: 200 })) };
    expect(buildGhost(ride([[20, 100]]), changed)).toBeNull();
  });
  it('keeps legacy rides ineligible rather than guessing their pause timing', () => {
    const legacy = ride([[20, 100]]);
    delete legacy.samples[0].activeTimeSeconds;
    expect(buildGhost(legacy, route)).toBeNull();
  });
  it.each([
    [[1, 20], [0.5, 30]], [[1, 20], [2, 10]], [[0, 10]], [[1, -1]], [[1, 101]], [[NaN, 20]], [[1, Infinity]],
  ] as [number, number][][])('rejects corrupt or non-monotonic timelines: %j', (...points) => {
    expect(buildGhost(ride(points), route)).toBeNull();
  });
});

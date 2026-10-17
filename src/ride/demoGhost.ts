import type { RouteModel } from '../types/cycling';
import type { GhostRide } from './ghostRace';
import { VirtualSpeedEngine, DEFAULT_RIDER_PROFILE } from '../physics/virtualSpeed';
import { getInterpolatedProgress } from '../route/routeTracker';

// An illustrative opponent, never a saved activity or a claimed personal best.
export function buildDemoGhost(route: RouteModel, riderWeightKg = 75): GhostRide {
  const engine = new VirtualSpeedEngine({ ...DEFAULT_RIDER_PROFILE, riderWeightKg });
  const points = [{ seconds: 0, distance: 0 }];
  let distance = 0;
  for (let tick = 1; tick <= 108000 && distance < route.totalDistanceMeters; tick++) {
    const grade = getInterpolatedProgress(route, distance).currentPoint.grade;
    distance = Math.min(route.totalDistanceMeters, distance + engine.step(235, grade, 0.2).distanceDeltaMeters);
    if (tick % 5 === 0 || distance === route.totalDistanceMeters) points.push({ seconds: tick / 5, distance });
  }
  const last = points[points.length - 1];
  return { id: 'demo-sample-ghost', demo: true, startedAt: 0, points, duration: last.seconds,
    distance: last.distance, complete: last.distance >= route.totalDistanceMeters };
}

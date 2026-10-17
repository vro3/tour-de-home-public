import { RouteModel, RoutePoint } from '../types/cycling';

export interface RouteProgressState {
  currentPoint: RoutePoint;
  percentComplete: number;
  distanceRemainingMeters: number;
  isFinished: boolean;
}

/**
 * Interpolates the rider's position, elevation, heading, and gradient along a RouteModel
 */
export function getInterpolatedProgress(route: RouteModel, distanceMeters: number): RouteProgressState {
  const points = route.points;
  if (!points || points.length === 0) {
    return {
      currentPoint: { lat: 0, lng: 0, elevation: 0, cumulativeDistance: 0, grade: 0, heading: 0 },
      percentComplete: 0,
      distanceRemainingMeters: 0,
      isFinished: false,
    };
  }

  const totalDist = route.totalDistanceMeters;
  const clampedDist = Math.max(0, Math.min(totalDist, distanceMeters));
  const isFinished = clampedDist >= totalDist && totalDist > 0;
  const distanceRemaining = Math.max(0, totalDist - clampedDist);
  const percentComplete = totalDist > 0 ? (clampedDist / totalDist) * 100 : 0;

  // Binary search for the bounding segment
  let low = 0;
  let high = points.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].cumulativeDistance < clampedDist) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const idx2 = Math.min(points.length - 1, Math.max(1, low));
  const idx1 = idx2 - 1;

  const p1 = points[idx1];
  const p2 = points[idx2];

  const segDist = p2.cumulativeDistance - p1.cumulativeDistance;
  let fraction = 0;
  if (segDist > 0) {
    fraction = (clampedDist - p1.cumulativeDistance) / segDist;
  }

  // Linear interpolation
  const lat = p1.lat + (p2.lat - p1.lat) * fraction;
  const lng = p1.lng + (p2.lng - p1.lng) * fraction;
  const elevation = p1.elevation + (p2.elevation - p1.elevation) * fraction;
  const grade = p1.grade + (p2.grade - p1.grade) * fraction;
  const heading = p2.heading || p1.heading;

  return {
    currentPoint: {
      lat,
      lng,
      elevation: Math.round(elevation),
      cumulativeDistance: clampedDist,
      grade: Math.round(grade * 10) / 10,
      heading,
    },
    percentComplete,
    distanceRemainingMeters: distanceRemaining,
    isFinished,
  };
}

import { RoutePoint } from '../types/cycling';

/**
 * Smooths elevation and computes realistic road gradients across a rolling distance window (e.g. 30-50m).
 * Eliminates single-meter GPS measurement noise and clamps impossible grade spikes.
 */
export function smoothRouteGrades(points: RoutePoint[], windowMeters: number = 40): RoutePoint[] {
  if (points.length < 2) return points;

  const result: RoutePoint[] = [];
  const maxGradeClamp = 25.0; // +/- 25% max gradient clamp

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const currentDist = current.cumulativeDistance;

    // Find points within [currentDist - windowMeters/2, currentDist + windowMeters/2]
    const windowStartDist = Math.max(0, currentDist - windowMeters / 2);
    const windowEndDist = currentDist + windowMeters / 2;

    let startIdx = i;
    while (startIdx > 0 && points[startIdx].cumulativeDistance > windowStartDist) {
      startIdx--;
    }

    let endIdx = i;
    while (endIdx < points.length - 1 && points[endIdx].cumulativeDistance < windowEndDist) {
      endIdx++;
    }

    // Compute average elevation across the window
    let windowElevSum = 0;
    let windowCount = 0;
    for (let k = startIdx; k <= endIdx; k++) {
      windowElevSum += points[k].elevation;
      windowCount++;
    }
    const smoothedElevation = windowCount > 0 ? windowElevSum / windowCount : current.elevation;

    const startPt = points[startIdx];
    const endPt = points[endIdx];

    const spanDistance = endPt.cumulativeDistance - startPt.cumulativeDistance;
    let localGrade = 0;

    if (spanDistance > 5) {
      const elevationDiff = endPt.elevation - startPt.elevation;
      localGrade = (elevationDiff / spanDistance) * 100;
    } else if (i > 0) {
      const prev = points[i - 1];
      const dDist = current.cumulativeDistance - prev.cumulativeDistance;
      if (dDist > 0.5) {
        localGrade = ((current.elevation - prev.elevation) / dDist) * 100;
      }
    }

    // Clamp grade to physically believable limits
    const clampedGrade = Math.max(-maxGradeClamp, Math.min(maxGradeClamp, localGrade));

    result.push({
      ...current,
      elevation: Math.round(smoothedElevation * 10) / 10,
      grade: Math.round(clampedGrade * 10) / 10, // 0.1% resolution
    });
  }

  return result;
}

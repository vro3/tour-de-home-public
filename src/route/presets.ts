import { RouteModel, RoutePoint } from '../types/cycling';
import { smoothRouteGrades } from './gradeSmoother';

// Helper to generate a realistic route preset with curvature and elevation profile
function createPresetRoute(
  id: string,
  name: string,
  startLat: number,
  startLng: number,
  segments: Array<{ lengthKm: number; gradePercent: number; turnAngle: number }>,
  baseElevation: number
): RouteModel {
  const points: RoutePoint[] = [];
  let currentLat = startLat;
  let currentLng = startLng;
  let currentElev = baseElevation;
  let currentDist = 0;
  let currentHeading = 45;
  let totalGain = 0;

  points.push({
    lat: currentLat,
    lng: currentLng,
    elevation: currentElev,
    cumulativeDistance: 0,
    grade: 0,
    heading: currentHeading,
  });

  for (const seg of segments) {
    const numSubPoints = Math.max(5, Math.round(seg.lengthKm * 10)); // Point every ~100m
    const subDist = (seg.lengthKm * 1000) / numSubPoints;
    const subElev = (subDist * (seg.gradePercent / 100));
    const subAngle = seg.turnAngle / numSubPoints;

    for (let i = 0; i < numSubPoints; i++) {
      currentHeading = (currentHeading + subAngle + 360) % 360;
      const headingRad = (currentHeading * Math.PI) / 180;

      // Approximate lat/lng movement per meter
      const dLat = (subDist * Math.cos(headingRad)) / 111139;
      const dLng = (subDist * Math.sin(headingRad)) / (111139 * Math.cos((currentLat * Math.PI) / 180));

      currentLat += dLat;
      currentLng += dLng;
      currentElev += subElev;
      if (subElev > 0) totalGain += subElev;
      currentDist += subDist;

      points.push({
        lat: currentLat,
        lng: currentLng,
        elevation: currentElev,
        cumulativeDistance: currentDist,
        grade: seg.gradePercent,
        heading: Math.round(currentHeading),
      });
    }
  }

  const smoothed = smoothRouteGrades(points, 40);

  return {
    id,
    name,
    totalDistanceMeters: currentDist,
    totalElevationGainMeters: Math.round(totalGain),
    points: smoothed,
  };
}

export const PRESET_ROUTES: RouteModel[] = [
  createPresetRoute(
    'alpe_dhuez',
    "Alpine Ascent (simulated)",
    45.0592,
    6.0384,
    [
      { lengthKm: 1.0, gradePercent: 10.4, turnAngle: 45 },
      { lengthKm: 2.0, gradePercent: 9.8, turnAngle: -70 },
      { lengthKm: 1.5, gradePercent: 8.2, turnAngle: 90 },
      { lengthKm: 2.5, gradePercent: 9.1, turnAngle: -110 },
      { lengthKm: 3.0, gradePercent: 7.9, turnAngle: 80 },
      { lengthKm: 2.0, gradePercent: 8.5, turnAngle: -60 },
      { lengthKm: 1.8, gradePercent: 5.2, turnAngle: 30 },
    ],
    740
  ),
  createPresetRoute(
    'hawk_hill',
    'Coastal Climb (simulated)',
    37.8324,
    -122.4851,
    [
      { lengthKm: 0.8, gradePercent: 4.5, turnAngle: 20 },
      { lengthKm: 1.2, gradePercent: 6.8, turnAngle: 65 },
      { lengthKm: 1.5, gradePercent: 8.4, turnAngle: -45 },
      { lengthKm: 1.0, gradePercent: 5.1, turnAngle: 35 },
    ],
    30
  ),
  createPresetRoute(
    'central_park',
    'Parkland Roll (simulated)',
    40.7686,
    -73.9744,
    [
      { lengthKm: 2.0, gradePercent: 1.2, turnAngle: 80 },
      { lengthKm: 1.5, gradePercent: -1.8, turnAngle: 40 },
      { lengthKm: 2.0, gradePercent: 5.6, turnAngle: 90 }, // Harlem Hill climb
      { lengthKm: 2.2, gradePercent: -2.1, turnAngle: 85 },
      { lengthKm: 2.0, gradePercent: 2.3, turnAngle: 65 },
    ],
    25
  ),
  createPresetRoute(
    'b3_signoff_test',
    'Trainer Check (~2 min)',
    36.1627,
    -86.7816,
    [
      { lengthKm: 0.1, gradePercent: 0, turnAngle: 10 },    // flat baseline
      { lengthKm: 0.15, gradePercent: 6.0, turnAngle: -20 }, // climb — resistance rises
      { lengthKm: 0.1, gradePercent: 0, turnAngle: 15 },    // flat — resistance releases
      { lengthKm: 0.15, gradePercent: 9.0, turnAngle: -15 }, // steep climb — harder still
      { lengthKm: 0.1, gradePercent: -4.0, turnAngle: 20 },  // descent — goes easy
      { lengthKm: 0.05, gradePercent: 0, turnAngle: 0 },    // finish
    ],
    150
  ),
];

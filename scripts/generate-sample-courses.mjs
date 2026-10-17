// Original mathematical fixtures, not recordings or reconstructions of real roads.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('public/course-library');
await mkdir(path.join(root, 'samples'), { recursive: true });
const recipes = [
  { id: 'first-ride', name: 'First Ride', distance: 650, elevation: t => 100 + 2 * Math.sin(t * Math.PI * 2) },
  { id: 'rolling-hills', name: 'Rolling Hills', distance: 6000, elevation: t => 100 + 30 * (1 - Math.cos(t * Math.PI * 6)) },
  { id: 'steady-climb', name: 'Steady Climb', distance: 4000, elevation: t => 100 + t * 200 },
];
const courses = [];
for (const recipe of recipes) {
  const count = Math.ceil(recipe.distance / 25);
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    return { lat: 45 + (t * recipe.distance / 6371000) * 180 / Math.PI, lng: 6, elevation: recipe.elevation(t) };
  });
  const ascent = points.slice(1).reduce((sum, p, i) => sum + Math.max(0, p.elevation - points[i].elevation), 0);
  const file = `samples/${recipe.id}.gpx`;
  await writeFile(path.join(root, file), `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tour de Home" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><desc>Original synthetic course, MIT licensed. Not a real-world navigation route.</desc></metadata>
  <trk><name>${recipe.name}</name><trkseg>
${points.map(p => `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"><ele>${p.elevation.toFixed(2)}</ele></trkpt>`).join('\n')}
  </trkseg></trk>
</gpx>
`);
  courses.push({ id: recipe.id, name: recipe.name, raceName: '', format: 'sample',
    country: 'Simulated', countryCode: '', city: 'Original synthetic course', region: '', year: null,
    distanceKm: recipe.distance / 1000, elevationGainM: Math.round(ascent),
    estimatedHours: recipe.distance / 20000, underFiveHours: true, pointCount: points.length,
    courseLaps: 1, file, sourcePageUrl: null, officialStatus: 'Original synthetic route',
    license: 'MIT', tags: ['sample', 'synthetic'],
  });
}
await writeFile(path.join(root, 'courses.json'), JSON.stringify({
  source: 'Original simulated courses for exploring Tour de Home. Import your own GPX to ride a real route.',
  disclaimer: 'These routes are fictional and are not intended for outdoor navigation.',
  stats: { total: courses.length, underFiveHours: courses.length, countries: 0, formats: { sample: courses.length } },
  countries: ['Simulated'], courses,
}, null, 2) + '\n');
console.log(`Generated ${courses.length} original sample courses.`);

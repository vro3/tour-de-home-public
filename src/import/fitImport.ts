import FitParser, { type ParsedFit } from 'fit-file-parser';
import type { RouteModel, RoutePoint, TelemetrySample } from '../types/cycling';
import type { SavedRideSession } from '../storage/rideJournal';
import { calculateBearingDegrees } from '../route/gpxParser';
import { smoothRouteGrades } from '../route/gradeSmoother';
import { buildGhost } from '../ride/ghostRace';

export const MAX_FIT_BYTES = 20_000_000;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const time = (v: Date | undefined) => v instanceof Date ? v.getTime() / 1000 : NaN;
const fail = (message: string): never => { throw new Error(message); };

// Timer events are authoritative. Summary totals alone cannot locate pauses.
export function convertFitActivity(data: ParsedFit, id: string, name: string): SavedRideSession {
  if (data.file_ids?.[0]?.type !== 'activity') fail('Choose a FIT activity file, not a workout or course file.');
  if (data.sessions?.length !== 1) fail('Choose a single ride or run FIT file. Multisport files are not supported.');
  const session = data.sessions![0];
  if (session.sport !== 'cycling' && session.sport !== 'running' && session.sport !== 'walking') {
    fail('This FIT file must contain a cycling, running, or walking activity.');
  }
  const start = time(session.start_time), end = time(session.timestamp);
  const total = session.total_timer_time;
  if (!finite(start) || !finite(end) || end <= start || !finite(total) || total <= 0 || total > end - start + 1) {
    fail('This file is missing a valid activity clock. Export the original FIT file from your recording device.');
  }
  const intervals: { start: number; end: number; offset: number }[] = [];
  const events = (data.events ?? []).filter(e => e.event === 'timer');
  let opened: number | null = null, active = 0, previous = -Infinity;
  for (const event of events) {
    const t = time(event.timestamp);
    if (!finite(t) || t < previous || t < start || t > end) fail('The FIT timer events are out of order or outside the activity.');
    previous = t;
    if (event.event_type === 'start') {
      if (opened !== null) fail('The FIT file has overlapping timer starts.');
      opened = t;
    } else if (['stop', 'stop_all', 'stop_disable', 'stop_disable_all'].includes(String(event.event_type))) {
      if (opened === null) return fail('The FIT file has a timer stop without a start.');
      if (t > opened) intervals.push({ start: opened, end: t, offset: active });
      active += t - opened;
      opened = null;
    } else fail('This FIT file uses an unsupported timer event.');
  }
  if (events.length === 0) {
    if (Math.abs(end - start - total!) > 1) fail('This file contains pauses but no timer events to locate them. Export the original FIT from your device; a pause-accurate ghost cannot be made from this file.');
    intervals.push({ start, end, offset: 0 });
    active = end - start;
  } else if (opened !== null) fail('The FIT timer never stops. This recording may be incomplete.');
  if (!intervals.length || Math.abs(active - total!) > 1) fail('The FIT timer events disagree with the activity total. Import stopped to avoid an inaccurate ghost.');
  const records = data.records ?? [];
  if (records.length < 2 || records.length > 200_000) fail('FIT files must contain between 2 and 200,000 activity records.');
  const rows: { t: number; d: number; r: typeof records[number] }[] = [];
  let lastT = -Infinity, lastD = -Infinity;
  for (const r of records) {
    const t = time(r.timestamp);
    if (!finite(t) || t < lastT || t < start || t > end) fail('Activity record timestamps are missing or out of order.');
    lastT = t;
    // Sensor-only records can omit distance. Never infer distance from speed or GPS.
    if (!finite(r.distance)) continue;
    if (r.distance < 0 || r.distance < lastD) fail('Recorded distance goes backwards. This file cannot provide a reliable ghost.');
    if (rows.at(-1)?.t === t) {
      if (rows.at(-1)!.d !== r.distance) fail('Conflicting distances share one FIT timestamp.');
      continue;
    }
    lastD = r.distance;
    rows.push({ t, d: r.distance, r });
  }
  if (rows.length < 2) fail('This FIT file has no usable distance stream.');
  // Compare records on the active timeline; sparse recording interpolates over active seconds only.
  const samples: TelemetrySample[] = [];
  let intervalIndex = 0;
  for (const { t, d, r } of rows) {
    while (intervalIndex < intervals.length - 1 && t > intervals[intervalIndex].end) intervalIndex++;
    const interval = intervals[intervalIndex];
    if (t < interval.start || t > interval.end) {
      const previousSample = samples.at(-1);
      if (previousSample && Math.abs(d - rows[0].d - previousSample.distanceMeters) > 0.01) fail('Distance changes while the FIT timer is paused. This file cannot provide an accurate ghost.');
      continue;
    }
    const seconds = interval.offset + t - interval.start;
    const distance = d - rows[0].d;
    const previousSample = samples.at(-1);
    if (seconds === previousSample?.activeTimeSeconds && Math.abs(distance - previousSample.distanceMeters) > 0.01) {
      fail('Distance changes across a paused timer boundary. This file cannot provide an accurate ghost.');
    }
    samples.push({ timestamp: t * 1000, activeTimeSeconds: seconds, distanceMeters: distance,
      powerWatts: finite(r.power) ? r.power : 0, cadenceRpm: finite(r.cadence) ? r.cadence : 0,
      flywheelSpeedKph: 0, virtualSpeedKph: finite(r.enhanced_speed ?? r.speed) ? (r.enhanced_speed ?? r.speed)! * 3.6 : 0,
      heartRateBpm: finite(r.heart_rate) ? r.heart_rate : undefined,
      elevationMeters: finite(r.enhanced_altitude ?? r.altitude) ? (r.enhanced_altitude ?? r.altitude)! : 0,
      gradePercent: 0, lat: r.position_lat, lng: r.position_long });
  }
  const lastSample = samples.at(-1);
  if (lastSample && lastSample.activeTimeSeconds! < active) samples.push({ ...lastSample, timestamp: intervals.at(-1)!.end * 1000, activeTimeSeconds: active });
  if (samples.length < 2 || samples[0].distanceMeters !== 0) fail('The first active distance record is missing.');
  const distance = samples.at(-1)!.distanceMeters;
  if (distance < 1 || distance > 2_000_000) fail('The activity distance is outside the supported range (1 m–2,000 km).');
  // Indoor files have no GPS. A clearly labelled virtual straight course keeps their measured distance.
  const gps = samples.every(s => finite(s.lat) && finite(s.lng) && Math.abs(s.lat!) <= 90 && Math.abs(s.lng!) <= 180);
  const points: RoutePoint[] = [];
  for (const s of samples) {
    if (points.at(-1)?.cumulativeDistance === s.distanceMeters) continue;
    const p: RoutePoint = { lat: gps ? s.lat! : s.distanceMeters / 111_195, lng: gps ? s.lng! : 0,
      elevation: gps ? s.elevationMeters : 0, cumulativeDistance: s.distanceMeters, grade: 0, heading: 0 };
    const prev = points.at(-1);
    if (prev) p.heading = calculateBearingDegrees(prev.lat, prev.lng, p.lat, p.lng);
    points.push(p);
  }
  const smoothed = smoothRouteGrades(points);
  const route: RouteModel = { id: `fit_course_${id}`, name, synthetic: !gps,
    totalDistanceMeters: distance, totalElevationGainMeters: smoothed.reduce((sum, p, i) => sum + (i ? Math.max(0, p.elevation - smoothed[i - 1].elevation) : 0), 0), points: smoothed };
  if (!gps) for (const s of samples) { delete s.lat; delete s.lng; }
  const ride: SavedRideSession = { id: `fit_${id}`, startTime: start * 1000, endTime: end * 1000,
    routeName: name, route, totalDistanceMeters: distance, totalElevationGainMeters: route.totalElevationGainMeters,
    activeTimerSeconds: active, samples, controlMode: 'route', ergTargetWatts: 200,
    sport: session.sport === 'cycling' ? 'cycling' : 'running', importedFromFit: true };
  if (!buildGhost(ride, route)) fail('This recording cannot be replayed as a consistent ghost.');
  return ride;
}

export async function importFit(buffer: ArrayBuffer, filename: string): Promise<SavedRideSession> {
  if (buffer.byteLength > MAX_FIT_BYTES || buffer.byteLength < 14) fail('Choose an original FIT file smaller than 20 MB.');
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const id = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  let data: ParsedFit;
  try { data = await new FitParser({ force: false, strict: true, mode: 'list', speedUnit: 'm/s', lengthUnit: 'm' }).parseAsync(buffer); }
  catch { return fail('This FIT file is damaged or incomplete. Download Export Original again and choose the .fit file.'); }
  return convertFitActivity(data, id, filename.replace(/\.fit$/i, '').slice(0, 160) || 'Imported activity');
}

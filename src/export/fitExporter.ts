import { FitWriter } from '@markw65/fit-file-writer';
import { SavedRideSession } from '../storage/rideJournal';

/** Export standard activity messages; an independent parser verifies these in tests. */
export function exportSessionToFit(session: SavedRideSession): Uint8Array {
  const writer = new FitWriter({ noCompressedTimestamps: true });
  const startTime = new Date(session.startTime);
  const endTime = new Date(session.endTime || session.startTime + session.samples.length * 1000);
  const start = writer.time(startTime);
  const end = writer.time(endTime);
  const elapsed = Math.max(1, Math.round((endTime.getTime() - startTime.getTime()) / 1000));
  const active = session.activeTimerSeconds > 0 ? session.activeTimerSeconds : elapsed;
  const samples = session.samples;
  const cadences = samples.filter(s => s.cadenceRpm > 0);
  const heartRates = samples.flatMap(s => s.heartRateBpm !== undefined && s.heartRateBpm > 0 ? [s.heartRateBpm] : []);
  const summary = {
    timestamp: end,
    start_time: start,
    total_elapsed_time: elapsed,
    total_timer_time: active,
    total_distance: session.totalDistanceMeters,
    avg_power: samples.length ? Math.round(samples.reduce((sum, s) => sum + s.powerWatts, 0) / samples.length) : 0,
    max_power: samples.reduce((max, s) => Math.max(max, s.powerWatts), 0),
    avg_speed: session.totalDistanceMeters / active,
    max_speed: samples.reduce((max, s) => Math.max(max, s.virtualSpeedKph / 3.6), 0),
    avg_cadence: cadences.length ? Math.round(cadences.reduce((sum, s) => sum + s.cadenceRpm, 0) / cadences.length) : 0,
    total_ascent: Math.round(session.totalElevationGainMeters),
    ...(heartRates.length ? {
      avg_heart_rate: Math.round(heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length),
      max_heart_rate: heartRates.reduce((max, value) => Math.max(max, value), 0),
    } : {}),
    sport: session.sport === 'running' ? 'running' as const : 'cycling' as const,
    sub_sport: session.sport === 'running' ? 'treadmill' as const : 'indoor_cycling' as const,
  };

  writer.writeMessage('file_id', {
    type: 'activity', manufacturer: 'development', product: 1,
    serial_number: 1826, time_created: start,
  }, null, true);
  writer.writeMessage('event', { event: 'timer', event_type: 'start', timestamp: start });

  let previousWall = start;
  let encodedPause = 0;
  const timed = samples.every(s => Number.isFinite(s.activeTimeSeconds));
  const emitPause = (timestamp: number, activeSeconds: number) => {
    const wall = writer.time(new Date(timestamp));
    // Quantize the cumulative paused clock once, rather than accumulating per-sample rounding jitter.
    const totalPause = Math.max(0, Math.round((timestamp - session.startTime) / 1000 - activeSeconds));
    const delta = Math.max(0, Math.min(wall - previousWall, totalPause - encodedPause));
    if (delta > 0) {
      writer.writeMessage('event', { event: 'timer', event_type: 'stop_all', timestamp: previousWall });
      writer.writeMessage('event', { event: 'timer', event_type: 'start', timestamp: previousWall + delta });
      encodedPause += delta;
    }
    previousWall = wall;
  };
  // Standard FIT timestamps resolve to whole seconds. Keep the final observation in each second.
  const records = samples.filter((s, i) => !samples[i + 1] || writer.time(new Date(s.timestamp)) !== writer.time(new Date(samples[i + 1].timestamp)));
  for (const s of records) {
    if (timed) emitPause(s.timestamp, s.activeTimeSeconds!);
    writer.writeMessage('record', {
      timestamp: writer.time(new Date(s.timestamp)),
      distance: s.distanceMeters,
      enhanced_speed: s.virtualSpeedKph / 3.6,
      power: Math.round(s.powerWatts),
      cadence: Math.round(s.cadenceRpm),
      ...(!session.route?.synthetic && s.lat !== undefined && s.lng !== undefined ? {
        position_lat: writer.latlng(s.lat * Math.PI / 180),
        position_long: writer.latlng(s.lng * Math.PI / 180),
      } : {}),
      ...(s.elevationMeters !== undefined ? { enhanced_altitude: s.elevationMeters } : {}),
      ...(s.heartRateBpm !== undefined && s.heartRateBpm > 0 ? { heart_rate: Math.round(s.heartRateBpm) } : {}),
    });
  }
  if (timed) emitPause(endTime.getTime(), active);
  writer.writeMessage('event', { event: 'timer', event_type: 'stop_all', timestamp: end }, null, true);
  writer.writeMessage('lap', { ...summary, message_index: { value: 0 }, intensity: 'active', lap_trigger: 'manual' }, null, true);
  writer.writeMessage('session', {
    ...summary, message_index: { value: 0 }, first_lap_index: 0, num_laps: 1,
    event: 'session', event_type: 'stop',
  }, null, true);
  writer.writeMessage('activity', {
    timestamp: end,
    local_timestamp: end - endTime.getTimezoneOffset() * 60,
    num_sessions: 1, type: 'manual', total_timer_time: active,
    event: 'activity', event_type: 'stop', event_group: 0,
  }, null, true);
  const view = writer.finish();
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function downloadFitFile(session: SavedRideSession) {
  const bytes = exportSessionToFit(session);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeRouteName = session.routeName.replace(/[^a-z0-9_-]+/gi, '_');
  a.download = `Tour_de_Home_${new Date(session.startTime).toISOString().slice(0, 10)}_${safeRouteName}.fit`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

import { FitWriter } from '@markw65/fit-file-writer';
// Original synthetic fixture: 10 active seconds, a 20-second pause, then 10 active seconds.
export function makeFitActivity({ sport = 'cycling', gps = true, events = true, paused = true } = {}) {
  const writer = new FitWriter({ noCompressedTimestamps: true });
  const start = writer.time(new Date('2026-01-01T12:00:00Z'));
  const end = paused ? 40 : 20;
  writer.writeMessage('file_id', { type: 'activity', manufacturer: 'development', time_created: start });
  if (events) writer.writeMessage('event', { event: 'timer', event_type: 'start', timestamp: start });
  for (let t = 0; t <= end; t++) {
    if (paused && t > 10 && t < 30) continue;
    if (paused && t === 30 && events) writer.writeMessage('event', { event: 'timer', event_type: 'start', timestamp: start + t });
    const active = t > 10 && paused ? t - 20 : t;
    writer.writeMessage('record', { timestamp: start + t, distance: active * 3, enhanced_speed: 3,
      enhanced_altitude: 100 + active / 10, power: 180, cadence: 85, heart_rate: 140,
      ...(gps ? { position_lat: writer.latlng((45 + active * 0.00002) * Math.PI / 180), position_long: writer.latlng(6 * Math.PI / 180) } : {}) });
    if (paused && t === 10 && events) writer.writeMessage('event', { event: 'timer', event_type: 'stop_all', timestamp: start + t });
  }
  if (events) writer.writeMessage('event', { event: 'timer', event_type: 'stop_all', timestamp: start + end });
  writer.writeMessage('session', { timestamp: start + end, start_time: start, total_elapsed_time: end, total_timer_time: 20,
    total_distance: 60, sport, sub_sport: sport === 'running' ? 'treadmill' : 'generic' });
  writer.writeMessage('activity', { timestamp: start + end, total_timer_time: 20, num_sessions: 1, type: 'manual' });
  const view = writer.finish();
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

import type { TelemetrySample } from '../types/cycling';
export function TreadmillHud({ sample, seconds, distance, paused }: { sample: TelemetrySample; seconds: number; distance: number; paused: boolean }) {
  const speed = paused ? 0 : sample.virtualSpeedKph;
  const paceSeconds = speed > 0 ? Math.round(3600 / speed) : 0;
  return <section aria-label="Treadmill activity" className="shrink-0 rounded-2xl border border-violet-400/30 bg-slate-950 p-3 text-sm text-slate-200">
    <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono">
      <span>Time {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
      <span>Distance {(distance / 1000).toFixed(2)} km</span>
      <span>Speed {speed.toFixed(1)} km/h</span>
      <span>Pace {paceSeconds ? `${Math.floor(paceSeconds / 60)}:${String(paceSeconds % 60).padStart(2, '0')} /km` : '—'}</span>
      <span>Belt incline {sample.treadmillInclinePercent === undefined ? '—' : `${sample.treadmillInclinePercent.toFixed(1)}%`}</span>
      {sample.heartRateBpm !== undefined && <span>Heart rate {sample.heartRateBpm} bpm</span>}
    </div>
    <p className="mt-2 text-xs text-slate-400">Treadmill sync reads your speed. Pause, Finish, and connection loss only pause this app. Stop or adjust the belt on the treadmill console.</p>
  </section>;
}

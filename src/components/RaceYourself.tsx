import { Ghost } from 'lucide-react';
import type { GhostRide } from '../ride/ghostRace';
import { gapLabel, ghostDistanceAt, ghostGapAt } from '../ride/ghostRace';

export function RacePicker({ ghosts, selectedId, onSelect, loading, error, onRetry }: {
  ghosts: GhostRide[]; selectedId: string; onSelect: (id: string) => void;
  loading: boolean; error: string | null; onRetry: () => void;
}) {
  return <section aria-labelledby="race-yourself-title" className="rounded-2xl border border-violet-400/30 bg-slate-950/80 p-4 text-slate-200">
    <h2 id="race-yourself-title" className="flex items-center gap-2 font-bold"><Ghost className="h-5 w-5 shrink-0 text-violet-300" /> Race Yourself</h2>
    <p className="my-2 text-sm text-slate-400">Chase one previous ride on this exact course. Pauses and reconnection time don’t count.</p>
    {error ? <div role="alert" className="text-sm text-amber-200">{error} <button onClick={onRetry} className="min-h-11 underline">Try again</button></div>
      : loading ? <p role="status" className="text-sm">Loading previous rides…</p>
      : ghosts.length === 0 ? <p className="text-sm text-violet-200">Record and save a ride on this course to create your first ghost. Older rides without pause-safe timing stay saved but cannot be raced.</p>
      : <label className="block text-sm font-semibold">Previous ride
        <select aria-label="Previous ride to race" value={selectedId} onChange={e => onSelect(e.target.value)} className="mt-2 block min-h-11 w-full min-w-0 rounded-xl border border-slate-600 bg-slate-900 p-2 text-white">
          <option value="">Ride without a ghost</option>
          {ghosts.map(g => <option key={g.id} value={g.id}>{new Date(g.startedAt).toLocaleString()} · {Math.floor(g.duration / 60)}m {Math.floor(g.duration % 60)}s · {(g.distance / 1000).toFixed(2)} km{g.complete ? '' : ' · partial ride'}</option>)}
        </select>
      </label>}
  </section>;
}

export function RaceHud({ ghost, seconds, distance, paused, totalDistance }: {
  ghost: GhostRide; seconds: number; distance: number; paused: boolean; totalDistance: number;
}) {
  const ghostDistance = ghostDistanceAt(ghost, seconds);
  const percent = (d: number) => Math.max(0, Math.min(100, d / totalDistance * 100));
  const gap = ghostGapAt(ghost, distance, seconds);
  return <section aria-label="Race Yourself comparison" data-race-seconds={seconds.toFixed(3)} data-ghost-distance={ghostDistance.toFixed(3)}
    className="shrink-0 rounded-xl border border-violet-400/30 bg-slate-950/90 px-4 py-2 text-sm text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span className="flex items-center gap-2 font-bold text-violet-200"><Ghost className="h-4 w-4" /> {ghost.demo ? 'Demo ghost' : 'Your ghost'}{paused ? ' · Paused' : ''}</span>
      <output aria-label="Live time gap" aria-live="off" className="font-mono font-bold tabular-nums">{gapLabel(gap)}</output>
      <span className="text-xs text-slate-400">{seconds >= ghost.duration ? (ghost.complete ? 'Ghost finished' : 'Previous ride ended') : `${Math.round(Math.abs(ghostDistance - distance))} m ${ghostDistance > distance ? 'in front' : 'behind you'}`}</span>
    </div>
    <div aria-label="Course progress: cyan is you, violet is your ghost" className="relative mx-2 mb-1 mt-3 h-2 rounded-full bg-slate-800">
      <span className="absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-cyan-300" style={{ left: `${percent(distance)}%` }} />
      <Ghost aria-label="Ghost position" className="absolute -top-1 h-4 w-4 -translate-x-1/2 fill-violet-500 text-violet-100" style={{ left: `${percent(ghostDistance)}%` }} />
    </div>
  </section>;
}

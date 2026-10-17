import React, { useRef, useState } from 'react';
import { Trophy, Download, RotateCcw, Clock, Flag, Zap, RotateCw, Mountain, Home } from 'lucide-react';
import { SavedRideSession } from '../storage/rideJournal';
import { downloadTcxFile } from '../export/tcxExporter';
import { gapLabel, ghostGapAt, type GhostRide } from '../ride/ghostRace';
import { useModalFocus } from './useModalFocus';

interface SummaryModalProps {
  raceGhost?: GhostRide | null;
  isOpen: boolean;
  session: SavedRideSession | null;
  onHome: () => void;
  onRideAgain: () => void;
}

function formatDuration(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

export const SummaryModal: React.FC<SummaryModalProps> = ({
  raceGhost,
  isOpen,
  session,
  onHome,
  onRideAgain,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const homeButtonRef = useRef<HTMLButtonElement>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useModalFocus(isOpen, dialogRef, homeButtonRef, onHome);

  if (!isOpen || !session) return null;

  const totalElapsedSeconds = session.endTime
    ? Math.round((session.endTime - session.startTime) / 1000)
    : session.samples.length;
  const activeTimerSeconds = session.activeTimerSeconds > 0
    ? session.activeTimerSeconds
    : totalElapsedSeconds;

  const distanceKm = (session.totalDistanceMeters / 1000).toFixed(2);
  const avgSpeedKph = activeTimerSeconds > 0 ? ((session.totalDistanceMeters / 1000) / (activeTimerSeconds / 3600)).toFixed(1) : '0.0';

  let totalWatts = 0;
  let maxWatts = 0;
  let totalCadence = 0;
  let cadenceCount = 0;

  for (const s of session.samples) {
    totalWatts += s.powerWatts;
    if (s.powerWatts > maxWatts) maxWatts = s.powerWatts;
    if (s.cadenceRpm > 0) {
      totalCadence += s.cadenceRpm;
      cadenceCount++;
    }
  }

  const avgWatts = session.samples.length > 0 ? Math.round(totalWatts / session.samples.length) : 0;
  const avgCadence = cadenceCount > 0 ? Math.round(totalCadence / cadenceCount) : 0;
  const calories = Math.round((avgWatts * activeTimerSeconds * 4) / 4184);
  const handleFitDownload = async () => {
    setExportError(null);
    try {
      const { downloadFitFile } = await import('../export/fitExporter');
      downloadFitFile(session);
    } catch {
      setExportError('The FIT download could not be created. Your ride is saved. Try again or download TCX.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ride-summary-title"
    >
      <div ref={dialogRef} className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl border border-cardBorder bg-card p-6 text-slate-100 shadow-2xl flex flex-col gap-6 md:p-8">
        {exportError && <p role="alert" className="text-sm text-red-200">{exportError}</p>}
        {/* Header Banner */}
        <div className="flex items-center gap-4 border-b border-slate-800 pb-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-950">
            <Trophy className="w-8 h-8 fill-current" />
          </div>
          <div>
            <span className="text-xs font-extrabold uppercase tracking-widest text-amber-400">
              {session.sport === 'running' ? 'Run Complete' : 'Ride Complete'}
            </span>
            <h2 id="ride-summary-title" className="text-2xl font-black text-white">{session.routeName}</h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {new Date(session.startTime).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {raceGhost && <section aria-label="Race Yourself result" className="rounded-xl border border-violet-400/30 bg-violet-950/30 p-4">
          <h3 className="font-bold text-violet-200">Race Yourself</h3>
          <p className="mt-1 font-mono text-lg">{gapLabel(ghostGapAt(raceGhost, session.totalDistanceMeters, session.activeTimerSeconds))}</p>
          <p className="mt-1 text-xs text-slate-400">Compared at the same course distance using active riding time.{!raceGhost.complete || session.totalDistanceMeters < (session.route?.totalDistanceMeters ?? Infinity) - 0.01 ? ' Partial ride comparison.' : ''}</p>
        </section>}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold"><Clock className="w-4 h-4 text-cyan-400" /> Time</span>
            <span className="font-mono text-2xl font-black text-white">{formatDuration(activeTimerSeconds)}</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold"><Flag className="w-4 h-4 text-emerald-400" /> Distance</span>
            <span className="font-mono text-2xl font-black text-white">{distanceKm} <span className="text-xs font-normal text-slate-400">km</span></span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold"><Zap className="w-4 h-4 text-emerald-400" /> Avg Power</span>
            <span className="font-mono text-2xl font-black text-white">{session.sport === 'running' ? '—' : avgWatts} <span className="text-xs font-normal text-slate-400">W</span></span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold"><Zap className="w-4 h-4 text-orange-400" /> Max Power</span>
            <span className="font-mono text-2xl font-black text-white">{session.sport === 'running' ? '—' : maxWatts} <span className="text-xs font-normal text-slate-400">W</span></span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold"><RotateCw className="w-4 h-4 text-sky-400" /> Avg Cadence</span>
            <span className="font-mono text-2xl font-black text-white">{session.sport === 'running' ? '—' : avgCadence} <span className="text-xs font-normal text-slate-400">RPM</span></span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold"><Mountain className="w-4 h-4 text-orange-400" /> Elevation Gain</span>
            <span className="font-mono text-2xl font-black text-white">+{Math.round(session.totalElevationGainMeters)} <span className="text-xs font-normal text-slate-400">m</span></span>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/40 border border-slate-800/50 rounded-2xl text-xs font-mono text-slate-400">
          <span>Avg Speed: <strong className="text-white">{avgSpeedKph} km/h</strong></span>
          {session.sport !== 'running' && <span>Estimated Energy: <strong className="text-white">{calories} kcal</strong></span>}
        </div>

        {/* Activity Export Buttons */}
        <div className="flex flex-col gap-2.5 pt-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Export Activity to Fitness Platforms
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void handleFitDownload()}
              className="flex items-center justify-center gap-2.5 px-5 py-3.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-sm rounded-2xl shadow-lg shadow-cyan-500/20 transition-all active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
            >
              <Download className="w-4 h-4" />
              Download .FIT (Recommended)
            </button>

            <button
              type="button"
              onClick={() => downloadTcxFile(session)}
              className="flex items-center justify-center gap-2.5 px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700 transition-all active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              <Download className="w-4 h-4" />
              Download .TCX (XML)
            </button>
          </div>
          <p className="text-[11px] text-slate-500 text-center">
            Compatible with Strava, Garmin Connect, Map My Tracks, and TrainingPeaks.
          </p>
        </div>

        {/* Footer actions */}
        <div className="grid grid-cols-1 gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2">
          <button
            type="button"
            ref={homeButtonRef}
            onClick={onHome}
            className="flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 px-6 py-3 text-sm font-bold text-white transition-all hover:bg-slate-700 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            <Home className="w-4 h-4" />
            Back to Home
          </button>
          <button
            type="button"
            onClick={onRideAgain}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-2xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
          >
            <RotateCcw className="w-4 h-4" />
            Ride Again
          </button>
        </div>
      </div>
    </div>
  );
};

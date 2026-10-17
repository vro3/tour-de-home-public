import React, { useRef } from 'react';
import { AlertTriangle, RotateCcw, Download, Trash2 } from 'lucide-react';
import { SavedRideSession } from '../storage/rideJournal';
import { useModalFocus } from './useModalFocus';

interface CrashRecoveryModalProps {
  isOpen: boolean;
  session: SavedRideSession | null;
  onResume: () => void;
  onExportAndDiscard: () => void;
  onDiscard: () => void;
}

export const CrashRecoveryModal: React.FC<CrashRecoveryModalProps> = ({
  isOpen,
  session,
  onResume,
  onExportAndDiscard,
  onDiscard,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const resumeButtonRef = useRef<HTMLButtonElement>(null);
  useModalFocus(isOpen, dialogRef, resumeButtonRef);

  if (!isOpen || !session) return null;

  const handleFitExport = async () => {
    const { downloadFitFile } = await import('../export/fitExporter');
    downloadFitFile(session);
    onExportAndDiscard();
  };

  const durationMin = Math.round((session.activeTimerSeconds || session.samples.length) / 60);
  const distanceKm = (session.totalDistanceMeters / 1000).toFixed(1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crash-recovery-title"
    >
      <div ref={dialogRef} className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-amber-500/40 bg-card p-6 text-slate-100 shadow-2xl flex flex-col gap-6">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 id="crash-recovery-title" className="font-bold text-lg text-white">Unfinished Ride Found</h3>
            <p className="text-xs text-slate-400">Restored from IndexedDB journal</p>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-1 font-mono text-xs text-slate-300">
          <div>Course: <strong className="text-white">{session.routeName}</strong></div>
          <div>Recorded: <strong className="text-white">{session.samples.length} samples ({durationMin} min)</strong></div>
          <div>Distance: <strong className="text-white">{distanceKm} km</strong></div>
          <div>Elev Gain: <strong className="text-white">+{Math.round(session.totalElevationGainMeters)} m</strong></div>
        </div>

        <p className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100/80">
          Resuming will switch the app to <strong className="text-white">{session.routeName}</strong>.
          Discarding keeps your currently selected course and returns to the home screen.
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            ref={resumeButtonRef}
            onClick={onResume}
            className="flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-2xl shadow-lg transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            <RotateCcw className="w-4 h-4" />
            Resume {session.routeName}
          </button>

          <button
            type="button"
            onClick={() => void handleFitExport()}
            className="flex items-center justify-center gap-2 px-5 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm rounded-2xl shadow-lg transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            <Download className="w-4 h-4" />
            Save & Export .FIT File
          </button>

          <button
            type="button"
            onClick={onDiscard}
            className="flex items-center justify-center gap-2 px-5 py-3 bg-slate-800 hover:bg-red-950 text-slate-400 hover:text-red-400 font-semibold text-xs rounded-2xl transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
          >
            <Trash2 className="w-4 h-4" />
            Discard &amp; Go Home
          </button>
        </div>
      </div>
    </div>
  );
};

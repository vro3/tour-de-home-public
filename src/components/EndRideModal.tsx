import React, { useRef } from 'react';
import { Flag, Home, Play, Trash2 } from 'lucide-react';
import { useModalFocus } from './useModalFocus';

interface EndRideModalProps {
  isOpen: boolean;
  onSaveAndExit: () => void;
  onDiscardAndExit: () => void;
  onKeepRiding: () => void;
}

export const EndRideModal: React.FC<EndRideModalProps> = ({
  isOpen,
  onSaveAndExit,
  onDiscardAndExit,
  onKeepRiding,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus the dialog itself so a reflexive Space press cannot activate the
  // destructive/default action. Tab still enters the trapped button sequence.
  useModalFocus(isOpen, dialogRef, dialogRef, onKeepRiding);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-ride-title"
    >
      <div ref={dialogRef} tabIndex={-1} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col gap-5 overflow-y-auto rounded-3xl border border-amber-500/35 bg-card p-6 text-slate-100 shadow-2xl focus:outline-none">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-500/35 bg-amber-500/15 text-amber-300">
            <Home className="h-5 w-5" />
          </div>
          <div>
            <h2 id="end-ride-title" className="text-lg font-black text-white">Return home?</h2>
            <p className="text-xs text-slate-400">Your ride is paused while you decide.</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onSaveAndExit}
          className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-black text-slate-950 shadow-lg transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          <Flag className="h-4 w-4" />
          Finish, Save &amp; Exit
        </button>

        <button
          type="button"
          onClick={onKeepRiding}
          className="flex items-center justify-center gap-2 rounded-2xl border border-cyan-500/25 bg-slate-800 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          <Play className="h-4 w-4 fill-current" />
          Keep Riding
        </button>

        <button
          type="button"
          onClick={onDiscardAndExit}
          className="flex items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-xs font-bold text-slate-500 transition hover:bg-red-950/50 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
        >
          <Trash2 className="h-4 w-4" />
          Discard Ride &amp; Go Home
        </button>
      </div>
    </div>
  );
};

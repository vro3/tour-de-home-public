import React, { useRef } from 'react';
import { Bluetooth, Activity, ShieldCheck, AlertCircle, Laptop } from 'lucide-react';
import { useModalFocus } from './useModalFocus';

interface ConnectModalProps {
  isOpen: boolean;
  isConnecting: boolean;
  error: string | null;
  onConnectReal: () => void;
  onConnectTreadmill?: () => void;
  onConnectMock: () => void;
  onClose: () => void;
}

export const ConnectModal: React.FC<ConnectModalProps> = ({
  isOpen,
  isConnecting,
  error,
  onConnectReal,
  onConnectTreadmill,
  onConnectMock,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const realTrainerButtonRef = useRef<HTMLButtonElement>(null);
  useModalFocus(isOpen, dialogRef, realTrainerButtonRef, () => {
    if (!isConnecting) onClose();
  });

  if (!isOpen) return null;
  const bluetoothAvailable = typeof navigator !== 'undefined' && Boolean(navigator.bluetooth) && window.isSecureContext;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-trainer-title"
    >
      <div ref={dialogRef} className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-cardBorder bg-card p-6 text-slate-100 shadow-2xl flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Bluetooth className="w-5 h-5" />
            </div>
            <div>
              <h3 id="connect-trainer-title" className="font-bold text-lg text-white">Connect Fitness Equipment</h3>
              <p className="text-xs text-slate-400">Bluetooth FTMS trainer or treadmill</p>
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 p-3.5 bg-red-950/40 border border-red-800/50 rounded-2xl text-xs text-red-200">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {!bluetoothAvailable && (
            <p role="status" className="text-sm text-amber-200">
              Trainer pairing needs a browser with Web Bluetooth on HTTPS or localhost, such as desktop Chrome. You can still try a demo below.
            </p>
          )}
          {/* Option A: Real Bluetooth Trainer */}
          <button
            type="button"
            ref={realTrainerButtonRef}
            onClick={onConnectReal}
            disabled={isConnecting || !bluetoothAvailable}
            className="group relative flex items-center gap-4 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/80 transition-all duration-200 text-left disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            <div className="w-12 h-12 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Activity className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-sm text-white flex items-center gap-1.5">
                Connect FTMS Trainer
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Standard FTMS Bluetooth (Power, Cadence, Slope Control)
              </div>
            </div>
          </button>

          {onConnectTreadmill && <button type="button" onClick={onConnectTreadmill} disabled={isConnecting || !bluetoothAvailable}
            className="min-h-11 rounded-2xl border border-violet-500/40 bg-slate-900 p-4 text-left disabled:opacity-50">
            <span className="block font-bold text-white">Connect FTMS Treadmill</span>
            <span className="mt-1 block text-xs text-slate-400">Sync belt speed and incline readout. Use the treadmill console to start, stop, or change the belt.</span>
          </button>}
          {/* Option B: Mock Simulator */}
          <button
            type="button"
            onClick={onConnectMock}
            disabled={isConnecting}
            className="group relative flex items-center gap-4 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/60 hover:border-emerald-500/50 hover:bg-slate-800/60 transition-all duration-200 text-left disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Laptop className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-sm text-white">
                Launch Mock Simulator
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Test UI, physics, and routes from your couch without pedaling
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

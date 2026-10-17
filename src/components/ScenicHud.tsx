import React from 'react';
import { Route, Settings2, Target, X } from 'lucide-react';
import { TelemetrySample, TrainerControlMode } from '../types/cycling';

interface ScenicHudProps {
  telemetry: TelemetrySample;
  elapsedSeconds: number;
  totalDistanceMeters: number;
  averageWatts: number;
  trainerDifficulty: number;
  onDifficultyChange: (value: number) => void;
  controlMode: TrainerControlMode;
  ergTargetWatts: number;
  routeAvailable: boolean;
  ergAvailable: boolean;
  trainerControlReady: boolean;
  controlError: string | null;
  onControlModeChange: (mode: TrainerControlMode) => void;
  onErgTargetChange: (watts: number) => void;
  controlsOpen: boolean;
  onToggleControls: () => void;
}

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Naked-numerals HUD: no cards — shadowed type floats directly on the world.
const NUMERAL_SHADOW = { textShadow: '0 2px 14px rgba(0,0,0,0.65)' };
const LABEL_SHADOW = { textShadow: '0 1px 6px rgba(0,0,0,0.6)' };

function FloatingMetric({
  value,
  label,
  align = 'left',
  valueClass = 'text-slate-50',
  valueColor,
}: {
  value: string | number;
  label: string;
  align?: 'left' | 'right';
  valueClass?: string;
  valueColor?: string;
}) {
  return (
    <div className={`flex flex-col ${align === 'right' ? 'items-end' : 'items-start'}`}>
      <span className={`font-mono text-xl sm:text-3xl font-bold leading-none lg:text-4xl ${valueClass}`} style={valueColor ? { ...NUMERAL_SHADOW, color: valueColor } : NUMERAL_SHADOW}>{value}</span>
      <span className="text-[10px] font-extrabold tracking-[0.18em] text-slate-50/70" style={LABEL_SHADOW}>{label}</span>
    </div>
  );
}

export const ScenicHud: React.FC<ScenicHudProps> = ({
  telemetry,
  elapsedSeconds,
  totalDistanceMeters,
  averageWatts,
  trainerDifficulty,
  onDifficultyChange,
  controlMode,
  ergTargetWatts,
  routeAvailable,
  ergAvailable,
  trainerControlReady,
  controlError,
  onControlModeChange,
  onErgTargetChange,
  controlsOpen,
  onToggleControls,
}) => {
  const gradeText = `${telemetry.gradePercent > 0 ? '+' : ''}${telemetry.gradePercent.toFixed(1)}%`;
  // Continuous severity ramp: white below 3%, then amber deepening toward a dark
  // red-orange as the grade steepens (clamped at 14%). Bright red stays reserved
  // for faults, so even the steepest wall reads as effort, not error.
  const grade = telemetry.gradePercent;
  let gradeColor: string | undefined;
  let gradeClass = 'text-slate-50';
  if (grade < 0) {
    gradeClass = 'text-emerald-300';
  } else if (grade > 3) {
    const t = Math.min(1, (grade - 3) / 11); // 3% -> 0, 14%+ -> 1
    const hue = 48 - t * 30;      // amber 48deg -> deep orange 18deg
    const lightness = 70 - t * 16; // brighter -> darker as it steepens
    gradeColor = `hsl(${hue.toFixed(0)}, 92%, ${lightness.toFixed(0)}%)`;
    gradeClass = '';
  }

  return (
    <>
      {/* hero power, top center */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex flex-col items-center">
        <span className="font-mono text-6xl font-extrabold leading-none text-slate-50 lg:text-7xl" style={{ textShadow: '0 2px 18px rgba(0,0,0,0.65)' }}>
          {telemetry.powerWatts}
        </span>
        <span className="text-xs font-extrabold tracking-[0.22em] text-slate-50/75" style={LABEL_SHADOW}>WATTS</span>
      </div>

      {/* left column: speed, cadence */}
      <div className="pointer-events-none absolute left-4 top-32 sm:left-6 sm:top-8 z-10 flex flex-col gap-5">
        <FloatingMetric value={telemetry.virtualSpeedKph.toFixed(1)} label="KM/H" />
        <FloatingMetric value={telemetry.cadenceRpm} label="RPM" />
        {telemetry.heartRateBpm !== undefined && telemetry.heartRateBpm > 0 && (
          <FloatingMetric value={telemetry.heartRateBpm} label="BPM" />
        )}
      </div>

      {/* right column: grade, time · distance, avg */}
      <div className="pointer-events-none absolute right-4 top-32 sm:right-6 sm:top-8 z-10 flex flex-col items-end gap-5">
        <FloatingMetric value={gradeText} label="GRADE" align="right" valueClass={gradeClass} valueColor={gradeColor} />
        <div className="flex flex-col items-end">
          <span className="font-mono text-xs sm:text-xl font-bold leading-tight text-slate-50/95" style={NUMERAL_SHADOW}>
            <span className="block sm:inline">{formatTime(elapsedSeconds)}</span><span className="hidden sm:inline"> · </span><span className="block sm:inline">{(totalDistanceMeters / 1000).toFixed(1)} km</span>
          </span>
          <span className="font-mono text-[11px] font-bold text-slate-50/65" style={LABEL_SHADOW}>{Math.round(averageWatts)} avg W</span>
        </div>
      </div>

      {/* trainer controls: compact status pill closed, full panel open */}
      {!controlsOpen ? (
        <div className="absolute bottom-24 right-4 z-20 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleControls}
            aria-label="Open ride controls"
            className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/68 px-3 py-1.5 shadow-2xl backdrop-blur-xl transition-colors hover:bg-slate-900/80"
          >
            <span className={`font-mono text-[11px] font-black tracking-wide ${controlMode === 'route' ? 'text-cyan-300' : 'text-amber-300'}`}>
              {controlMode === 'route' ? `ROUTE · ${trainerDifficulty}%` : `ERG · ${ergTargetWatts} W`}
            </span>
            {!trainerControlReady && (
              <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-black tracking-wide text-amber-300">READ ONLY</span>
            )}
            <Settings2 className="h-3.5 w-3.5 text-slate-400" />
          </button>
        </div>
      ) : (
      <div className="absolute bottom-24 left-4 right-4 sm:left-auto z-20 flex flex-wrap items-center justify-end gap-1.5 rounded-xl border border-white/10 bg-slate-950/80 p-1 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center rounded-lg bg-black/25 p-0.5" aria-label="Trainer control mode">
          <button
            type="button"
            onClick={() => onControlModeChange('route')}
            disabled={!routeAvailable}
            className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-[9px] font-black tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${controlMode === 'route' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
          >
            <Route className="h-3 w-3" /> ROUTE
          </button>
          <button
            type="button"
            onClick={() => onControlModeChange('erg')}
            disabled={!ergAvailable}
            className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-[9px] font-black tracking-wide transition-colors disabled:opacity-35 ${controlMode === 'erg' ? 'bg-amber-300 text-slate-950' : 'text-slate-400 hover:text-white'}`}
          >
            <Target className="h-3 w-3" /> ERG
          </button>
        </div>

        {controlMode === 'route' ? (
          <label className="flex items-center gap-1.5 px-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
            Feel
            <input
              aria-label="Trainer difficulty"
              type="range"
              min="0"
              max="100"
              step="5"
              value={trainerDifficulty}
              onChange={(event) => onDifficultyChange(Number(event.target.value))}
              disabled={!routeAvailable}
              className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
            />
            <span className="w-8 font-mono text-cyan-200">{trainerDifficulty}%</span>
          </label>
        ) : (
          <div className="flex items-center gap-0.5">
            <button type="button" disabled={!ergAvailable} onClick={() => onErgTargetChange(ergTargetWatts - 10)} className="h-7 w-7 rounded-md text-amber-200 hover:bg-white/5 disabled:opacity-35">−</button>
            <span className="w-14 text-center font-mono text-[10px] font-black text-amber-200">{ergTargetWatts} W</span>
            <button type="button" disabled={!ergAvailable} onClick={() => onErgTargetChange(ergTargetWatts + 10)} className="h-7 w-7 rounded-md text-amber-200 hover:bg-white/5 disabled:opacity-35">+</button>
          </div>
        )}
        {!trainerControlReady && (
          <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[8px] font-black tracking-wide text-amber-300">READ ONLY</span>
        )}
        {controlMode === 'route' && (
          <span className="w-full px-2 pb-1 text-[9px] font-medium leading-snug text-slate-500">
            Feel scales climb resistance only — your speed always comes from watts vs. the hill.
          </span>
        )}
        <button
          type="button"
          onClick={onToggleControls}
          aria-label="Close ride controls"
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      )}

      {controlError && (
        <div role="alert" className="absolute bottom-56 right-3 z-20 max-w-sm rounded-xl border border-red-400/30 bg-red-950/80 px-3 py-2 text-xs text-red-200 backdrop-blur-xl">
          {controlError}
        </div>
      )}
    </>
  );
};

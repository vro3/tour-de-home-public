import React from 'react';
import { Zap, Gauge, RotateCw, Mountain, Clock, Flag, Flame, Target, Route } from 'lucide-react';
import { TelemetrySample, TrainerControlMode } from '../types/cycling';

interface HUDProps {
  telemetry: TelemetrySample;
  elapsedSeconds: number;
  totalDistanceMeters: number;
  averageWatts: number;
  trainerDifficulty: number; // 0 to 100
  onDifficultyChange: (val: number) => void;
  controlMode: TrainerControlMode;
  ergTargetWatts: number;
  routeAvailable: boolean;
  ergAvailable: boolean;
  trainerControlReady: boolean;
  controlError: string | null;
  onControlModeChange: (mode: TrainerControlMode) => void;
  onErgTargetChange: (watts: number) => void;
}

// 7-Zone Power calculation (assuming typical 250W FTP for zone color visualization)
function getPowerZone(watts: number, ftp = 250): { zone: number; label: string; color: string; percent: number } {
  const pct = (watts / ftp) * 100;
  if (pct < 55) return { zone: 1, label: 'Z1 Active Recovery', color: 'bg-slate-500', percent: pct };
  if (pct < 75) return { zone: 2, label: 'Z2 Endurance', color: 'bg-blue-500', percent: pct };
  if (pct < 90) return { zone: 3, label: 'Z3 Tempo', color: 'bg-emerald-500', percent: pct };
  if (pct < 105) return { zone: 4, label: 'Z4 Threshold', color: 'bg-amber-500', percent: pct };
  if (pct < 120) return { zone: 5, label: 'Z5 VO2Max', color: 'bg-orange-500', percent: pct };
  if (pct < 150) return { zone: 6, label: 'Z6 Anaerobic', color: 'bg-red-500', percent: pct };
  return { zone: 7, label: 'Z7 Neuromuscular', color: 'bg-purple-500', percent: pct };
}

function formatTime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const HUD: React.FC<HUDProps> = ({
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
}) => {
  const powerZone = getPowerZone(telemetry.powerWatts);
  const distanceKm = (totalDistanceMeters / 1000).toFixed(1);
  const isClimbing = telemetry.gradePercent > 3.0;

  return (
    <div className="w-full flex flex-col gap-2.5">
      {/* Top Ride Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-card/70 backdrop-blur-xl border border-cardBorder/60 rounded-2xl shadow-2xl">
        <div className="flex items-center gap-4 lg:gap-7">
          <div className="flex items-center gap-2.5 text-slate-300">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span className="font-mono text-lg font-bold tracking-tight text-white">
              {formatTime(elapsedSeconds)}
            </span>
          </div>

          <div className="flex items-center gap-2.5 text-slate-300">
            <Flag className="w-4 h-4 text-emerald-400" />
            <span className="font-mono text-lg font-bold tracking-tight text-white">
              {distanceKm} <span className="text-sm font-medium text-slate-400">km</span>
            </span>
          </div>

          <div className="flex items-center gap-2.5 text-slate-300">
            <Flame className="w-4 h-4 text-orange-400" />
            <span className="font-mono text-lg font-bold tracking-tight text-white">
              {Math.round(averageWatts)} <span className="text-sm font-medium text-slate-400">Avg W</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border border-slate-700 bg-slate-950/70 p-1" aria-label="Trainer control mode">
            <button
              type="button"
              onClick={() => onControlModeChange('route')}
              disabled={!routeAvailable}
              title={routeAvailable ? 'Follow course gradient' : 'Trainer route resistance control is unavailable'}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${controlMode === 'route' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
            >
              <Route className="h-3.5 w-3.5" /> ROUTE
            </button>
            <button
              type="button"
              onClick={() => onControlModeChange('erg')}
              disabled={!ergAvailable}
              title={ergAvailable ? 'Hold a fixed trainer power target' : 'This trainer does not advertise FTMS target-power support'}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${controlMode === 'erg' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}
            >
              <Target className="h-3.5 w-3.5" /> ERG
            </button>
          </div>

          {controlMode === 'route' ? (
            <div className="flex items-center gap-2">
              <span className="hidden xl:inline text-[10px] font-semibold uppercase tracking-wider text-slate-400">Difficulty</span>
              <input
                aria-label="Trainer difficulty"
                type="range"
                min="0"
                max="100"
                step="5"
                value={trainerDifficulty}
                onChange={(e) => onDifficultyChange(Number(e.target.value))}
                disabled={!routeAvailable}
                className="w-20 lg:w-28 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-35"
              />
              <span className="font-mono text-sm font-bold text-cyan-400 w-10 text-right">{trainerDifficulty}%</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-xl border border-amber-500/25 bg-amber-500/10 p-1">
              <button type="button" disabled={!ergAvailable} onClick={() => onErgTargetChange(ergTargetWatts - 10)} className="h-7 w-8 rounded-lg bg-slate-900 text-amber-300 hover:bg-slate-800 disabled:opacity-35">−</button>
              <span className="w-20 text-center font-mono text-sm font-black text-amber-300">{ergTargetWatts} W</span>
              <button type="button" disabled={!ergAvailable} onClick={() => onErgTargetChange(ergTargetWatts + 10)} className="h-7 w-8 rounded-lg bg-slate-900 text-amber-300 hover:bg-slate-800 disabled:opacity-35">+</button>
            </div>
          )}

          {trainerControlReady ? (
            <span className="hidden h-2 w-2 rounded-full bg-emerald-400 2xl:inline-flex" title="Trainer control acquired" />
          ) : (
            <span className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[9px] font-black tracking-wide text-amber-300">READ ONLY</span>
          )}
        </div>
      </div>

      {controlError && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-950/70 px-3 py-1.5 text-xs text-red-300">
          {controlError}
        </div>
      )}

      {/* Main Big Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {/* Power Card */}
        <div className="relative overflow-hidden bg-card/85 backdrop-blur-2xl border border-cardBorder/80 rounded-2xl p-3 lg:p-4 shadow-2xl transition-all duration-300 hover:border-cyan-500/50">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <Zap className="w-4 h-4 text-emerald-400 fill-emerald-400/20" /> Power
            </span>
            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full text-slate-900 ${powerZone.color}`}>
              {powerZone.label.split(' ')[0]}
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-4xl lg:text-5xl 2xl:text-6xl font-black tracking-tight text-white drop-shadow-md">
              {telemetry.powerWatts}
            </span>
            <span className="text-base font-semibold text-slate-400">W</span>
          </div>
          {/* Zone indicator bar */}
          <div className="w-full bg-slate-800/80 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className={`h-full ${powerZone.color} transition-all duration-300 rounded-full`}
              style={{ width: `${Math.min(100, (telemetry.powerWatts / 400) * 100)}%` }}
            />
          </div>
        </div>

        {/* Speed Card */}
        <div className="relative overflow-hidden bg-card/85 backdrop-blur-2xl border border-cardBorder/80 rounded-2xl p-3 lg:p-4 shadow-2xl transition-all duration-300 hover:border-cyan-500/50">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <Gauge className="w-4 h-4 text-cyan-400" /> Virtual Speed
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-4xl lg:text-5xl 2xl:text-6xl font-black tracking-tight text-white drop-shadow-md">
              {telemetry.virtualSpeedKph.toFixed(1)}
            </span>
            <span className="text-base font-semibold text-slate-400">km/h</span>
          </div>
          <div className="text-xs text-slate-500 font-mono mt-3">
            Flywheel: {telemetry.flywheelSpeedKph.toFixed(1)} km/h
          </div>
        </div>

        {/* Cadence Card */}
        <div className="relative overflow-hidden bg-card/85 backdrop-blur-2xl border border-cardBorder/80 rounded-2xl p-3 lg:p-4 shadow-2xl transition-all duration-300 hover:border-cyan-500/50">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <RotateCw className="w-4 h-4 text-sky-400" /> Cadence
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-4xl lg:text-5xl 2xl:text-6xl font-black tracking-tight text-white drop-shadow-md">
              {telemetry.cadenceRpm}
            </span>
            <span className="text-base font-semibold text-slate-400">RPM</span>
          </div>
          <div className={`text-xs font-mono mt-3 ${controlMode === 'erg' && telemetry.cadenceRpm > 0 && telemetry.cadenceRpm < 45 ? 'text-amber-400' : 'text-slate-500'}`}>
            {controlMode === 'erg' && telemetry.cadenceRpm > 0 && telemetry.cadenceRpm < 45
              ? 'Low cadence — ease or use Route'
              : 'Live trainer cadence'}
          </div>
        </div>

        {/* Grade / Slope Card */}
        <div className="relative overflow-hidden bg-card/85 backdrop-blur-2xl border border-cardBorder/80 rounded-2xl p-3 lg:p-4 shadow-2xl transition-all duration-300 hover:border-cyan-500/50">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <Mountain className="w-4 h-4 text-orange-400" /> Grade
            </span>
            {isClimbing && (
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 animate-pulse">
                Climbing
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={`font-mono text-4xl lg:text-5xl 2xl:text-6xl font-black tracking-tight drop-shadow-md ${
              telemetry.gradePercent > 7 ? 'text-red-400' :
              telemetry.gradePercent > 3 ? 'text-orange-400' :
              telemetry.gradePercent < 0 ? 'text-emerald-400' : 'text-white'
            }`}>
              {telemetry.gradePercent > 0 ? `+${telemetry.gradePercent.toFixed(1)}` : telemetry.gradePercent.toFixed(1)}
            </span>
            <span className="text-base font-semibold text-slate-400">%</span>
          </div>
          <div className="text-xs text-slate-500 font-mono mt-3">
            {controlMode === 'erg'
              ? `ERG holds ${ergTargetWatts} W • grade affects speed`
              : `Resistance: ${(telemetry.gradePercent * (trainerDifficulty / 100)).toFixed(1)}%`}
          </div>
        </div>
      </div>
    </div>
  );
};

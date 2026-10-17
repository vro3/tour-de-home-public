import React from 'react';
import { Sliders, Zap, RotateCw } from 'lucide-react';
import { MockTrainer } from '../ble/mockTrainer';
import { TrainerControlMode } from '../types/cycling';

interface MockTrainerControlsProps {
  mockTrainer: MockTrainer;
  currentWatts: number;
  currentCadence: number;
  controlMode: TrainerControlMode;
  onWattsChange: (watts: number) => void;
  onCadenceChange: (cadence: number) => void;
}

export const MockTrainerControls: React.FC<MockTrainerControlsProps> = ({
  currentWatts,
  currentCadence,
  controlMode,
  onWattsChange,
  onCadenceChange,
}) => {
  return (
    <div className="bg-card/90 backdrop-blur-2xl border border-cyan-500/30 rounded-2xl p-4 shadow-2xl flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
          <Sliders className="w-4 h-4" /> Simulator Controls
        </span>
        <span className="text-[10px] bg-cyan-950 text-cyan-300 font-mono px-2 py-0.5 rounded border border-cyan-800">
          Couch Mode Active
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold">
        {/* Power Slider */}
        <div className={`flex flex-col gap-1 ${controlMode === 'erg' ? 'opacity-45' : ''}`}>
          <div className="flex justify-between text-slate-300">
            <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-emerald-400" /> Power</span>
            <span className="font-mono text-emerald-400 font-bold">
              {controlMode === 'erg' ? 'Controlled by ERG' : `${currentWatts} W`}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="600"
            step="10"
            value={currentWatts}
            disabled={controlMode === 'erg'}
            onChange={(e) => onWattsChange(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-400 disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            {controlMode === 'erg' ? (
              <span className="text-amber-300">ERG mode owns simulated power</span>
            ) : (
              <>
                <button onClick={() => onWattsChange(150)} className="hover:text-emerald-300">150W</button>
                <button onClick={() => onWattsChange(250)} className="hover:text-emerald-300">250W</button>
                <button onClick={() => onWattsChange(350)} className="hover:text-emerald-300">350W</button>
                <button onClick={() => onWattsChange(500)} className="hover:text-emerald-300">500W</button>
              </>
            )}
          </div>
        </div>

        {/* Cadence Slider */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-slate-300">
            <span className="flex items-center gap-1"><RotateCw className="w-3.5 h-3.5 text-sky-400" /> Cadence</span>
            <span className="font-mono text-sky-400 font-bold">{currentCadence} RPM</span>
          </div>
          <input
            type="range"
            min="0"
            max="140"
            step="5"
            value={currentCadence}
            onChange={(e) => onCadenceChange(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <button onClick={() => onCadenceChange(60)} className="hover:text-sky-300">60</button>
            <button onClick={() => onCadenceChange(90)} className="hover:text-sky-300">90</button>
            <button onClick={() => onCadenceChange(105)} className="hover:text-sky-300">105</button>
          </div>
        </div>

      </div>
    </div>
  );
};

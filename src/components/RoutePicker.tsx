import React, { useState, useRef } from 'react';
import { Upload, Mountain, Compass, CheckCircle2, AlertCircle } from 'lucide-react';
import { RouteModel } from '../types/cycling';
import { PRESET_ROUTES } from '../route/presets';
import { MAX_GPX_SIZE, parseGpxString } from '../route/gpxParser';
import { CourseLibrary } from './CourseLibrary';

interface RoutePickerProps {
  selectedRoute: RouteModel | null;
  onSelectRoute: (route: RouteModel) => void;
}

export const RoutePicker: React.FC<RoutePickerProps> = ({
  selectedRoute,
  onSelectRoute,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith('.gpx')) {
      setError('Please upload a valid .gpx route file.');
      return;
    }
    if (file.size > MAX_GPX_SIZE) {
      setError('This GPX file is too large. Choose a file smaller than 20 MB.');
      return;
    }

    try {
      const text = await file.text();
      const route = parseGpxString(text, file.name.replace(/\.gpx$/i, ''));
      onSelectRoute(route);
    } catch (err: any) {
      setError(err.message || 'Failed to parse GPX route file.');
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="w-full bg-card/85 backdrop-blur-2xl border border-cardBorder/80 rounded-3xl p-3 sm:p-4 md:p-6 shadow-2xl flex flex-col gap-6 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex shrink-0 items-center gap-2">
          <Compass className="w-5 h-5 text-cyan-400" />
          <h2 className="font-bold text-sm md:text-base text-white">Select Route <span className="hidden sm:inline">/ Course</span></h2>
        </div>
        {selectedRoute && (
          <div className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-950/50 border border-emerald-800/60 px-3 py-1 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="truncate">Ready: {selectedRoute.name}</span>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-800/50 rounded-2xl text-xs text-red-300">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <CourseLibrary selectedRoute={selectedRoute} onSelectRoute={onSelectRoute} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.9fr]">
        {/* Drag & Drop GPX Zone */}
        <button
          type="button"
          aria-label="Import a GPX route"
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`group relative flex min-w-0 flex-wrap min-h-32 items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-4 transition-all duration-200 cursor-pointer ${
            dragActive
              ? 'border-cyan-400 bg-cyan-950/30'
              : 'border-slate-800 hover:border-cyan-500/50 bg-slate-900/40 hover:bg-slate-900/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx"
            aria-label="GPX file"
            className="hidden"
            onClick={(event) => event.stopPropagation()}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFile(e.target.files[0]);
              }
              e.target.value = '';
            }}
          />
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-sm text-white">Bring your own GPX</div>
            <div className="text-xs text-slate-400 mt-1">Drop it here or click to browse</div>
          </div>
        </button>

        {/* Preset Iconic Routes */}
        <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            Tour de Home Originals
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PRESET_ROUTES.map((preset) => {
            const isSelected = selectedRoute?.id === preset.id;
            const distKm = (preset.totalDistanceMeters / 1000).toFixed(1);
            return (
              <button
                key={preset.id}
                onClick={() => onSelectRoute(preset)}
                className={`flex flex-col text-left p-4 rounded-2xl border transition-all duration-200 ${
                  isSelected
                    ? 'bg-cyan-950/50 border-cyan-400 shadow-lg shadow-cyan-500/10'
                    : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="min-w-0 break-words font-bold text-sm text-white">
                    {preset.name}
                  </span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400 mt-2">
                  <span className="flex items-center gap-1 text-slate-300">
                    <strong>{distKm}</strong> km
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Mountain className="w-3.5 h-3.5" />
                    <strong>+{preset.totalElevationGainMeters}m</strong>
                  </span>
                </div>
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
};

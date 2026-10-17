import React, { useMemo } from 'react';
import { RouteModel } from '../types/cycling';

interface ScenicClimbBarProps {
  route: RouteModel;
  currentDistanceMeters: number;
}

// Grade classes for the chip bar. Moderate climbs read amber, steep ones red.
const MODERATE_GRADE = 4.5;

const MICRO_WINDOW_METERS = 1000;

const LABEL_SHADOW = { textShadow: '0 1px 6px rgba(0,0,0,0.6)' };

export const ScenicClimbBar: React.FC<ScenicClimbBarProps> = ({ route, currentDistanceMeters }) => {
  const total = Math.max(1, route.totalDistanceMeters);
  const progressFrac = Math.min(1, Math.max(0, currentDistanceMeters / total));

  const { microPath, microFill, microMaxGrade, warning } = useMemo(() => {
    const points = route.points;
    const from = Math.min(currentDistanceMeters, total);
    const to = Math.min(from + MICRO_WINDOW_METERS, total);

    const elevationAt = (d: number): number => {
      if (points.length === 0) return 0;
      let i = 1;
      while (i < points.length && points[i].cumulativeDistance < d) i++;
      if (i >= points.length) return points[points.length - 1].elevation;
      const a = points[i - 1];
      const b = points[i];
      const span = Math.max(1e-6, b.cumulativeDistance - a.cumulativeDistance);
      const t = Math.min(1, Math.max(0, (d - a.cumulativeDistance) / span));
      return a.elevation + (b.elevation - a.elevation) * t;
    };
    const gradeAt = (d: number): number => {
      if (points.length === 0) return 0;
      let i = 1;
      while (i < points.length && points[i].cumulativeDistance < d) i++;
      return points[Math.min(i, points.length - 1)].grade;
    };

    const samples = 24;
    const elevations: number[] = [];
    let maxGradeAhead = 0;
    for (let s = 0; s <= samples; s++) {
      const d = from + ((to - from) * s) / samples;
      elevations.push(elevationAt(d));
      maxGradeAhead = Math.max(maxGradeAhead, gradeAt(d));
    }
    const minEl = Math.min(...elevations);
    const maxEl = Math.max(...elevations);
    const span = Math.max(4, maxEl - minEl); // floor keeps flat routes from rendering as noise
    const w = 210;
    const h = 40;
    const coords = elevations.map((el, s) => {
      const x = (w * s) / samples;
      const y = h - 5 - ((el - minEl) / span) * (h - 10);
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    const path = `M${coords.join(' L')}`;
    const fill = `${path} L${w} ${h} L0 ${h} Z`;

    // Next-climb warning: nearest upcoming stretch at moderate grade or steeper.
    let warningText: string | null = null;
    const lookahead = 2000;
    const step = 25;
    for (let d = from; d <= Math.min(from + lookahead, total); d += step) {
      if (gradeAt(d) >= MODERATE_GRADE) {
        const crestCap = 2000;
        let peak = 0;
        let end = d;
        while (end <= Math.min(total, d + crestCap) && gradeAt(end) >= MODERATE_GRADE) {
          peak = Math.max(peak, gradeAt(end));
          end += step;
        }
        const stillClimbing = end < total && gradeAt(end) >= MODERATE_GRADE;
        const metersTo = Math.round((d - from) / 50) * 50;
        if (metersTo > 0) {
          warningText = `▲ ${peak.toFixed(1)}% in ${metersTo} m`;
        } else if (stillClimbing) {
          warningText = `▲ ${peak.toFixed(1)}% · long climb`;
        } else {
          warningText = `▲ ${peak.toFixed(1)}% · crest in ${Math.max(50, Math.round((end - from) / 50) * 50)} m`;
        }
        break;
      }
    }

    return { microPath: path, microFill: fill, microMaxGrade: maxGradeAhead, warning: warningText };
  }, [route, currentDistanceMeters, total]);

  return (
    <div className="pointer-events-none">
      {/* micro climb window: the next 1 km, bottom-left above the bar */}
      <div className="absolute bottom-16 left-6 w-[210px]">
        <div className="mb-0.5 flex justify-between">
          <span className="text-[9px] font-extrabold tracking-[0.08em] text-slate-50/75" style={LABEL_SHADOW}>NEXT 1 KM</span>
          {microMaxGrade >= MODERATE_GRADE && (
            <span className="font-mono text-[9px] font-bold text-amber-300" style={LABEL_SHADOW}>{microMaxGrade.toFixed(1)}%</span>
          )}
        </div>
        <svg width="210" height="40" viewBox="0 0 210 40" preserveAspectRatio="none" aria-hidden="true">
          <path d={microFill} fill="rgba(2,6,23,0.30)" />
          <path d={microPath} fill="none" stroke="#22d3ee" strokeWidth="2.5" />
          <circle cx="3" cy="33" r="4" fill="#fb923c" stroke="#f8fafc" strokeWidth="1.5" />
        </svg>
      </div>

      {/* progress bar with climb chips */}
      <div className="absolute inset-x-6 bottom-4">
        <div className="mb-2 flex items-center gap-3">
          <span className="truncate text-[10px] font-bold uppercase text-slate-50/75" style={LABEL_SHADOW}>{route.name}</span>
          <span className="flex-1" />
          {warning && (
            <span className="font-mono text-xs font-extrabold text-amber-300" style={LABEL_SHADOW}>{warning}</span>
          )}
          <span className="font-mono text-[10px] font-bold text-slate-50/85" style={LABEL_SHADOW}>
            {(currentDistanceMeters / 1000).toFixed(1)} / {(total / 1000).toFixed(1)} KM
          </span>
        </div>
        <div className="relative h-1.5 rounded-full bg-slate-950/45">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${progressFrac * 100}%`, background: 'linear-gradient(90deg, #22d3ee, #34d399)' }}
          />
          <div
            className="absolute top-[-4px] h-3.5 w-3.5 rounded-full border-2 border-slate-50 bg-orange-400"
            style={{ left: `calc(${progressFrac * 100}% - 7px)`, boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}
          />
        </div>
      </div>
    </div>
  );
};

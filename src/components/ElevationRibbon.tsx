import React, { useMemo } from 'react';
import { Mountain, ArrowUpRight } from 'lucide-react';
import { RouteModel, RoutePoint } from '../types/cycling';

interface ElevationRibbonProps {
  route: RouteModel | null;
  currentDistanceMeters: number;
  currentPoint: RoutePoint | null;
  compact?: boolean;
}

type LoadedElevationRibbonProps = Omit<ElevationRibbonProps, 'route'> & { route: RouteModel };

const LoadedElevationRibbon: React.FC<LoadedElevationRibbonProps> = ({
  route,
  currentDistanceMeters,
  currentPoint,
  compact = false,
}) => {
  const points = route.points;
  const totalDistance = route.totalDistanceMeters;
  const distanceKm = (totalDistance / 1000).toFixed(1);
  const currentKm = (currentDistanceMeters / 1000).toFixed(1);
  const remainingKm = Math.max(0, (totalDistance - currentDistanceMeters) / 1000).toFixed(1);

  // Compute elevation domain
  const { minElev, maxElev, svgPath } = useMemo(() => {
    let minE = Infinity;
    let maxE = -Infinity;

    for (const p of points) {
      if (p.elevation < minE) minE = p.elevation;
      if (p.elevation > maxE) maxE = p.elevation;
    }

    // Add padding to elevation range
    const range = Math.max(20, maxE - minE);
    const paddedMin = Math.max(0, minE - range * 0.1);
    const paddedMax = maxE + range * 0.1;
    const elevSpan = paddedMax - paddedMin;

    const width = 800;
    const height = 120;

    const coords = points.map((p) => {
      const x = (p.cumulativeDistance / totalDistance) * width;
      const y = height - ((p.elevation - paddedMin) / elevSpan) * (height - 20) - 10;
      return { x, y, grade: p.grade };
    });

    // Build SVG filled path
    let d = `M 0,${height} `;
    coords.forEach((c) => {
      d += `L ${c.x.toFixed(1)},${c.y.toFixed(1)} `;
    });
    d += `L ${width},${height} Z`;

    return {
      minElev: Math.round(minE),
      maxElev: Math.round(maxE),
      svgPath: d,
    };
  }, [points, totalDistance]);

  const progressPercent = totalDistance > 0 ? (currentDistanceMeters / totalDistance) * 100 : 0;
  const currentGrade = currentPoint ? currentPoint.grade : 0;

  return (
    <div className={`w-full border border-cardBorder/80 shadow-2xl flex flex-col ${compact ? 'rounded-2xl bg-slate-950/58 px-3 py-2 gap-1.5 backdrop-blur-xl' : 'rounded-3xl bg-card/85 p-4 md:p-5 gap-3 backdrop-blur-2xl'}`}>
      {/* Header Info */}
      <div className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 font-bold text-white">
          <Mountain className="w-4 h-4 text-cyan-400" />
          <span className={`min-w-0 truncate ${compact ? 'max-w-[240px] md:max-w-[320px]' : 'max-w-[260px] md:max-w-xs'}`}>{route.name}</span>
          <span className={`text-slate-400 font-normal ${compact ? 'hidden lg:inline' : ''}`}>({distanceKm} km • {route.totalElevationGainMeters}m ↗)</span>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2 font-mono text-[10px] sm:justify-end sm:gap-3 sm:text-xs">
          <span className="whitespace-nowrap text-slate-400">
            <span className="hidden md:inline">Progress: </span><strong className="text-white">{currentKm} / {distanceKm} km</strong>
          </span>
          <span className="hidden items-center gap-1 whitespace-nowrap text-cyan-400 font-bold min-[460px]:flex">
            <ArrowUpRight className="w-3.5 h-3.5" />
            {remainingKm} km left
          </span>
          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
            currentGrade > 7 ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
            currentGrade > 3 ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
            currentGrade < 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
            'bg-slate-800 text-slate-300'
          }`}>
            {currentGrade > 0 ? `+${currentGrade}%` : `${currentGrade}%`}
          </span>
        </div>
      </div>

      {/* SVG Elevation Profile Chart */}
      <div className={`relative w-full overflow-hidden bg-slate-950/60 border border-slate-900 ${compact ? 'h-12 rounded-xl' : 'h-24 rounded-2xl'}`}>
        <svg
          viewBox="0 0 800 120"
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <defs>
            <linearGradient id="elevationGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#00f0ff" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Area fill */}
          <path d={svgPath} fill="url(#elevationGrad)" />

          {/* Outline stroke */}
          <path
            d={svgPath.replace(/M 0,120 L/, 'M').replace(/L 800,120 Z/, '')}
            fill="none"
            stroke="#00f0ff"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>

        {/* Dynamic Rider Position Marker Pin */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none transition-all duration-300 flex flex-col items-center"
          style={{ left: `${Math.min(99.5, Math.max(0.5, progressPercent))}%` }}
        >
          <div className="w-0.5 h-full bg-cyan-400 shadow-[0_0_8px_#00f0ff]" />
          <div className="absolute top-2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-orange-400 border-2 border-white shadow-[0_0_10px_#ff9900]" />
        </div>

        {/* Min/Max Elevation Labels */}
        <div className="absolute bottom-1.5 left-3 text-[10px] font-mono text-slate-500">
          {minElev}m
        </div>
        <div className="absolute top-1.5 right-3 text-[10px] font-mono text-slate-500">
          {maxElev}m
        </div>
      </div>
    </div>
  );
};

export const ElevationRibbon: React.FC<ElevationRibbonProps> = (props) => {
  if (!props.route || props.route.points.length < 2) return null;
  return <LoadedElevationRibbon {...props} route={props.route} />;
};

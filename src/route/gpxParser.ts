import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { RouteModel, RoutePoint } from '../types/cycling';
import { smoothRouteGrades } from './gradeSmoother';

export const MAX_GPX_SIZE = 20_000_000;

function hashRouteGeometry(points: Array<{ lat: number; lng: number; ele: number; startsSegment: boolean }>): string {
  let hash = 2166136261;
  const update = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };

  for (const point of points) {
    update(`${point.lat.toFixed(7)},${point.lng.toFixed(7)},${point.ele.toFixed(2)},${point.startsSegment ? 1 : 0};`);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Calculates distance between two coordinates in meters using the Haversine formula
 */
export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates initial compass bearing from Point 1 to Point 2 in degrees (0-360)
 */
export function calculateBearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

/**
 * Parses raw GPX XML string into a normalized RouteModel
 */
export function parseGpxString(gpxXml: string, fallbackName = 'Imported Route'): RouteModel {
  if (gpxXml.length > MAX_GPX_SIZE) throw new Error('GPX files must be smaller than 20 MB.');
  if (/<!DOCTYPE|<!ENTITY/i.test(gpxXml)) throw new Error('GPX files with document types or custom entities are not supported.');
  if (XMLValidator.validate(gpxXml) !== true) throw new Error('This GPX file contains malformed XML.');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Official route exports frequently use ns0:gpx/ns0:trk prefixes.
    // Normalize those prefixes so standards-compliant GPX variants share one parser path.
    removeNSPrefix: true,
  });

  const parsed = parser.parse(gpxXml);
  const gpx = parsed.gpx;
  if (!gpx) throw new Error('Invalid GPX format: missing <gpx> root element.');

  let rawPoints: Array<{ lat: number; lng: number; ele: number; startsSegment: boolean }> = [];
  let routeName = fallbackName;

  // Extract route/track name if available
  if (gpx.trk) {
    const tracks = Array.isArray(gpx.trk) ? gpx.trk : [gpx.trk];
    if (tracks[0]?.name) routeName = String(tracks[0].name);

    for (const trk of tracks) {
      if (!trk.trkseg) continue;
      const segments = Array.isArray(trk.trkseg) ? trk.trkseg : [trk.trkseg];
      for (const seg of segments) {
        if (!seg.trkpt) continue;
        const pts = Array.isArray(seg.trkpt) ? seg.trkpt : [seg.trkpt];
        for (let index = 0; index < pts.length; index++) {
          const pt = pts[index];
          rawPoints.push({
            lat: parseFloat(pt['@_lat']),
            lng: parseFloat(pt['@_lon']),
            ele: pt.ele !== undefined ? parseFloat(pt.ele) : 0,
            startsSegment: index === 0,
          });
        }
      }
    }
  } else if (gpx.rte) {
    const routes = Array.isArray(gpx.rte) ? gpx.rte : [gpx.rte];
    if (routes[0]?.name) routeName = String(routes[0].name);
    for (const rte of routes) {
      if (!rte.rtept) continue;
      const pts = Array.isArray(rte.rtept) ? rte.rtept : [rte.rtept];
      for (let index = 0; index < pts.length; index++) {
        const pt = pts[index];
        rawPoints.push({
          lat: parseFloat(pt['@_lat']),
          lng: parseFloat(pt['@_lon']),
          ele: pt.ele !== undefined ? parseFloat(pt.ele) : 0,
          startsSegment: index === 0,
        });
      }
    }
  }

  if (rawPoints.length < 2) {
    throw new Error('GPX route contains insufficient trackpoints (minimum 2 required).');
  }
  if (rawPoints.length > 200_000) throw new Error('GPX routes must contain no more than 200,000 trackpoints.');

  for (const point of rawPoints) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.ele)) {
      throw new Error('GPX route contains an invalid coordinate or elevation value.');
    }
    if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) {
      throw new Error('GPX route contains a coordinate outside the valid latitude/longitude range.');
    }
  }

  // Convert raw points into indexed RoutePoints with cumulative distance
  let cumulativeDist = 0;
  let totalElevationGain = 0;
  const initialPoints: RoutePoint[] = [];

  for (let i = 0; i < rawPoints.length; i++) {
    const current = rawPoints[i];
    let segDist = 0;
    let heading = 0;

    if (i > 0 && !current.startsSegment) {
      const prev = rawPoints[i - 1];
      segDist = haversineDistanceMeters(prev.lat, prev.lng, current.lat, current.lng);
      cumulativeDist += segDist;
      heading = calculateBearingDegrees(prev.lat, prev.lng, current.lat, current.lng);
      
      const eleDiff = current.ele - prev.ele;
      if (eleDiff > 0) totalElevationGain += eleDiff;
    }

    initialPoints.push({
      lat: current.lat,
      lng: current.lng,
      elevation: current.ele,
      cumulativeDistance: cumulativeDist,
      grade: 0, // Will be computed with 30-50m smoothing filter
      heading,
    });
  }

  // Apply 30-50m rolling elevation smoother to avoid noisy spikes
  const smoothedPoints = smoothRouteGrades(initialPoints, 40);
  if (cumulativeDist < 1) {
    throw new Error('GPX route has no measurable distance.');
  }

  // Report ascent from the same smoothed elevations used by the ride engine.
  totalElevationGain = 0;
  for (let i = 1; i < smoothedPoints.length; i++) {
    totalElevationGain += Math.max(0, smoothedPoints[i].elevation - smoothedPoints[i - 1].elevation);
  }

  return {
    // Geometry-derived IDs keep procedural scenery stable across repeated imports.
    id: `route_${hashRouteGeometry(rawPoints)}`,
    name: routeName,
    totalDistanceMeters: cumulativeDist,
    totalElevationGainMeters: Math.round(totalElevationGain),
    points: smoothedPoints,
  };
}

/** Expands a GPX loop whose metadata specifies that its geometry is ridden more than once. */
export function repeatRouteLaps(route: RouteModel, laps: number): RouteModel {
  const lapCount = Math.max(1, Math.floor(laps));
  if (lapCount === 1) return route;

  const points: RoutePoint[] = [];
  for (let lap = 0; lap < lapCount; lap++) {
    const distanceOffset = route.totalDistanceMeters * lap;
    for (const point of route.points) {
      points.push({
        ...point,
        cumulativeDistance: point.cumulativeDistance + distanceOffset,
      });
    }
  }

  return {
    ...route,
    totalDistanceMeters: route.totalDistanceMeters * lapCount,
    totalElevationGainMeters: route.totalElevationGainMeters * lapCount,
    points,
  };
}

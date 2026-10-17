import { get, set } from 'idb-keyval';
import type { RouteModel } from '../types/cycling';

const SELECTED_ROUTE_KEY = 'tour_de_home_selected_route';

export function isUsableRoute(value: unknown): value is RouteModel {
  if (!value || typeof value !== 'object') return false;
  const route = value as Partial<RouteModel>;
  if (!(
    typeof route.id === 'string'
    && route.id.trim().length > 0
    && typeof route.name === 'string'
    && route.name.trim().length > 0
    && Number.isFinite(route.totalDistanceMeters)
    && Number(route.totalDistanceMeters) > 0
    && Number.isFinite(route.totalElevationGainMeters)
    && Number(route.totalElevationGainMeters) >= 0
    && Array.isArray(route.points)
    && route.points.length >= 2
  )) return false;

  let previousDistance = -Infinity;
  for (const point of route.points) {
    if (!(
      Number.isFinite(point?.lat) && point.lat >= -90 && point.lat <= 90
      && Number.isFinite(point?.lng) && point.lng >= -180 && point.lng <= 180
      && Number.isFinite(point?.elevation)
      && Number.isFinite(point?.cumulativeDistance)
      && point.cumulativeDistance >= 0
      && point.cumulativeDistance >= previousDistance
      && Number.isFinite(point?.grade)
      && Number.isFinite(point?.heading)
    )) return false;
    previousDistance = point.cumulativeDistance;
  }

  const routeDistance = Number(route.totalDistanceMeters);
  const finalDistance = route.points.at(-1)?.cumulativeDistance ?? 0;
  const tolerance = Math.max(5, routeDistance * 0.01);
  return finalDistance > 0 && Math.abs(finalDistance - routeDistance) <= tolerance;
}

export async function loadSelectedRoute(): Promise<RouteModel | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const saved = await get<unknown>(SELECTED_ROUTE_KEY);
    return isUsableRoute(saved) ? saved : null;
  } catch {
    return null;
  }
}

export async function saveSelectedRoute(route: RouteModel): Promise<void> {
  if (!isUsableRoute(route)) return;
  if (typeof indexedDB === 'undefined') return;
  try {
    await set(SELECTED_ROUTE_KEY, route);
  } catch (error) {
    console.warn('[Preferences] Could not remember the selected route:', error);
  }
}

import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { RouteModel, RoutePoint } from '../types/cycling';

interface Map3DProps {
  ghostPoint?: RoutePoint | null;
  route: RouteModel | null;
  currentPoint: RoutePoint | null;
}

export const Map3D: React.FC<Map3DProps> = ({ route, currentPoint, ghostPoint }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const ghostMarkerRef = useRef<maplibregl.Marker | null>(null);
  const isLoadedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialCenter: [number, number] = route && route.points.length > 0
      ? [route.points[0].lng, route.points[0].lat]
      : [-122.4851, 37.8324];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/dark', // Free keyless OpenFreeMap dark vector style
      center: initialCenter,
      zoom: 13,
      pitch: 45, // Tilted enough for terrain while retaining a full-course overview
      bearing: 0,
      interactive: true,
      attributionControl: { compact: true }, // Compact attribution for OpenFreeMap/OSM compliance
    });

    map.on('styleimagemissing', ({ id }) => {
      if (!map.hasImage(id)) {
        map.addImage(id, {
          width: 1,
          height: 1,
          data: new Uint8Array([71, 85, 105, 255]),
        });
      }
    });

    map.on('load', () => {
      isLoadedRef.current = true;

      // Add AWS Open Data 3D Terrain DEM source for real mountain relief
      try {
        map.addSource('aws-terrain', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom: 15,
          attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">Mapzen and elevation data providers</a>',
        });

        map.setTerrain({
          source: 'aws-terrain',
          exaggeration: 1.5,
        });
      } catch (e) {
        console.warn('[Map3D] Could not load 3D terrain DEM layer:', e);
      }

      // Add Neon Route Line Layers
      if (route && route.points.length > 1) {
        const coordinates = route.points.map((p) => [p.lng, p.lat]);

        map.addSource('route-source', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates,
            },
          },
        });

        // Glowing outer casing
        map.addLayer({
          id: 'route-glow',
          type: 'line',
          source: 'route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#00f0ff',
            'line-width': 18,
            'line-opacity': 0.55,
            'line-blur': 7,
          },
        });

        // Sharp core line
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#00f0ff',
            'line-width': 6,
            'line-opacity': 1,
          },
        });

        const bounds = new maplibregl.LngLatBounds();
        for (const point of route.points) bounds.extend([point.lng, point.lat]);
        map.fitBounds(bounds, {
          padding: 20,
          maxZoom: 14.5,
          pitch: 45,
          duration: 0,
        });
      }
    });

    // Pulsating Rider Pin Marker
    const el = document.createElement('div');
    el.className = 'relative flex items-center justify-center';
    el.innerHTML = `
      <div class="w-8 h-8 rounded-full bg-cyan-400/40 animate-ping absolute"></div>
      <div class="w-5 h-5 rounded-full bg-cyan-400 border-2 border-white shadow-[0_0_15px_#00f0ff] relative z-10"></div>
    `;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(initialCenter)
      .addTo(map);

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      ghostMarkerRef.current?.remove();
      ghostMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      isLoadedRef.current = false;
    };
  }, []);

  // Update Route Geometry
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current || !route || route.points.length < 2) return;

    const coordinates = route.points.map((p) => [p.lng, p.lat]);
    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates,
      },
    };

    const source = map.getSource('route-source') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(geojson);
    } else {
      map.addSource('route-source', {
        type: 'geojson',
        data: geojson,
      });
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#00f0ff', 'line-width': 18, 'line-opacity': 0.55, 'line-blur': 7 },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#00f0ff', 'line-width': 6, 'line-opacity': 1 },
      });
    }

    if (route.points.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const point of route.points) bounds.extend([point.lng, point.lat]);
      map.fitBounds(bounds, {
        padding: 20,
        maxZoom: 14.5,
        pitch: 45,
        duration: 500,
      });
    }
  }, [route]);

  useEffect(() => {
    if (!mapRef.current || !ghostPoint) {
      ghostMarkerRef.current?.remove();
      ghostMarkerRef.current = null;
      return;
    }
    if (!ghostMarkerRef.current) {
      const element = document.createElement('div');
      element.setAttribute('aria-label', 'Your previous ride ghost');
      element.textContent = 'G';
      element.style.cssText = 'width:28px;height:28px;border:2px solid white;border-radius:50%;background:#a78bfa;color:#171024;text-align:center;font-weight:bold;line-height:24px;opacity:0.85';
      ghostMarkerRef.current = new maplibregl.Marker({ element }).setLngLat([ghostPoint.lng, ghostPoint.lat]).addTo(mapRef.current);
    }
    ghostMarkerRef.current.setLngLat([ghostPoint.lng, ghostPoint.lat]);
  }, [ghostPoint]);

  // Move the rider marker while retaining the full-route overview.
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || !currentPoint || (currentPoint.lat === 0 && currentPoint.lng === 0)) return;

    const targetLngLat: [number, number] = [currentPoint.lng, currentPoint.lat];
    marker.setLngLat(targetLngLat);
  }, [currentPoint]);

  return (
    <div className="relative w-full h-full rounded-3xl overflow-hidden border border-cardBorder shadow-2xl bg-card">
      <div ref={mapContainerRef} className="w-full h-full" />
      {/* Subtle vignette gradient overlay */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/30 via-transparent to-background/15" />
    </div>
  );
};

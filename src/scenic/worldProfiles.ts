import type { ScenicTheme } from '../types/scenic';

export type ScenicArchitecture = 'none' | 'coastal' | 'glacial' | 'monolith' | 'industrial' | 'city';
export type ScenicWaterway = 'none' | 'stream' | 'ice' | 'runoff' | 'canal';

export interface ScenicAssetPair {
  standard: string;
  low: string;
}

export interface ScenicIndividualAsset extends ScenicAssetPair {
  /** Source-pixel width divided by source-pixel height; preserves cutout proportions. */
  aspectRatio: number;
  /** Relative frequency within its family. */
  selectionWeight?: number;
  /** Theme-specific size correction applied to generated instance height. */
  heightScale?: number;
  /** Fraction of the rendered height embedded below sampled terrain. */
  groundSink?: number;
}

export interface ScenicWorldProfile {
  referenceArt?: string;
  panorama?: ScenicAssetPair & {
    yawDegrees?: number;
    intensity?: number;
  };
  biomeBillboard?: ScenicAssetPair & {
    density: number;
    minHeight: number;
    maxHeight: number;
  };
  individualAssets?: {
    tree: readonly ScenicIndividualAsset[];
    rock: readonly ScenicIndividualAsset[];
    groundCover: readonly ScenicIndividualAsset[];
    waterfall?: readonly ScenicIndividualAsset[];
  };
  terrain: {
    highColor: string;
    formationStrength: number;
    rollingStrength: number;
    sideBias: number;
    terraces: number;
    shoulderWidth: number;
  };
  floor: {
    color: string;
    roughness: number;
    metalness: number;
    depth: number;
  };
  scenery: {
    treeDensity: number;
    rockDensity: number;
    mountainDensity: number;
    architecture: ScenicArchitecture;
    architectureDensity: number;
    structureColor: string;
    structureAccent: string;
  };
  waterway: {
    kind: ScenicWaterway;
    color: string;
    width: number;
    opacity: number;
  };
}

export const SCENIC_WORLD_PROFILES = {
  daybreak: {
    terrain: {
      highColor: '#66716a', formationStrength: 4.8, rollingStrength: 1, sideBias: 0.16, terraces: 0.08,
      shoulderWidth: 1.28,
    },
    floor: { color: '#263f38', roughness: 1, metalness: 0, depth: 7.5 },
    scenery: {
      treeDensity: 1, rockDensity: 0.7, mountainDensity: 1, architecture: 'none', architectureDensity: 0,
      structureColor: '#68777c', structureAccent: '#eff8f7',
    },
    waterway: { kind: 'stream', color: '#87bfc8', width: 0.28, opacity: 0.68 },
  },
  moonride: {
    terrain: {
      highColor: '#2b2858', formationStrength: 3.4, rollingStrength: 1.35, sideBias: 0.08, terraces: 0.22,
      shoulderWidth: 1.28,
    },
    floor: { color: '#0c0d21', roughness: 1, metalness: 0, depth: 7.5 },
    scenery: {
      treeDensity: 0.55, rockDensity: 1, mountainDensity: 0.9, architecture: 'monolith', architectureDensity: 0.18,
      structureColor: '#272144', structureAccent: '#22d3ee',
    },
    waterway: { kind: 'none', color: '#272144', width: 0, opacity: 0 },
  },
  deathisland: {
    panorama: {
      standard: `${import.meta.env.BASE_URL}scenic/skies/verdant-tide-sky-equirect.webp`,
      low: `${import.meta.env.BASE_URL}scenic/skies/verdant-tide-sky-equirect-low.webp`,
      yawDegrees: -18,
    },
    biomeBillboard: {
      standard: `${import.meta.env.BASE_URL}scenic/props/verdant-tide-biome.webp`,
      low: `${import.meta.env.BASE_URL}scenic/props/verdant-tide-biome-low.webp`,
      density: 0.28, minHeight: 1.7, maxHeight: 3.1,
    },
    individualAssets: {
      tree: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/deathisland-tropical-tree-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/deathisland-tropical-tree-a-v1-low.webp`,
        aspectRatio: 1622 / 1025,
        heightScale: 0.68,
      }],
      rock: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/deathisland-volcanic-rock-cluster-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/deathisland-volcanic-rock-cluster-a-v1-low.webp`,
        aspectRatio: 1568 / 955,
      }],
      groundCover: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/deathisland-lush-groundcover-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/deathisland-lush-groundcover-a-v1-low.webp`,
        aspectRatio: 1577 / 997,
      }],
    },
    terrain: {
      highColor: '#71806a', formationStrength: 5.2, rollingStrength: 1.25, sideBias: 0.86, terraces: 0.42,
      shoulderWidth: 1.52,
    },
    floor: { color: '#145f6d', roughness: 0.2, metalness: 0.14, depth: 3.8 },
    scenery: {
      treeDensity: 0.5, rockDensity: 1.1, mountainDensity: 0.7, architecture: 'coastal', architectureDensity: 0.26,
      structureColor: '#4b5551', structureAccent: '#79d3d8',
    },
    waterway: { kind: 'stream', color: '#5da9b3', width: 0.4, opacity: 0.72 },
  },
  avalanche: {
    panorama: {
      standard: `${import.meta.env.BASE_URL}scenic/skies/glacier-vault-sky-equirect.webp`,
      low: `${import.meta.env.BASE_URL}scenic/skies/glacier-vault-sky-equirect-low.webp`,
      yawDegrees: 12,
    },
    biomeBillboard: {
      standard: `${import.meta.env.BASE_URL}scenic/props/glacier-vault-biome.webp`,
      low: `${import.meta.env.BASE_URL}scenic/props/glacier-vault-biome-low.webp`,
      density: 0.24, minHeight: 1.9, maxHeight: 3.5,
    },
    individualAssets: {
      tree: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/avalanche-snow-laden-subalpine-fir-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/avalanche-snow-laden-subalpine-fir-a-v1-low.webp`,
        aspectRatio: 1024 / 1536,
      }],
      rock: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/avalanche-glacial-boulder-cluster-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/avalanche-glacial-boulder-cluster-a-v1-low.webp`,
        aspectRatio: 1536 / 1024,
      }],
      groundCover: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/avalanche-wind-sculpted-snowdrift-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/avalanche-wind-sculpted-snowdrift-a-v1-low.webp`,
        aspectRatio: 1774 / 887,
      }],
    },
    terrain: {
      highColor: '#e6f1f6', formationStrength: 7.2, rollingStrength: 0.72, sideBias: 0.12, terraces: 0.34,
      shoulderWidth: 1.48,
    },
    floor: { color: '#8197a8', roughness: 0.8, metalness: 0, depth: 5.2 },
    scenery: {
      treeDensity: 0.32, rockDensity: 0.72, mountainDensity: 1.35, architecture: 'glacial', architectureDensity: 0.28,
      structureColor: '#8094a2', structureAccent: '#8be4f0',
    },
    waterway: { kind: 'ice', color: '#9ee8f3', width: 0.42, opacity: 0.56 },
  },
  sidewinder: {
    panorama: {
      standard: `${import.meta.env.BASE_URL}scenic/skies/frozen-night-sky-equirect.webp`,
      low: `${import.meta.env.BASE_URL}scenic/skies/frozen-night-sky-equirect-low.webp`,
      yawDegrees: 22,
      intensity: 0.88,
    },
    biomeBillboard: {
      standard: `${import.meta.env.BASE_URL}scenic/props/frozen-night-biome.webp`,
      low: `${import.meta.env.BASE_URL}scenic/props/frozen-night-biome-low.webp`,
      density: 0.2, minHeight: 1.7, maxHeight: 3.2,
    },
    individualAssets: {
      tree: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/sidewinder-wind-bent-boreal-conifer-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/sidewinder-wind-bent-boreal-conifer-a-v1-low.webp`,
        aspectRatio: 1024 / 1536,
      }],
      rock: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/sidewinder-frosted-slate-outcrop-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/sidewinder-frosted-slate-outcrop-a-v1-low.webp`,
        aspectRatio: 1536 / 1024,
      }],
      groundCover: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/sidewinder-frozen-tundra-grass-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/sidewinder-frozen-tundra-grass-a-v1-low.webp`,
        aspectRatio: 1536 / 1024,
      }],
    },
    terrain: {
      highColor: '#dbe7ed', formationStrength: 6.5, rollingStrength: 0.8, sideBias: -0.1, terraces: 0.28,
      shoulderWidth: 1.46,
    },
    floor: { color: '#344554', roughness: 0.84, metalness: 0.02, depth: 5.5 },
    scenery: {
      treeDensity: 0.28, rockDensity: 0.9, mountainDensity: 1.2, architecture: 'glacial', architectureDensity: 0.18,
      structureColor: '#4b5962', structureAccent: '#8ad7e3',
    },
    waterway: { kind: 'ice', color: '#6da9c6', width: 0.38, opacity: 0.48 },
  },
  snowbound: {
    panorama: {
      standard: `${import.meta.env.BASE_URL}scenic/skies/cobalt-expanse-sky-equirect.webp`,
      low: `${import.meta.env.BASE_URL}scenic/skies/cobalt-expanse-sky-equirect-low.webp`,
      yawDegrees: -12,
    },
    biomeBillboard: {
      standard: `${import.meta.env.BASE_URL}scenic/props/cobalt-expanse-biome.webp`,
      low: `${import.meta.env.BASE_URL}scenic/props/cobalt-expanse-biome-low.webp`,
      density: 0.2, minHeight: 1.25, maxHeight: 2.4,
    },
    individualAssets: {
      tree: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/snowbound-blue-ice-blade-formation-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/snowbound-blue-ice-blade-formation-a-v1-low.webp`,
        aspectRatio: 1024 / 1536,
        heightScale: 0.48,
      }],
      rock: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/snowbound-polar-basalt-boulder-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/snowbound-polar-basalt-boulder-a-v1-low.webp`,
        aspectRatio: 1536 / 1024,
        heightScale: 0.68,
      }],
      groundCover: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/snowbound-lavender-ice-crystal-cluster-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/snowbound-lavender-ice-crystal-cluster-a-v1-low.webp`,
        aspectRatio: 1536 / 1024,
      }],
    },
    terrain: {
      highColor: '#f4f7fb', formationStrength: 3.7, rollingStrength: 0.62, sideBias: 0.02, terraces: 0.16,
      shoulderWidth: 1.5,
    },
    floor: { color: '#a8b9cb', roughness: 0.72, metalness: 0.02, depth: 5.8 },
    scenery: {
      treeDensity: 0.04, rockDensity: 0.8, mountainDensity: 0.6, architecture: 'monolith', architectureDensity: 0.48,
      structureColor: '#465067', structureAccent: '#a78bfa',
    },
    waterway: { kind: 'ice', color: '#c7d9f4', width: 0.46, opacity: 0.52 },
  },
  forgeworld: {
    panorama: {
      standard: `${import.meta.env.BASE_URL}scenic/skies/alpine-fjord-sky-equirect.webp`,
      low: `${import.meta.env.BASE_URL}scenic/skies/alpine-fjord-sky-equirect-low.webp`,
      yawDegrees: 8,
    },
    biomeBillboard: {
      standard: `${import.meta.env.BASE_URL}scenic/props/alpine-fjord-biome.webp`,
      low: `${import.meta.env.BASE_URL}scenic/props/alpine-fjord-biome-low.webp`,
      density: 0.36, minHeight: 1.9, maxHeight: 3.8,
    },
    individualAssets: {
      tree: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/forge-alpine-conifer-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/forge-alpine-conifer-a-v1-low.webp`,
        aspectRatio: 1024 / 1600,
        selectionWeight: 0.55,
      }, {
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/forge-alpine-conifer-b-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/forge-alpine-conifer-b-v1-low.webp`,
        aspectRatio: 1024 / 1507,
        selectionWeight: 0.45,
      }],
      rock: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/forge-mossy-granite-cluster-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/forge-mossy-granite-cluster-a-v1-low.webp`,
        aspectRatio: 1536 / 990,
        selectionWeight: 0.72,
      }, {
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/forge-fractured-granite-outcrop-b-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/forge-fractured-granite-outcrop-b-v1-low.webp`,
        aspectRatio: 1224 / 1278,
        selectionWeight: 0.28,
      }],
      groundCover: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/forge-fern-wildflower-groundcover-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/forge-fern-wildflower-groundcover-a-v1-low.webp`,
        aspectRatio: 1536 / 994,
      }, {
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/forge-alpine-heather-groundcover-b-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/forge-alpine-heather-groundcover-b-v1-low.webp`,
        aspectRatio: 1536 / 991,
      }],
      waterfall: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/forge-alpine-waterfall-cascade-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/forge-alpine-waterfall-cascade-a-v1-low.webp`,
        aspectRatio: 1024 / 1528,
      }],
    },
    terrain: {
      highColor: '#7d8d78', formationStrength: 6.3, rollingStrength: 1.12, sideBias: 0.72, terraces: 0.38,
      shoulderWidth: 1.58,
    },
    floor: { color: '#27758a', roughness: 0.18, metalness: 0.1, depth: 4.2 },
    scenery: {
      treeDensity: 0.9, rockDensity: 1.2, mountainDensity: 1.25, architecture: 'monolith', architectureDensity: 0.25,
      structureColor: '#596a69', structureAccent: '#b9eef0',
    },
    waterway: { kind: 'stream', color: '#547f83', width: 0.3, opacity: 0.56 },
  },
  powerhouse: {
    panorama: {
      standard: `${import.meta.env.BASE_URL}scenic/skies/copper-ravine-sky-equirect.webp`,
      low: `${import.meta.env.BASE_URL}scenic/skies/copper-ravine-sky-equirect-low.webp`,
      yawDegrees: 16,
    },
    biomeBillboard: {
      standard: `${import.meta.env.BASE_URL}scenic/props/copper-ravine-biome.webp`,
      low: `${import.meta.env.BASE_URL}scenic/props/copper-ravine-biome-low.webp`,
      density: 0.24, minHeight: 1.35, maxHeight: 2.7,
    },
    individualAssets: {
      tree: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/powerhouse-industrial-utility-cabinet-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/powerhouse-industrial-utility-cabinet-a-v1-low.webp`,
        aspectRatio: 988 / 1200,
        heightScale: 0.17,
      }],
      rock: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/powerhouse-red-rock-outcrop-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/powerhouse-red-rock-outcrop-a-v1-low.webp`,
        aspectRatio: 1592 / 728,
        heightScale: 0.72,
      }],
      groundCover: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/powerhouse-dry-groundcover-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/powerhouse-dry-groundcover-a-v1-low.webp`,
        aspectRatio: 1603 / 929,
      }],
    },
    terrain: {
      highColor: '#9d7457', formationStrength: 6.8, rollingStrength: 0.92, sideBias: -0.24, terraces: 0.68,
      shoulderWidth: 1.5,
    },
    floor: { color: '#49392f', roughness: 0.88, metalness: 0.04, depth: 5.5 },
    scenery: {
      treeDensity: 0.08, rockDensity: 1.35, mountainDensity: 1.1, architecture: 'industrial', architectureDensity: 0.64,
      structureColor: '#5b4b41', structureAccent: '#e7a764',
    },
    waterway: { kind: 'runoff', color: '#805f45', width: 0.34, opacity: 0.82 },
  },
  nmpdhq: {
    panorama: {
      standard: `${import.meta.env.BASE_URL}scenic/skies/violet-metropolis-sky-equirect.webp`,
      low: `${import.meta.env.BASE_URL}scenic/skies/violet-metropolis-sky-equirect-low.webp`,
      intensity: 0.92,
    },
    biomeBillboard: {
      standard: `${import.meta.env.BASE_URL}scenic/props/violet-metropolis-biome.webp`,
      low: `${import.meta.env.BASE_URL}scenic/props/violet-metropolis-biome-low.webp`,
      density: 0.2, minHeight: 1.1, maxHeight: 2.1,
    },
    individualAssets: {
      tree: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/nmpdhq-wet-street-tree-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/nmpdhq-wet-street-tree-a-v1-low.webp`,
        aspectRatio: 950 / 1589,
        heightScale: 0.62,
      }],
      rock: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/nmpdhq-concrete-metal-barrier-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/nmpdhq-concrete-metal-barrier-a-v1-low.webp`,
        aspectRatio: 1611 / 842,
        heightScale: 0.62,
        groundSink: 0.12,
      }],
      groundCover: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/nmpdhq-wet-urban-planter-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/nmpdhq-wet-urban-planter-a-v1-low.webp`,
        aspectRatio: 1595 / 1035,
      }],
    },
    terrain: {
      highColor: '#5b5660', formationStrength: 1.4, rollingStrength: 0.15, sideBias: 0, terraces: 0.82,
      shoulderWidth: 1.72,
    },
    floor: { color: '#24242b', roughness: 0.34, metalness: 0.34, depth: 4.8 },
    scenery: {
      treeDensity: 0, rockDensity: 0.04, mountainDensity: 0, architecture: 'city', architectureDensity: 1,
      structureColor: '#35323b', structureAccent: '#f09a7f',
    },
    waterway: { kind: 'canal', color: '#4d3a48', width: 0.3, opacity: 0.86 },
  },
  coastalhighway: {
    panorama: {
      standard: `${import.meta.env.BASE_URL}scenic/skies/sunset-promenade-sky-equirect.webp`,
      low: `${import.meta.env.BASE_URL}scenic/skies/sunset-promenade-sky-equirect-low.webp`,
      yawDegrees: -8,
    },
    biomeBillboard: {
      standard: `${import.meta.env.BASE_URL}scenic/props/sunset-promenade-biome.webp`,
      low: `${import.meta.env.BASE_URL}scenic/props/sunset-promenade-biome-low.webp`,
      density: 0.28, minHeight: 1.8, maxHeight: 3.4,
    },
    individualAssets: {
      tree: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/coastalhighway-wind-bent-palm-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/coastalhighway-wind-bent-palm-a-v1-low.webp`,
        aspectRatio: 951 / 1549,
        heightScale: 0.86,
      }],
      rock: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/coastalhighway-limestone-planter-rock-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/coastalhighway-limestone-planter-rock-a-v1-low.webp`,
        aspectRatio: 1600 / 827,
        heightScale: 0.5,
      }],
      groundCover: [{
        standard: `${import.meta.env.BASE_URL}scenic/props/individual/coastalhighway-tropical-groundcover-a-v1.webp`,
        low: `${import.meta.env.BASE_URL}scenic/props/individual/coastalhighway-tropical-groundcover-a-v1-low.webp`,
        aspectRatio: 1628 / 958,
      }],
    },
    terrain: {
      highColor: '#806e61', formationStrength: 2.7, rollingStrength: 0.35, sideBias: 0.7, terraces: 0.72,
      shoulderWidth: 1.68,
    },
    floor: { color: '#39434a', roughness: 0.28, metalness: 0.24, depth: 4.2 },
    scenery: {
      treeDensity: 0.15, rockDensity: 0.3, mountainDensity: 0.18, architecture: 'city', architectureDensity: 0.68,
      structureColor: '#403b3b', structureAccent: '#ffc36e',
    },
    waterway: { kind: 'stream', color: '#b76f4e', width: 0.4, opacity: 0.7 },
  },
} satisfies Record<ScenicTheme, ScenicWorldProfile>;

export function getScenicWorldProfile(theme: ScenicTheme): ScenicWorldProfile {
  return SCENIC_WORLD_PROFILES[theme];
}

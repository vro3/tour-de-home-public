import * as THREE from 'three';

export const PROCEDURAL_SURFACE_KINDS = [
  'terrain',
  'rock',
  'road',
  'city',
  'industrial',
] as const;

export type ProceduralSurfaceKind = typeof PROCEDURAL_SURFACE_KINDS[number];
export type ProceduralMaterialQuality = 'low' | 'standard';

export interface ProceduralSurfaceSpec {
  kind: ProceduralSurfaceKind;
  seed: number;
  baseColor?: string;
  accentColor?: string;
  detailColor?: string;
  resolution?: number;
  repeat?: readonly [number, number];
  anisotropy?: number;
  quality?: ProceduralMaterialQuality;
  vertexColors?: boolean;
  flatShading?: boolean;
  emissiveColor?: string;
  emissiveIntensity?: number;
}

export interface ProceduralAlbedoSurfacePixels {
  width: number;
  height: number;
  albedo: Uint8ClampedArray;
}

export interface ProceduralSurfacePixels extends ProceduralAlbedoSurfacePixels {
  roughness: Uint8ClampedArray;
  normal: Uint8ClampedArray;
}

export interface ProceduralMaterialBundle {
  readonly key: string;
  readonly material: THREE.MeshStandardMaterial;
  readonly textures: readonly THREE.CanvasTexture[];
  readonly disposed: boolean;
  dispose: () => void;
}

export interface ProceduralMaterialLease {
  readonly key: string;
  readonly material: THREE.MeshStandardMaterial;
  readonly bundle: ProceduralMaterialBundle;
  release: () => void;
}

interface SurfacePreset {
  baseColor: string;
  accentColor: string;
  detailColor: string;
  roughness: number;
  metalness: number;
  normalStrength: number;
}

interface NormalizedSurfaceSpec {
  kind: ProceduralSurfaceKind;
  seed: number;
  baseColor: string;
  accentColor: string;
  detailColor: string;
  resolution: number;
  repeat: readonly [number, number];
  anisotropy: number;
  quality: ProceduralMaterialQuality;
  vertexColors: boolean;
  flatShading: boolean;
  emissiveColor: string;
  emissiveIntensity: number;
}

interface SurfaceSample {
  height: number;
  accentMix: number;
  detailMix: number;
  shade: number;
  roughness: number;
}

const SURFACE_PRESETS: Record<ProceduralSurfaceKind, SurfacePreset> = {
  terrain: {
    baseColor: '#40563f',
    accentColor: '#66705a',
    detailColor: '#283c2d',
    roughness: 0.94,
    metalness: 0,
    normalStrength: 2.2,
  },
  rock: {
    baseColor: '#626866',
    accentColor: '#89908a',
    detailColor: '#343a39',
    roughness: 0.9,
    metalness: 0.02,
    normalStrength: 3.4,
  },
  road: {
    baseColor: '#202326',
    accentColor: '#3e4244',
    detailColor: '#0d1012',
    roughness: 0.84,
    metalness: 0.03,
    normalStrength: 1.15,
  },
  city: {
    baseColor: '#353941',
    accentColor: '#59616b',
    detailColor: '#171a20',
    roughness: 0.48,
    metalness: 0.32,
    normalStrength: 1.35,
  },
  industrial: {
    baseColor: '#514943',
    accentColor: '#8a6249',
    detailColor: '#25282a',
    roughness: 0.66,
    metalness: 0.44,
    normalStrength: 1.8,
  },
};

// 128px keeps five standard surface bundles near 1.25 MiB of GPU texture data
// (before driver alignment) while still tiling cleanly at the scene's scale.
const DEFAULT_RESOLUTION = 128;
const MIN_RESOLUTION = 32;
const MAX_RESOLUTION = 512;
const MAX_ANISOTROPY = 8;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp01((value - edge0) / Math.max(0.000001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function hashCoordinate(seed: number, x: number, y: number): number {
  let value = seed ^ Math.imul(x + 0x632BE5AB, 0x9E3779B1) ^ Math.imul(y + 0x85157AF5, 0x85EBCA77);
  value = Math.imul(value ^ (value >>> 16), 0x7FEB352D);
  value = Math.imul(value ^ (value >>> 15), 0x846CA68B);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = smoothstep(0, 1, x - x0);
  const ty = smoothstep(0, 1, y - y0);
  const sample = (sampleX: number, sampleY: number) => hashCoordinate(
    seed,
    positiveModulo(sampleX, cells),
    positiveModulo(sampleY, cells),
  );
  const top = THREE.MathUtils.lerp(sample(x0, y0), sample(x1, y0), tx);
  const bottom = THREE.MathUtils.lerp(sample(x0, y1), sample(x1, y1), tx);
  return THREE.MathUtils.lerp(top, bottom, ty);
}

function periodicFbm(u: number, v: number, seed: number, baseCells: number): number {
  let amplitude = 0.54;
  let weight = 0;
  let value = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    value += periodicValueNoise(u, v, baseCells * (2 ** octave), seed + octave * 0x1F123BB5) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
  }
  return value / weight;
}

function distanceToGridLine(value: number, cells: number): number {
  const cellPosition = positiveModulo(value * cells, 1);
  return Math.min(cellPosition, 1 - cellPosition);
}

function sampleSurface(
  kind: ProceduralSurfaceKind,
  u: number,
  v: number,
  seed: number,
  pixelX: number,
  pixelY: number,
): SurfaceSample {
  const macro = periodicFbm(u, v, seed ^ 0xA531, 3);
  const detail = periodicFbm(u, v, seed ^ 0xB79F, 11);
  const grain = hashCoordinate(seed ^ 0xC0FFEE, pixelX, pixelY);

  if (kind === 'terrain') {
    const grassFleck = grain > 0.955 ? smoothstep(0.955, 1, grain) : 0;
    return {
      height: clamp01(0.18 + macro * 0.58 + detail * 0.2 + grassFleck * 0.08),
      accentMix: clamp01(0.12 + macro * 0.52 + detail * 0.12),
      detailMix: grassFleck * 0.58,
      shade: 0.82 + detail * 0.26,
      roughness: clamp01(0.82 + detail * 0.16 + grassFleck * 0.02),
    };
  }

  if (kind === 'rock') {
    const ridge = 1 - Math.abs(macro * 2 - 1);
    const crack = 1 - smoothstep(0.018, 0.09, Math.abs(detail - 0.5));
    return {
      height: clamp01(0.12 + ridge * 0.72 - crack * 0.18 + grain * 0.05),
      accentMix: clamp01(0.12 + ridge * 0.62),
      detailMix: crack * 0.78,
      shade: 0.76 + detail * 0.34,
      roughness: clamp01(0.78 + ridge * 0.18 + crack * 0.04),
    };
  }

  if (kind === 'road') {
    const crackNoise = periodicValueNoise(u, v, 7, seed ^ 0x4A11);
    const crack = 1 - smoothstep(0.004, 0.022, Math.abs(crackNoise - 0.5));
    const aggregate = grain > 0.96 ? smoothstep(0.96, 1, grain) : 0;
    return {
      height: clamp01(0.44 + (detail - 0.5) * 0.08 + aggregate * 0.055 - crack * 0.025),
      accentMix: clamp01(0.07 + detail * 0.13 + aggregate * 0.22),
      detailMix: crack * 0.32,
      shade: 0.92 + (grain - 0.5) * 0.1,
      roughness: clamp01(0.76 + detail * 0.16 + aggregate * 0.04),
    };
  }

  if (kind === 'city') {
    const verticalSeam = 1 - smoothstep(0.012, 0.045, distanceToGridLine(u, 8));
    const horizontalSeam = 1 - smoothstep(0.012, 0.045, distanceToGridLine(v, 12));
    const seam = Math.max(verticalSeam, horizontalSeam);
    const panelX = Math.floor(u * 8);
    const panelY = Math.floor(v * 12);
    const panelVariation = hashCoordinate(seed ^ 0xC17C, panelX, panelY);
    const inset = smoothstep(0.055, 0.15, distanceToGridLine(u, 8))
      * smoothstep(0.055, 0.15, distanceToGridLine(v, 12));
    return {
      height: clamp01(0.4 + inset * 0.1 - seam * 0.18 + detail * 0.025),
      accentMix: clamp01(0.1 + panelVariation * 0.38 + inset * 0.08),
      detailMix: seam * 0.82,
      shade: 0.88 + panelVariation * 0.18,
      roughness: clamp01(0.34 + panelVariation * 0.24 + seam * 0.2),
    };
  }

  const horizontalBrush = periodicValueNoise(u, v, 28, seed ^ 0x1D57);
  const seam = Math.max(
    1 - smoothstep(0.01, 0.035, distanceToGridLine(u, 6)),
    1 - smoothstep(0.01, 0.035, distanceToGridLine(v, 5)),
  );
  const rivetDistance = Math.hypot(
    distanceToGridLine(u + 0.005, 6),
    distanceToGridLine(v + 0.005, 5),
  );
  const rivet = 1 - smoothstep(0.022, 0.065, rivetDistance);
  const rust = smoothstep(0.58, 0.82, macro + (detail - 0.5) * 0.32);
  return {
    height: clamp01(0.38 + (horizontalBrush - 0.5) * 0.1 - seam * 0.13 + rivet * 0.24),
    accentMix: clamp01(0.08 + rust * 0.72 + rivet * 0.12),
    detailMix: seam * 0.76,
    shade: 0.82 + horizontalBrush * 0.26,
    roughness: clamp01(0.38 + rust * 0.46 + seam * 0.08),
  };
}

function parseHexColor(value: string, label: string): readonly [number, number, number] {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (!match) throw new Error(`${label} must be a #RGB or #RRGGBB color.`);
  const hex = match[1].length === 3
    ? match[1].split('').map((character) => `${character}${character}`).join('')
    : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function normalizeHexColor(value: string, label: string): string {
  const [red, green, blue] = parseHexColor(value, label);
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function mixColor(
  base: readonly [number, number, number],
  accent: readonly [number, number, number],
  detail: readonly [number, number, number],
  accentMix: number,
  detailMix: number,
  shade: number,
): readonly [number, number, number] {
  const detailAmount = clamp01(detailMix);
  const accentAmount = clamp01(accentMix) * (1 - detailAmount);
  const baseAmount = 1 - accentAmount - detailAmount;
  const channel = (index: number) => Math.round(clamp01(
    ((base[index] * baseAmount + accent[index] * accentAmount + detail[index] * detailAmount) * shade) / 255,
  ) * 255);
  return [channel(0), channel(1), channel(2)];
}

function nearestPowerOfTwo(value: number): number {
  const clamped = Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, value));
  return 2 ** Math.round(Math.log2(clamped));
}

function normalizeSpec(spec: ProceduralSurfaceSpec): NormalizedSurfaceSpec {
  const preset = SURFACE_PRESETS[spec.kind];
  const requestedResolution = Number.isFinite(spec.resolution) ? spec.resolution! : DEFAULT_RESOLUTION;
  const requestedRepeat = spec.repeat ?? [4, 4];
  const requestedAnisotropy = spec.anisotropy ?? 4;
  const requestedEmissiveIntensity = spec.emissiveIntensity ?? 0;
  if (!Number.isFinite(requestedRepeat[0]) || requestedRepeat[0] <= 0
    || !Number.isFinite(requestedRepeat[1]) || requestedRepeat[1] <= 0) {
    throw new Error('Texture repeat values must be finite and greater than zero.');
  }
  if (!Number.isFinite(requestedAnisotropy)) {
    throw new Error('Texture anisotropy must be finite.');
  }
  if (!Number.isFinite(requestedEmissiveIntensity) || requestedEmissiveIntensity < 0) {
    throw new Error('Material emissiveIntensity must be finite and non-negative.');
  }
  return {
    kind: spec.kind,
    seed: spec.seed >>> 0,
    baseColor: normalizeHexColor(spec.baseColor ?? preset.baseColor, 'baseColor'),
    accentColor: normalizeHexColor(spec.accentColor ?? preset.accentColor, 'accentColor'),
    detailColor: normalizeHexColor(spec.detailColor ?? preset.detailColor, 'detailColor'),
    resolution: nearestPowerOfTwo(requestedResolution),
    repeat: [requestedRepeat[0], requestedRepeat[1]],
    anisotropy: Math.round(Math.min(MAX_ANISOTROPY, Math.max(1, requestedAnisotropy))),
    quality: spec.quality ?? 'standard',
    vertexColors: spec.vertexColors ?? false,
    flatShading: spec.flatShading ?? false,
    emissiveColor: normalizeHexColor(spec.emissiveColor ?? '#000000', 'emissiveColor'),
    emissiveIntensity: requestedEmissiveIntensity,
  };
}

export function createProceduralMaterialKey(spec: ProceduralSurfaceSpec): string {
  const normalized = normalizeSpec(spec);
  return [
    normalized.kind,
    normalized.seed,
    normalized.baseColor.toLowerCase(),
    normalized.accentColor.toLowerCase(),
    normalized.detailColor.toLowerCase(),
    normalized.resolution,
    normalized.repeat[0],
    normalized.repeat[1],
    normalized.anisotropy,
    normalized.quality,
    normalized.vertexColors ? 1 : 0,
    normalized.flatShading ? 1 : 0,
    normalized.emissiveColor,
    normalized.emissiveIntensity,
  ].join(':');
}

export function createProceduralSurfacePixels(
  spec: ProceduralSurfaceSpec & { quality: 'low' },
): ProceduralAlbedoSurfacePixels;
export function createProceduralSurfacePixels(
  spec: ProceduralSurfaceSpec & { quality?: 'standard' },
): ProceduralSurfacePixels;
export function createProceduralSurfacePixels(
  spec: ProceduralSurfaceSpec,
): ProceduralAlbedoSurfacePixels | ProceduralSurfacePixels;
export function createProceduralSurfacePixels(
  spec: ProceduralSurfaceSpec,
): ProceduralAlbedoSurfacePixels | ProceduralSurfacePixels {
  const normalized = normalizeSpec(spec);
  const { resolution } = normalized;
  const pixelCount = resolution * resolution;
  const albedo = new Uint8ClampedArray(pixelCount * 4);
  const includePbrMaps = normalized.quality === 'standard';
  const roughness = includePbrMaps ? new Uint8ClampedArray(pixelCount * 4) : null;
  const heights = includePbrMaps ? new Float32Array(pixelCount) : null;
  const baseColor = parseHexColor(normalized.baseColor, 'baseColor');
  const accentColor = parseHexColor(normalized.accentColor, 'accentColor');
  const detailColor = parseHexColor(normalized.detailColor, 'detailColor');

  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const pixelIndex = y * resolution + x;
      const byteIndex = pixelIndex * 4;
      const sample = sampleSurface(
        normalized.kind,
        x / resolution,
        y / resolution,
        normalized.seed,
        x,
        y,
      );
      const color = mixColor(
        baseColor,
        accentColor,
        detailColor,
        sample.accentMix,
        sample.detailMix,
        sample.shade,
      );
      albedo[byteIndex] = color[0];
      albedo[byteIndex + 1] = color[1];
      albedo[byteIndex + 2] = color[2];
      albedo[byteIndex + 3] = 255;
      if (roughness && heights) {
        const roughnessByte = Math.round(clamp01(sample.roughness) * 255);
        roughness[byteIndex] = roughnessByte;
        roughness[byteIndex + 1] = roughnessByte;
        roughness[byteIndex + 2] = roughnessByte;
        roughness[byteIndex + 3] = 255;
        heights[pixelIndex] = sample.height;
      }
    }
  }

  if (!roughness || !heights) {
    return { width: resolution, height: resolution, albedo };
  }

  const normal = new Uint8ClampedArray(pixelCount * 4);
  const normalStrength = SURFACE_PRESETS[normalized.kind].normalStrength;
  const heightAt = (x: number, y: number) => heights[
    positiveModulo(y, resolution) * resolution + positiveModulo(x, resolution)
  ];
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const byteIndex = (y * resolution + x) * 4;
      const deltaX = (heightAt(x + 1, y) - heightAt(x - 1, y)) * normalStrength;
      const deltaY = (heightAt(x, y + 1) - heightAt(x, y - 1)) * normalStrength;
      const inverseLength = 1 / Math.hypot(deltaX, deltaY, 1);
      normal[byteIndex] = Math.round((-deltaX * inverseLength * 0.5 + 0.5) * 255);
      normal[byteIndex + 1] = Math.round((-deltaY * inverseLength * 0.5 + 0.5) * 255);
      normal[byteIndex + 2] = Math.round(inverseLength * 255);
      normal[byteIndex + 3] = 255;
    }
  }

  return { width: resolution, height: resolution, albedo, roughness, normal };
}

function createTexture(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  name: string,
  repeat: readonly [number, number],
  anisotropy: number,
  colorSpace: THREE.ColorSpace,
): THREE.CanvasTexture {
  if (typeof document === 'undefined') {
    throw new Error('Procedural CanvasTextures require a browser document. Use createProceduralSurfacePixels during SSR.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a 2D canvas context for procedural materials.');
  const image = context.createImageData(width, height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  return texture;
}

export function estimateProceduralTextureBytes(spec: ProceduralSurfaceSpec): number {
  const normalized = normalizeSpec(spec);
  const textureCount = normalized.quality === 'standard' ? 3 : 1;
  const baseBytes = normalized.resolution * normalized.resolution * 4 * textureCount;
  return Math.ceil(baseBytes * 4 / 3);
}

export function createProceduralMaterialBundle(spec: ProceduralSurfaceSpec): ProceduralMaterialBundle {
  const normalized = normalizeSpec(spec);
  const pixels = createProceduralSurfacePixels(normalized);
  const key = createProceduralMaterialKey(normalized);
  const textures: THREE.CanvasTexture[] = [];
  let material: THREE.MeshStandardMaterial;
  try {
    const albedo = createTexture(
      pixels.albedo,
      pixels.width,
      pixels.height,
      `${normalized.kind}-albedo`,
      normalized.repeat,
      normalized.anisotropy,
      THREE.SRGBColorSpace,
    );
    textures.push(albedo);
    let roughnessMap: THREE.CanvasTexture | null = null;
    let normalMap: THREE.CanvasTexture | null = null;

    if (normalized.quality === 'standard') {
      if (!('roughness' in pixels)) {
        throw new Error('Standard procedural materials require PBR pixel maps.');
      }
      roughnessMap = createTexture(
        pixels.roughness,
        pixels.width,
        pixels.height,
        `${normalized.kind}-roughness`,
        normalized.repeat,
        normalized.anisotropy,
        THREE.NoColorSpace,
      );
      textures.push(roughnessMap);
      normalMap = createTexture(
        pixels.normal,
        pixels.width,
        pixels.height,
        `${normalized.kind}-normal`,
        normalized.repeat,
        normalized.anisotropy,
        THREE.NoColorSpace,
      );
      textures.push(normalMap);
    }

    const preset = SURFACE_PRESETS[normalized.kind];
    material = new THREE.MeshStandardMaterial({
      name: `${normalized.kind}-procedural-material`,
      color: 0xffffff,
      map: albedo,
      roughness: normalized.quality === 'standard' ? 1 : preset.roughness,
      roughnessMap,
      metalness: preset.metalness,
      normalMap,
      normalScale: new THREE.Vector2(0.72, 0.72),
      envMapIntensity: normalized.kind === 'city' || normalized.kind === 'industrial' ? 0.9 : 0.65,
      vertexColors: normalized.vertexColors,
      flatShading: normalized.flatShading,
      emissive: normalized.emissiveColor,
      emissiveIntensity: normalized.emissiveIntensity,
    });
  } catch (error) {
    for (const texture of textures) texture.dispose();
    throw error;
  }
  let disposed = false;

  return {
    key,
    material,
    textures,
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of textures) texture.dispose();
      material.dispose();
    },
  };
}

export class ProceduralMaterialLibrary {
  private readonly entries = new Map<string, { bundle: ProceduralMaterialBundle; references: number }>();

  get size(): number {
    return this.entries.size;
  }

  acquire(spec: ProceduralSurfaceSpec): ProceduralMaterialLease {
    const key = createProceduralMaterialKey(spec);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { bundle: createProceduralMaterialBundle(spec), references: 0 };
      this.entries.set(key, entry);
    }
    entry.references += 1;
    let released = false;
    return {
      key,
      material: entry.bundle.material,
      bundle: entry.bundle,
      release: () => {
        if (released) return;
        released = true;
        const current = this.entries.get(key);
        if (!current) return;
        current.references -= 1;
        if (current.references <= 0) {
          current.bundle.dispose();
          this.entries.delete(key);
        }
      },
    };
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.bundle.dispose();
    this.entries.clear();
  }
}

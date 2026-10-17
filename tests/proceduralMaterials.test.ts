import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  PROCEDURAL_SURFACE_KINDS,
  ProceduralMaterialLibrary,
  createProceduralMaterialBundle,
  createProceduralMaterialKey,
  createProceduralSurfacePixels,
  estimateProceduralTextureBytes,
  type ProceduralSurfaceSpec,
} from '../src/scenic/proceduralMaterials';

function checksum(values: Uint8ClampedArray): number {
  let hash = 2166136261;
  for (let index = 0; index < values.length; index += 1) {
    hash ^= values[index];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeFakeCanvas() {
  const context = {
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
    putImageData: vi.fn(),
  };
  return {
    width: 0,
    height: 0,
    getContext: (kind: string) => kind === '2d' ? context : null,
  };
}

describe('procedural surface pixels', () => {
  it('generates deterministic but surface-specific PBR maps', () => {
    const signatures = new Set<number>();

    for (const kind of PROCEDURAL_SURFACE_KINDS) {
      const spec = { kind, seed: 0xC0FFEE, resolution: 32 } as const;
      const first = createProceduralSurfacePixels(spec);
      const second = createProceduralSurfacePixels(spec);

      expect(first.width).toBe(32);
      expect(first.height).toBe(32);
      expect(first.albedo).toEqual(second.albedo);
      expect(first.roughness).toEqual(second.roughness);
      expect(first.normal).toEqual(second.normal);
      expect(first.albedo).toHaveLength(32 * 32 * 4);
      expect(first.roughness).toHaveLength(first.albedo.length);
      expect(first.normal).toHaveLength(first.albedo.length);
      signatures.add(checksum(first.albedo));

      for (let byte = 0; byte < first.roughness.length; byte += 4) {
        expect(first.roughness[byte]).toBe(first.roughness[byte + 1]);
        expect(first.roughness[byte + 1]).toBe(first.roughness[byte + 2]);
        expect(first.roughness[byte + 3]).toBe(255);
        expect(first.normal[byte + 3]).toBe(255);
      }
    }

    expect(signatures.size).toBe(PROCEDURAL_SURFACE_KINDS.length);
  });

  it('changes deterministically with the seed and color recipe', () => {
    const base: ProceduralSurfaceSpec = {
      kind: 'rock',
      seed: 17,
      resolution: 32,
      baseColor: '#445566',
      accentColor: '#91a2b3',
      detailColor: '#111820',
    };
    const original = createProceduralSurfacePixels(base);
    const reseeded = createProceduralSurfacePixels({ ...base, seed: 18 });
    const recolored = createProceduralSurfacePixels({ ...base, accentColor: '#aa5533' });

    expect(checksum(original.normal)).not.toBe(checksum(reseeded.normal));
    expect(checksum(original.albedo)).not.toBe(checksum(recolored.albedo));
    expect(checksum(original.normal)).toBe(checksum(recolored.normal));
  });

  it('normalizes texture resolution and reports a bounded GPU memory estimate', () => {
    const standard = { kind: 'terrain', seed: 1, resolution: 70 } as const;
    const low = { ...standard, quality: 'low' as const };

    expect(createProceduralSurfacePixels(standard).width).toBe(64);
    expect(estimateProceduralTextureBytes(standard)).toBe(65_536);
    expect(estimateProceduralTextureBytes(low)).toBe(21_846);
    expect(createProceduralSurfacePixels({ ...standard, resolution: 2 }).width).toBe(32);
    expect(createProceduralSurfacePixels({ ...standard, resolution: 2_000 }).width).toBe(512);
  });

  it('generates only the albedo pixels requested by low quality', () => {
    const spec = { kind: 'road', seed: 91, resolution: 32 } as const;
    const standard = createProceduralSurfacePixels(spec);
    const low = createProceduralSurfacePixels({ ...spec, quality: 'low' });

    expect(low.albedo).toEqual(standard.albedo);
    expect(low).not.toHaveProperty('roughness');
    expect(low).not.toHaveProperty('normal');
    expect(Object.keys(low).sort()).toEqual(['albedo', 'height', 'width']);
  });

  it('validates color and tiling inputs before allocating pixel maps', () => {
    expect(() => createProceduralSurfacePixels({
      kind: 'road', seed: 1, baseColor: 'black', resolution: 32,
    })).toThrow(/baseColor/);
    expect(() => createProceduralMaterialKey({
      kind: 'road', seed: 1, repeat: [0, 2],
    })).toThrow(/repeat/);
  });
});

describe('procedural CanvasTexture material bundles', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
        return makeFakeCanvas();
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('configures tiled color, roughness, and normal textures and disposes them once', () => {
    const bundle = createProceduralMaterialBundle({
      kind: 'industrial',
      seed: 90210,
      resolution: 32,
      repeat: [3, 7],
      anisotropy: 99,
      flatShading: true,
      emissiveColor: '#e96',
      emissiveIntensity: 0.2,
    });
    const materialDispose = vi.fn();
    const textureDisposals = bundle.textures.map(() => vi.fn());
    bundle.material.addEventListener('dispose', materialDispose);
    bundle.textures.forEach((texture, index) => texture.addEventListener('dispose', textureDisposals[index]));

    expect(bundle.textures).toHaveLength(3);
    expect(bundle.material.map).toBe(bundle.textures[0]);
    expect(bundle.material.roughnessMap).toBe(bundle.textures[1]);
    expect(bundle.material.normalMap).toBe(bundle.textures[2]);
    expect(bundle.material.flatShading).toBe(true);
    expect(bundle.material.emissive.getHexString()).toBe('ee9966');
    expect(bundle.material.emissiveIntensity).toBe(0.2);
    expect(bundle.textures[0].colorSpace).toBe(THREE.SRGBColorSpace);
    expect(bundle.textures[1].colorSpace).toBe(THREE.NoColorSpace);
    expect(bundle.textures[2].colorSpace).toBe(THREE.NoColorSpace);
    for (const texture of bundle.textures) {
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT).toBe(THREE.RepeatWrapping);
      expect(texture.repeat.toArray()).toEqual([3, 7]);
      expect(texture.anisotropy).toBe(8);
    }

    bundle.dispose();
    bundle.dispose();

    expect(bundle.disposed).toBe(true);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    for (const disposed of textureDisposals) expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('offers an albedo-only low-detail material', () => {
    const bundle = createProceduralMaterialBundle({
      kind: 'road', seed: 88, resolution: 32, quality: 'low',
    });
    const materialDispose = vi.fn();
    const textureDispose = vi.fn();
    bundle.material.addEventListener('dispose', materialDispose);
    bundle.textures[0].addEventListener('dispose', textureDispose);

    expect(bundle.textures).toHaveLength(1);
    expect(bundle.material.map).toBe(bundle.textures[0]);
    expect(bundle.material.roughnessMap).toBeNull();
    expect(bundle.material.normalMap).toBeNull();
    expect(bundle.material.roughness).toBeGreaterThan(0.8);
    bundle.dispose();
    bundle.dispose();
    expect(bundle.disposed).toBe(true);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it('can multiply terrain textures with generated vertex colors', () => {
    const bundle = createProceduralMaterialBundle({
      kind: 'terrain', seed: 89, resolution: 32, vertexColors: true,
    });

    expect(bundle.material.vertexColors).toBe(true);
    bundle.dispose();
  });

  it('reference-counts shared materials and frees the final lease', () => {
    const library = new ProceduralMaterialLibrary();
    const spec = { kind: 'city', seed: 44, resolution: 32 } as const;
    const first = library.acquire(spec);
    const second = library.acquire({ ...spec, quality: 'standard' });
    const dispose = vi.fn();
    first.bundle.material.addEventListener('dispose', dispose);

    expect(library.size).toBe(1);
    expect(first.material).toBe(second.material);
    first.release();
    first.release();
    expect(library.size).toBe(1);
    expect(dispose).not.toHaveBeenCalled();

    second.release();
    expect(library.size).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('can dispose all still-leased materials during scene teardown', () => {
    const library = new ProceduralMaterialLibrary();
    const terrain = library.acquire({ kind: 'terrain', seed: 1, resolution: 32 });
    library.acquire({ kind: 'rock', seed: 2, resolution: 32 });
    const dispose = vi.fn();
    terrain.bundle.material.addEventListener('dispose', dispose);

    expect(library.size).toBe(2);
    library.dispose();
    expect(library.size).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

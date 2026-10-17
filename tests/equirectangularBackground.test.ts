import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  configureEquirectangularTexture,
  estimatePanoramaGpuBytes,
  getPanoramaCubeFaceLimit,
  isTwoToOnePanorama,
  panoramaYawForTangent,
} from '../src/scenic/EquirectangularBackground';

describe('equirectangular scenic backgrounds', () => {
  it('accepts exact 2:1 skies and rejects the old perspective art', () => {
    expect(isTwoToOnePanorama({ width: 2048, height: 1024 })).toBe(true);
    expect(isTwoToOnePanorama({ width: 1024, height: 512 })).toBe(true);
    expect(isTwoToOnePanorama({ width: 1672, height: 941 })).toBe(false);
  });

  it('caps cube faces to both the quality tier and GPU capabilities', () => {
    expect(getPanoramaCubeFaceLimit({ maxTextureSize: 8192, maxCubemapSize: 4096 }, 1024)).toBe(1024);
    expect(getPanoramaCubeFaceLimit({ maxTextureSize: 1024, maxCubemapSize: 2048 }, 1024)).toBe(512);
  });

  it('reports bounded source plus cube-map memory', () => {
    expect(estimatePanoramaGpuBytes(512)).toBe(8 * 1024 * 1024);
    expect(estimatePanoramaGpuBytes(1024)).toBe(32 * 1024 * 1024);
  });

  it('anchors panorama yaw to the initial route tangent', () => {
    expect(panoramaYawForTangent(new THREE.Vector3(1, 0, 0))).toBeCloseTo(0);
    expect(panoramaYawForTangent(new THREE.Vector3(0, 0, -1))).toBeCloseTo(Math.PI / 2);
  });

  it('configures sky textures without allocating mipmaps', () => {
    const texture = configureEquirectangularTexture(new THREE.Texture());
    expect(texture.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.generateMipmaps).toBe(false);
  });
});

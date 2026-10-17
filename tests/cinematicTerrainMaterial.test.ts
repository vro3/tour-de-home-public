import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  CINEMATIC_TERRAIN_ALPHA_ATTRIBUTE,
  CINEMATIC_TERRAIN_DISTANCE_ATTRIBUTE,
  cinematicTerrainAlphaWeight,
  createCinematicTerrainMaterial,
  distanceFadeAlpha,
  lateralFadeAlpha,
  patchCinematicTerrainShaderSources,
  setCinematicTerrainAlphaAttribute,
  setCinematicTerrainDistanceAttribute,
} from '../src/scenic/cinematicTerrainMaterial';

describe('cinematic terrain alpha weights', () => {
  it('smoothly fades absolute distance with clamped endpoints', () => {
    expect(distanceFadeAlpha(5, 10, 20)).toBe(1);
    expect(distanceFadeAlpha(10, 10, 20)).toBe(1);
    expect(distanceFadeAlpha(15, 10, 20)).toBeCloseTo(0.5);
    expect(distanceFadeAlpha(-15, 10, 20)).toBeCloseTo(0.5);
    expect(distanceFadeAlpha(20, 10, 20)).toBe(0);
    expect(distanceFadeAlpha(Number.POSITIVE_INFINITY, 10, 20)).toBe(0);
  });

  it('fades symmetrically at lateral edges and combines both weights', () => {
    expect(lateralFadeAlpha(-2, 3, 5)).toBe(1);
    expect(lateralFadeAlpha(4, 3, 5)).toBeCloseTo(0.5);
    expect(lateralFadeAlpha(-5, 3, 5)).toBe(0);
    expect(cinematicTerrainAlphaWeight(15, 4, [10, 20], [3, 5])).toBeCloseTo(0.25);
  });

  it('rejects ambiguous fade ranges', () => {
    expect(() => distanceFadeAlpha(1, 10, 10)).toThrow(/opaqueThrough/);
    expect(() => lateralFadeAlpha(1, -1, 10)).toThrow(/opaqueThrough/);
  });
});

describe('cinematic terrain geometry attribute', () => {
  it('adds a named scalar attribute and clamps unsafe weights', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
    ], 3));

    const attribute = setCinematicTerrainAlphaAttribute(
      geometry,
      [-0.2, 0.55, 2],
      'cinematicEdgeWeight',
    );

    expect(attribute.itemSize).toBe(1);
    expect(Array.from(attribute.array)).toEqual([0, 0.550000011920929, 1]);
    expect(geometry.getAttribute('cinematicEdgeWeight')).toBe(attribute);
    expect(() => setCinematicTerrainAlphaAttribute(geometry, [1, 1])).toThrow(/vertex count/);
  });

  it('adds the absolute route-distance attribute used by the live rider fade', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
    ], 3));

    const attribute = setCinematicTerrainDistanceAttribute(geometry, [390, 400, 410]);

    expect(Array.from(attribute.array)).toEqual([390, 400, 410]);
    expect(geometry.getAttribute(CINEMATIC_TERRAIN_DISTANCE_ATTRIBUTE)).toBe(attribute);
    expect(() => setCinematicTerrainDistanceAttribute(geometry, [390, 400])).toThrow(/vertex count/);
  });
});

describe('cinematic terrain shader patch', () => {
  const shaderSources = {
    vertexShader: `
      #include <common>
      void main() {
        #include <begin_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      void main() {
        vec4 diffuseColor = vec4( diffuse, opacity );
        #include <map_fragment>
        #include <alphatest_fragment>
      }
    `,
  };

  it('passes the named vertex scalar to final fragment alpha before alpha testing', () => {
    const patched = patchCinematicTerrainShaderSources(shaderSources, 'cinematicEdgeWeight');

    expect(patched.vertexShader).toContain('attribute float cinematicEdgeWeight;');
    expect(patched.vertexShader).toContain(
      `attribute float ${CINEMATIC_TERRAIN_DISTANCE_ATTRIBUTE};`,
    );
    expect(patched.vertexShader).toContain(
      'vCinematicTerrainAlpha = clamp(cinematicEdgeWeight, 0.0, 1.0) * cinematicTerrainDistanceAlpha;',
    );
    expect(patched.fragmentShader).toContain(
      'diffuseColor.a *= clamp(vCinematicTerrainAlpha, 0.0, 1.0);',
    );
    expect(patched.fragmentShader.indexOf('diffuseColor.a *=')).toBeLessThan(
      patched.fragmentShader.indexOf('#include <alphatest_fragment>'),
    );
    expect(patchCinematicTerrainShaderSources(patched, 'cinematicEdgeWeight')).toBe(patched);
  });

  it('fails clearly if Three shader chunks become incompatible', () => {
    expect(() => patchCinematicTerrainShaderSources({
      vertexShader: 'void main() {}',
      fragmentShader: shaderSources.fragmentShader,
    })).toThrow(/missing <common>/);
    expect(() => patchCinematicTerrainShaderSources(shaderSources, 'not-valid!')).toThrow(/Invalid GLSL/);
  });

  it('patches the MeshStandardMaterial shader shipped by the installed Three version', () => {
    const patched = patchCinematicTerrainShaderSources({
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    });

    expect(patched.vertexShader).toContain(`attribute float ${CINEMATIC_TERRAIN_ALPHA_ATTRIBUTE};`);
    expect(patched.fragmentShader).toContain('diffuseColor.a *= clamp(vCinematicTerrainAlpha');
  });
});

describe('cinematic terrain material lifecycle', () => {
  it('clones configuration, shares maps, and disposes only the owned clone', () => {
    const map = new THREE.Texture();
    const roughnessMap = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const base = new THREE.MeshStandardMaterial({
      name: 'procedural-terrain',
      map,
      roughnessMap,
      normalMap,
      vertexColors: true,
      roughness: 0.91,
    });
    const baseDispose = vi.fn();
    const mapDispose = vi.fn();
    const cloneDispose = vi.fn();
    base.addEventListener('dispose', baseDispose);
    map.addEventListener('dispose', mapDispose);

    const handle = createCinematicTerrainMaterial(base, { alphaTest: 0.04 });
    handle.material.addEventListener('dispose', cloneDispose);

    expect(handle.material).not.toBe(base);
    expect(handle.material.map).toBe(map);
    expect(handle.material.roughnessMap).toBe(roughnessMap);
    expect(handle.material.normalMap).toBe(normalMap);
    expect(handle.material.vertexColors).toBe(true);
    expect(handle.material.roughness).toBe(0.91);
    expect(handle.material.transparent).toBe(true);
    expect(handle.material.alphaTest).toBe(0.04);
    expect(handle.material.depthTest).toBe(true);
    expect(handle.material.depthWrite).toBe(false);
    expect(handle.attributeName).toBe(CINEMATIC_TERRAIN_ALPHA_ATTRIBUTE);
    expect(handle.distanceAttributeName).toBe(CINEMATIC_TERRAIN_DISTANCE_ATTRIBUTE);
    expect(handle.material.customProgramCacheKey()).toContain(CINEMATIC_TERRAIN_ALPHA_ATTRIBUTE);

    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as Parameters<typeof handle.material.onBeforeCompile>[0];
    handle.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const focusUniform = shader.uniforms.cinematicTerrainFocusDistance as { value: number };
    expect(focusUniform.value).toBe(0);
    handle.setFocusDistance(401.5);
    expect(focusUniform.value).toBe(401.5);

    handle.dispose();
    handle.dispose();

    expect(handle.disposed).toBe(true);
    expect(cloneDispose).toHaveBeenCalledTimes(1);
    expect(baseDispose).not.toHaveBeenCalled();
    expect(mapDispose).not.toHaveBeenCalled();
  });
});

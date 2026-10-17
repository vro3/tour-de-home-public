import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { patchScenicWaterShaderSources } from '../src/scenic/scenicWaterShader';

describe('scenic water shader patch', () => {
  it('interpolates raw cross-width UV and feathers alpha per fragment', () => {
    const patched = patchScenicWaterShaderSources({
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }, true);

    expect(patched.vertexShader).toContain('vScenicWaterAcross = clamp(uv.x, 0.0, 1.0);');
    expect(patched.vertexShader).not.toContain('scenicWaterEdgeAlpha');
    expect(patched.fragmentShader).toContain('smoothstep(0.0, 0.16, vScenicWaterAcross)');
    expect(patched.fragmentShader).toContain('diffuseColor.a *= scenicWaterEdgeAlpha;');
  });

  it('keeps engineered canal edges opaque while retaining a stable shader shape', () => {
    const patched = patchScenicWaterShaderSources({
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }, false);

    expect(patched.vertexShader).toContain('vScenicWaterAcross');
    expect(patched.fragmentShader).not.toContain('diffuseColor.a *= scenicWaterEdgeAlpha;');
    expect(patched.fragmentShader).toContain('#include <opaque_fragment>');
  });

  it('fails loudly if a future Three shader removes a required include', () => {
    expect(() => patchScenicWaterShaderSources({
      vertexShader: 'void main() {}',
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }, true)).toThrow(/missing #include <common>/);
  });
});

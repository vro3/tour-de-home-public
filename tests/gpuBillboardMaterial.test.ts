import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  GPU_BILLBOARD_MIRROR_ATTRIBUTE,
  GPU_BILLBOARD_ORIENTATION_ATTRIBUTE,
  GPU_BILLBOARD_SCALE_ATTRIBUTE,
  GPU_BILLBOARD_WIND_ATTRIBUTE,
  configureGpuBillboardInstances,
  createGpuBillboardMaterial,
  interpolateGpuBillboardYaw,
  patchGpuBillboardShaderSources,
  setGpuBillboardInstanceAttributes,
  type GpuBillboardInstance,
} from '../src/scenic/gpuBillboardMaterial';

const SAMPLE_INSTANCES: readonly GpuBillboardInstance[] = [
  {
    position: new THREE.Vector3(4, 2, -7),
    scale: new THREE.Vector3(-3, 8, 3),
    baseYaw: 2.9,
    facingStrength: 0.25,
    yawOffset: 0.12,
    lean: -0.03,
    windPhase: 1.7,
    windSpeed: 0.48,
    windAmplitude: 0.018,
  },
  {
    position: new THREE.Vector3(-9, 3, 11),
    scale: new THREE.Vector2(2.5, 5),
    mirrorX: true,
    yawOffset: -0.08,
  },
];

describe('GPU billboard shader patch', () => {
  it('adds camera-facing and wind transforms while leaving the fragment shader untouched', () => {
    const sources = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    };
    const patched = patchGpuBillboardShaderSources(sources);

    expect(patched.vertexShader).toContain(`attribute vec2 ${GPU_BILLBOARD_SCALE_ATTRIBUTE};`);
    expect(patched.vertexShader).toContain(`attribute vec4 ${GPU_BILLBOARD_ORIENTATION_ATTRIBUTE};`);
    expect(patched.vertexShader).toContain(`attribute vec3 ${GPU_BILLBOARD_WIND_ATTRIBUTE};`);
    expect(patched.vertexShader).toContain(`attribute float ${GPU_BILLBOARD_MIRROR_ATTRIBUTE};`);
    expect(patched.vertexShader).toContain('vec3 gpuBillboardCenter = instanceMatrix[3].xyz;');
    expect(patched.vertexShader).toContain('gpuBillboardShortestYawDelta = atan(gpuBillboardDirectionCross, gpuBillboardDirectionDot);');
    expect(patched.vertexShader).toContain('gpuBillboardShortestYawDelta * clamp(gpuBillboardOrientation.w, 0.0, 1.0)');
    expect(patched.vertexShader).toContain('transformed = gpuBillboardRight * gpuBillboardLeant.x');
    expect(patched.vertexShader).toContain('#include <project_vertex>');
    expect(patched.fragmentShader).toBe(sources.fragmentShader);
  });

  it('is idempotent but rejects partial or incompatible shader sources', () => {
    const sources = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    };
    const once = patchGpuBillboardShaderSources(sources);
    expect(patchGpuBillboardShaderSources(once)).toBe(once);

    expect(() => patchGpuBillboardShaderSources({
      ...once,
      vertexShader: once.vertexShader.replace(
        'transformed = gpuBillboardRight * gpuBillboardLeant.x',
        'transformed = gpuBillboardLeant.x * gpuBillboardRight',
      ),
    })).toThrow(/partial patch/);
    expect(() => patchGpuBillboardShaderSources({
      vertexShader: '#include <common>\nvoid main() {}',
      fragmentShader: '',
    })).toThrow(/missing <begin_vertex>/);
  });

  it('interpolates through the shortest yaw arc across the -PI/PI seam', () => {
    const degrees = THREE.MathUtils.degToRad;
    const baseYaw = degrees(179);
    const cameraYaw = degrees(-179);
    const halfway = interpolateGpuBillboardYaw(baseYaw, cameraYaw, 0.5);
    const fullyFacing = interpolateGpuBillboardYaw(baseYaw, cameraYaw, 1);

    // Direct numeric lerp would point forward at 0 degrees. Shortest-arc
    // interpolation correctly passes through 180 degrees instead.
    expect(Math.sin(halfway)).toBeCloseTo(0, 10);
    expect(Math.cos(halfway)).toBeCloseTo(-1, 10);
    expect(Math.sin(fullyFacing)).toBeCloseTo(Math.sin(cameraYaw), 10);
    expect(Math.cos(fullyFacing)).toBeCloseTo(Math.cos(cameraYaw), 10);
    expect(interpolateGpuBillboardYaw(baseYaw, cameraYaw, 0, 0.2)).toBeCloseTo(baseYaw + 0.2);
  });
});

describe('GPU billboard instance configuration', () => {
  it('uploads positive static scales, explicit mirror signs, orientation, and wind channels', () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const attributes = setGpuBillboardInstanceAttributes(geometry, SAMPLE_INSTANCES);

    expect(attributes.scale.usage).toBe(THREE.StaticDrawUsage);
    expect(attributes.scale.itemSize).toBe(2);
    expect(attributes.orientation.itemSize).toBe(4);
    expect(Array.from(attributes.scale.array)).toEqual([3, 8, 2.5, 5]);
    expect(Array.from(attributes.orientation.array)).toEqual([
      expect.closeTo(2.9),
      expect.closeTo(0.12),
      expect.closeTo(-0.03),
      expect.closeTo(0.25),
      0,
      expect.closeTo(-0.08),
      0,
      1,
    ]);
    expect(Array.from(attributes.wind.array)).toEqual([
      expect.closeTo(1.7),
      expect.closeTo(0.48),
      expect.closeTo(0.018),
      0,
      expect.closeTo(0.6),
      0,
    ]);
    expect(Array.from(attributes.mirror.array)).toEqual([-1, -1]);
    expect(geometry.getAttribute(GPU_BILLBOARD_SCALE_ATTRIBUTE)).toBe(attributes.scale);
    expect(geometry.getAttribute(GPU_BILLBOARD_ORIENTATION_ATTRIBUTE)).toBe(attributes.orientation);
    expect(geometry.getAttribute(GPU_BILLBOARD_WIND_ATTRIBUTE)).toBe(attributes.wind);
    expect(geometry.getAttribute(GPU_BILLBOARD_MIRROR_ATTRIBUTE)).toBe(attributes.mirror);
  });

  it('writes translation-only matrices once and installs conservative rotation-safe bounds', () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, SAMPLE_INSTANCES.length);
    const result = configureGpuBillboardInstances(mesh, SAMPLE_INSTANCES);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    mesh.getMatrixAt(0, matrix);
    matrix.decompose(position, quaternion, scale);
    expect(position.toArray()).toEqual([4, 2, -7]);
    expect(quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(scale.toArray()).toEqual([1, 1, 1]);
    expect(mesh.instanceMatrix.usage).toBe(THREE.StaticDrawUsage);
    expect(mesh.count).toBe(2);
    expect(mesh.boundingBox).toBe(result.boundingBox);
    expect(mesh.boundingSphere).toBe(result.boundingSphere);

    const firstRadius = Math.hypot(3, 8) * 0.5;
    expect(result.boundingBox.containsPoint(new THREE.Vector3(4 + firstRadius, 2, -7))).toBe(true);
    expect(result.boundingSphere.containsPoint(new THREE.Vector3(4 + firstRadius, 2, -7))).toBe(true);
  });

  it('reuses mesh-capacity attributes as streamed instance counts grow and shrink', () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 4);
    const dispose = vi.fn();
    geometry.addEventListener('dispose', dispose);

    const first = configureGpuBillboardInstances(mesh, SAMPLE_INSTANCES.slice(0, 1));
    const firstScaleVersion = first.scale.version;
    expect(first.scale.count).toBe(4);
    expect(first.orientation.count).toBe(4);
    expect(mesh.count).toBe(1);

    const expandedInstances: readonly GpuBillboardInstance[] = [
      ...SAMPLE_INSTANCES,
      {
        position: { x: 17, y: 1, z: 6 },
        scale: { x: 1.5, y: 4 },
        baseYaw: -1.2,
        facingStrength: 0,
      },
    ];
    const expanded = configureGpuBillboardInstances(mesh, expandedInstances);
    expect(expanded.scale).toBe(first.scale);
    expect(expanded.orientation).toBe(first.orientation);
    expect(expanded.wind).toBe(first.wind);
    expect(expanded.mirror).toBe(first.mirror);
    expect(expanded.scale.version).toBe(firstScaleVersion + 1);
    expect(mesh.count).toBe(3);
    expect(dispose).not.toHaveBeenCalled();

    const shrunk = configureGpuBillboardInstances(mesh, SAMPLE_INSTANCES.slice(1));
    expect(shrunk.scale).toBe(first.scale);
    expect(shrunk.orientation).toBe(first.orientation);
    expect(mesh.count).toBe(1);
    // Unused capacity is cleared rather than retaining stale streamed data.
    expect(Array.from(shrunk.scale.array)).toEqual([2.5, 5, 0, 0, 0, 0, 0, 0]);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('disposes geometry GPU backing before replacing undersized attributes', () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const first = setGpuBillboardInstanceAttributes(geometry, SAMPLE_INSTANCES.slice(0, 1));
    let scalePresentDuringDispose: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    const dispose = vi.fn(() => {
      scalePresentDuringDispose = geometry.getAttribute(GPU_BILLBOARD_SCALE_ATTRIBUTE);
    });
    geometry.addEventListener('dispose', dispose);

    const replacement = setGpuBillboardInstanceAttributes(geometry, SAMPLE_INSTANCES);
    expect(dispose).toHaveBeenCalledTimes(1);
    // The old attribute must still be attached when the event fires so Three's
    // renderer listener can remove its corresponding WebGL buffer.
    expect(scalePresentDuringDispose).toBe(first.scale);
    expect(replacement.scale).not.toBe(first.scale);
    expect(replacement.orientation).not.toBe(first.orientation);
    expect(replacement.wind).not.toBe(first.wind);
    expect(replacement.mirror).not.toBe(first.mirror);
    expect(replacement.scale.count).toBe(2);
    expect(geometry.getAttribute(GPU_BILLBOARD_SCALE_ATTRIBUTE)).toBe(replacement.scale);
  });

  it('rejects poisoned positions and mesh capacity overruns', () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    expect(() => setGpuBillboardInstanceAttributes(geometry, [{
      position: { x: Number.NaN, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
    }])).toThrow(/finite XYZ position/);

    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 1);
    expect(() => configureGpuBillboardInstances(mesh, SAMPLE_INSTANCES)).toThrow(/exceeds mesh capacity/);
    expect(() => setGpuBillboardInstanceAttributes(
      geometry,
      SAMPLE_INSTANCES,
      1,
    )).toThrow(/capacity/);
  });
});

describe('GPU billboard material lifecycle', () => {
  it('preserves the basic material pipeline and owns only its clone', () => {
    const map = new THREE.Texture();
    const base = new THREE.MeshBasicMaterial({
      name: 'foliage',
      map,
      transparent: true,
      alphaTest: 0.12,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: true,
      toneMapped: true,
    });
    const baseCompile = vi.fn((shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.fragmentShader += '\n// preserved-base-material-hook';
    });
    base.onBeforeCompile = baseCompile;
    const baseDispose = vi.fn();
    const mapDispose = vi.fn();
    const cloneDispose = vi.fn();
    base.addEventListener('dispose', baseDispose);
    map.addEventListener('dispose', mapDispose);

    const handle = createGpuBillboardMaterial(base);
    handle.material.addEventListener('dispose', cloneDispose);

    expect(handle.material).not.toBe(base);
    expect(handle.material.map).toBe(map);
    expect(handle.material.transparent).toBe(true);
    expect(handle.material.alphaTest).toBe(0.12);
    expect(handle.material.alphaToCoverage).toBe(true);
    expect(handle.material.side).toBe(THREE.DoubleSide);
    expect(handle.material.depthWrite).toBe(true);
    expect(handle.material.fog).toBe(true);
    expect(handle.material.toneMapped).toBe(true);
    expect(handle.material.forceSinglePass).toBe(true);
    expect(handle.material.customProgramCacheKey()).toContain('gpu-billboard-v1');
    expect(handle.material.customProgramCacheKey()).toBe(handle.material.customProgramCacheKey());

    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as Parameters<typeof handle.material.onBeforeCompile>[0];
    handle.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(baseCompile).toHaveBeenCalledTimes(1);
    expect(shader.vertexShader).toContain('gpuBillboardCameraPositionObject');
    expect(shader.fragmentShader).toBe(`${THREE.ShaderLib.basic.fragmentShader}\n// preserved-base-material-hook`);

    handle.setFrame({ x: 7, y: 4, z: -3 }, 12.5);
    expect((shader.uniforms.gpuBillboardCameraPositionObject as { value: THREE.Vector3 }).value.toArray())
      .toEqual([7, 4, -3]);
    expect((shader.uniforms.gpuBillboardTime as { value: number }).value).toBe(12.5);
    handle.setWindStrength(0.35);
    expect((shader.uniforms.gpuBillboardWindStrength as { value: number }).value).toBe(0.35);

    handle.dispose();
    handle.dispose();
    expect(handle.disposed).toBe(true);
    expect(cloneDispose).toHaveBeenCalledTimes(1);
    expect(baseDispose).not.toHaveBeenCalled();
    expect(mapDispose).not.toHaveBeenCalled();
  });

  it('converts camera world coordinates into the billboard root local space', () => {
    const handle = createGpuBillboardMaterial(new THREE.MeshBasicMaterial());
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as Parameters<typeof handle.material.onBeforeCompile>[0];
    handle.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    const root = new THREE.Object3D();
    root.position.set(10, 2, -5);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(13, 8, 4);
    camera.updateMatrixWorld(true);
    handle.updateFrame(camera, root, 2.25);

    expect((shader.uniforms.gpuBillboardCameraPositionObject as { value: THREE.Vector3 }).value.toArray())
      .toEqual([3, 6, 9]);
    expect((shader.uniforms.gpuBillboardTime as { value: number }).value).toBe(2.25);
    handle.dispose();
  });
});

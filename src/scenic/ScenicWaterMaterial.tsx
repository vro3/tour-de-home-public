import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ScenicWaterway } from './worldProfiles';
import { patchScenicWaterShaderSources } from './scenicWaterShader';

function createWaterNormalTexture(seed: number): THREE.DataTexture {
  const size = 64;
  const heights = new Float32Array(size * size);
  const data = new Uint8Array(size * size * 4);
  const phase = (seed % 997) * 0.031;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      heights[y * size + x] = (
        Math.sin(x * 0.31 + y * 0.17 + phase) * 0.5
        + Math.sin(x * 0.11 - y * 0.37 + phase * 1.7) * 0.3
        + Math.cos(x * 0.49 + y * 0.08 - phase * 0.4) * 0.2
      );
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heights[y * size + ((x + size - 1) % size)];
      const right = heights[y * size + ((x + 1) % size)];
      const down = heights[((y + size - 1) % size) * size + x];
      const up = heights[((y + 1) % size) * size + x];
      const normal = new THREE.Vector3((left - right) * 0.52, (down - up) * 0.52, 1).normalize();
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'scenic-water-normal';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.repeat.set(2.4, 18);
  texture.needsUpdate = true;
  return texture;
}

interface ScenicWaterMaterialProps {
  color: string;
  kind: ScenicWaterway;
  opacity: number;
  seed: number;
  reducedMotion: boolean;
  waterfall?: boolean;
}

export function ScenicWaterMaterial({
  color,
  kind,
  opacity,
  seed,
  reducedMotion,
  waterfall = false,
}: ScenicWaterMaterialProps) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const normalMap = useMemo(() => createWaterNormalTexture(seed ^ (waterfall ? 0x7A11 : 0x51EA)), [seed, waterfall]);
  const normalScale = useMemo(
    () => new THREE.Vector2(waterfall ? 0.38 : kind === 'ice' ? 0.13 : 0.24, waterfall ? 0.72 : 0.24),
    [kind, waterfall],
  );
  const patchEdgeFeather = useCallback((shader: THREE.WebGLProgramParametersWithUniforms) => {
    const patched = patchScenicWaterShaderSources(shader, kind !== 'canal');
    shader.vertexShader = patched.vertexShader;
    shader.fragmentShader = patched.fragmentShader;
  }, [kind]);

  useEffect(() => () => normalMap.dispose(), [normalMap]);

  useFrame((state) => {
    if (reducedMotion) return;
    const time = state.clock.elapsedTime;
    normalMap.offset.x = (time * (waterfall ? 0.018 : 0.007)) % 1;
    normalMap.offset.y = (time * (waterfall ? -0.16 : -0.035)) % 1;
  });

  const ice = kind === 'ice';
  const runoff = kind === 'runoff';
  return (
    <meshStandardMaterial
      key={`scenic-water:${kind}:${waterfall ? 'waterfall' : 'surface'}`}
      ref={materialRef}
      color={waterfall && !runoff ? '#d8f5f7' : color}
      roughness={ice ? 0.13 : runoff ? 0.48 : waterfall ? 0.17 : 0.24}
      metalness={ice ? 0.28 : runoff ? 0.02 : 0.08}
      normalMap={normalMap}
      normalScale={normalScale}
      transparent
      opacity={waterfall ? Math.min(0.84, opacity + 0.1) : opacity}
      depthWrite={false}
      emissive={color}
      emissiveIntensity={ice ? 0.18 : waterfall ? 0.08 : 0.012}
      envMapIntensity={ice ? 1.25 : waterfall ? 1.1 : 0.9}
      side={THREE.DoubleSide}
      forceSinglePass
      onBeforeCompile={patchEdgeFeather}
      customProgramCacheKey={() => `scenic-water-edge-v1:${kind}`}
    />
  );
}

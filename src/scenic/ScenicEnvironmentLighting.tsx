import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface ScenicEnvironmentLightingProps {
  source?: string;
  enabled: boolean;
  intensity: number;
  yawDegrees?: number;
}

/**
 * Uses the low-resolution equirectangular plate as lighting only. The authored
 * 16:9 matte remains the visible background, while PBR road, terrain, water,
 * and structures receive coherent reflections and ambient color.
 */
export function ScenicEnvironmentLighting({
  source,
  enabled,
  intensity,
  yawDegrees = 0,
}: ScenicEnvironmentLightingProps) {
  const { camera, gl, invalidate, scene } = useThree();

  useEffect(() => {
    if (!enabled || !source) {
      scene.environment = null;
      scene.environmentIntensity = 1;
      return;
    }

    let cancelled = false;
    let sourceTexture: THREE.Texture | null = null;
    let environmentTarget: THREE.WebGLRenderTarget | null = null;
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();

    void new THREE.TextureLoader().loadAsync(source).then((loaded) => {
      sourceTexture = loaded;
      if (cancelled) {
        loaded.dispose();
        return;
      }
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.mapping = THREE.EquirectangularReflectionMapping;
      environmentTarget = pmrem.fromEquirectangular(loaded);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = intensity;
      scene.environmentRotation.set(0, THREE.MathUtils.degToRad(yawDegrees), 0);
      loaded.dispose();
      sourceTexture = null;
      pmrem.dispose();
      invalidate();

      // Compile the newly introduced environment-lighting variants while the
      // scene is already visible instead of waiting for the next theme switch.
      void gl.compileAsync(scene, camera).catch(() => undefined);
    }).catch(() => {
      pmrem.dispose();
    });

    return () => {
      cancelled = true;
      sourceTexture?.dispose();
      if (environmentTarget) {
        if (scene.environment === environmentTarget.texture) scene.environment = null;
        environmentTarget.dispose();
      }
      pmrem.dispose();
    };
  }, [camera, enabled, gl, intensity, invalidate, scene, source, yawDegrees]);

  return null;
}

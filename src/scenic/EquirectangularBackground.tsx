import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface PanoramaGradient {
  top: string;
  horizon: string;
  bottom: string;
}

export type PanoramaLoadStatus = 'fallback' | 'loading' | 'ready';

export interface EquirectangularBackgroundProps {
  source?: string;
  fallbackSource?: string;
  fallback: PanoramaGradient;
  yawRadians?: number;
  intensity?: number;
  maxCubeFaceSize?: number;
  onStatusChange?: (status: PanoramaLoadStatus, error?: Error) => void;
}

export interface PanoramaDimensions {
  width: number;
  height: number;
}

export interface PanoramaCapabilities {
  maxTextureSize: number;
  maxCubemapSize: number;
}

const FALLBACK_WIDTH = 64;
const FALLBACK_HEIGHT = 32;
const DEFAULT_MAX_CUBE_FACE_SIZE = 1_024;

export function isTwoToOnePanorama({ width, height }: PanoramaDimensions): boolean {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && height > 0
    && width === height * 2;
}

export function getPanoramaCubeFaceLimit(
  capabilities: PanoramaCapabilities,
  requestedLimit = DEFAULT_MAX_CUBE_FACE_SIZE,
): number {
  return Math.max(1, Math.min(
    requestedLimit,
    capabilities.maxCubemapSize,
    Math.floor(capabilities.maxTextureSize / 2),
  ));
}

/**
 * Estimates the active GPU allocation for Three's WebGL equirectangular background path.
 * It includes the uploaded 2D source and the generated six-face cubemap, without mipmaps.
 */
export function estimatePanoramaGpuBytes(height: number, bytesPerPixel = 4): number {
  const safeHeight = Math.max(0, Math.floor(height));
  const sourcePixels = safeHeight * 2 * safeHeight;
  const cubemapPixels = safeHeight * safeHeight * 6;
  return (sourcePixels + cubemapPixels) * bytesPerPixel;
}

/** Aligns the panorama's center (+X in Three's equirectangular convention) to a route tangent. */
export function panoramaYawForTangent(tangent: Pick<THREE.Vector3, 'x' | 'z'>): number {
  return Math.atan2(-tangent.z, tangent.x);
}

export function configureEquirectangularTexture(texture: THREE.Texture): THREE.Texture {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createFallbackTexture(gradient: PanoramaGradient): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = FALLBACK_WIDTH;
  canvas.height = FALLBACK_HEIGHT;
  const context = canvas.getContext('2d');

  if (context) {
    const fill = context.createLinearGradient(0, 0, 0, canvas.height);
    fill.addColorStop(0, gradient.top);
    fill.addColorStop(0.58, gradient.horizon);
    fill.addColorStop(1, gradient.bottom);
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'scenic-panorama-fallback';
  return configureEquirectangularTexture(texture) as THREE.CanvasTexture;
}

async function fetchPanoramaBitmap(source: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(source, {
    cache: 'force-cache',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Could not load scenic panorama (${response.status} ${response.statusText}).`);
  }

  const blob = await response.blob();
  return createImageBitmap(blob, {
    colorSpaceConversion: 'default',
    imageOrientation: 'flipY',
    premultiplyAlpha: 'none',
  });
}

async function loadValidPanorama(
  sources: string[],
  faceLimit: number,
  signal: AbortSignal,
): Promise<{ bitmap: ImageBitmap; source: string }> {
  let lastError: Error | undefined;

  for (const source of sources) {
    try {
      const bitmap = await fetchPanoramaBitmap(source, signal);
      if (!isTwoToOnePanorama(bitmap)) {
        const error = new Error(`Scenic panorama must be exactly 2:1; received ${bitmap.width}x${bitmap.height}.`);
        closeBitmap(bitmap);
        throw error;
      }
      if (bitmap.height > faceLimit) {
        const error = new Error(`Scenic panorama is too large for this quality tier; maximum is ${faceLimit * 2}x${faceLimit}.`);
        closeBitmap(bitmap);
        throw error;
      }
      return { bitmap, source };
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error('Could not decode scenic panorama.');
    }
  }

  throw lastError ?? new Error('No scenic panorama source was provided.');
}

function createPanoramaTexture(bitmap: ImageBitmap, source: string): THREE.Texture {
  const texture = new THREE.Texture(bitmap);
  texture.name = `scenic-panorama:${source}`;
  // ImageBitmap pixels were flipped during decode; WebGL must not flip them again.
  texture.flipY = false;
  return configureEquirectangularTexture(texture);
}

function closeBitmap(bitmap: ImageBitmap | undefined) {
  bitmap?.close();
}

/**
 * Installs a lazily decoded, true 2:1 panorama as a world-oriented scene background.
 * A lightweight equirectangular gradient remains visible during loading and on failure.
 */
export function EquirectangularBackground({
  source,
  fallbackSource,
  fallback,
  yawRadians = 0,
  intensity = 1,
  maxCubeFaceSize = DEFAULT_MAX_CUBE_FACE_SIZE,
  onStatusChange,
}: EquirectangularBackgroundProps) {
  const { gl, scene } = useThree();
  const statusCallbackRef = useRef(onStatusChange);
  statusCallbackRef.current = onStatusChange;

  useEffect(() => {
    const fallbackTexture = createFallbackTexture(fallback);
    const previousBackground = scene.background;
    const previousRotation = scene.backgroundRotation.clone();
    const previousIntensity = scene.backgroundIntensity;
    const previousBlurriness = scene.backgroundBlurriness;
    const controller = new AbortController();
    let panoramaTexture: THREE.Texture | undefined;
    let panoramaBitmap: ImageBitmap | undefined;
    let ownsBackground = true;

    scene.background = fallbackTexture;
    scene.backgroundRotation.set(0, yawRadians, 0);
    scene.backgroundIntensity = intensity;
    // Non-zero blur makes Three build a PMREM in addition to the cubemap.
    scene.backgroundBlurriness = 0;

    const sources = [source, fallbackSource]
      .filter((candidate): candidate is string => Boolean(candidate))
      .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index);

    if (sources.length === 0) {
      statusCallbackRef.current?.('fallback');
    } else if (typeof createImageBitmap !== 'function') {
      statusCallbackRef.current?.('fallback', new Error('This browser cannot decode panorama images.'));
    } else {
      statusCallbackRef.current?.('loading');
      const faceLimit = getPanoramaCubeFaceLimit(gl.capabilities, maxCubeFaceSize);

      void loadValidPanorama(sources, faceLimit, controller.signal)
        .then(({ bitmap, source: loadedSource }) => {
          if (controller.signal.aborted) {
            closeBitmap(bitmap);
            return;
          }

          panoramaBitmap = bitmap;
          panoramaTexture = createPanoramaTexture(bitmap, loadedSource);
          scene.background = panoramaTexture;
          statusCallbackRef.current?.('ready');
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          statusCallbackRef.current?.(
            'fallback',
            error instanceof Error ? error : new Error('Could not decode scenic panorama.'),
          );
        });
    }

    return () => {
      controller.abort();
      ownsBackground = scene.background === fallbackTexture || scene.background === panoramaTexture;
      if (ownsBackground) {
        scene.background = previousBackground;
        scene.backgroundRotation.copy(previousRotation);
        scene.backgroundIntensity = previousIntensity;
        scene.backgroundBlurriness = previousBlurriness;
      }
      panoramaTexture?.dispose();
      closeBitmap(panoramaBitmap);
      fallbackTexture.dispose();
    };
  }, [
    fallback.bottom,
    fallback.horizon,
    fallback.top,
    gl.capabilities,
    intensity,
    maxCubeFaceSize,
    scene,
    fallbackSource,
    source,
    yawRadians,
  ]);

  return null;
}

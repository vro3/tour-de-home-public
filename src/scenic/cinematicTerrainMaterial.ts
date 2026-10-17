import * as THREE from 'three';

/**
 * Geometry attribute consumed by the cinematic terrain shader by default.
 * Each value is multiplied into the material's existing opacity/map alpha.
 */
export const CINEMATIC_TERRAIN_ALPHA_ATTRIBUTE = 'cinematicTerrainAlpha';
export const CINEMATIC_TERRAIN_DISTANCE_ATTRIBUTE = 'cinematicTerrainDistance';

const CINEMATIC_TERRAIN_VARYING = 'vCinematicTerrainAlpha';
const CINEMATIC_TERRAIN_FOCUS_UNIFORM = 'cinematicTerrainFocusDistance';
const CINEMATIC_TERRAIN_FADE_UNIFORM = 'cinematicTerrainDistanceFade';
const SHADER_PATCH_VERSION = 'cinematic-terrain-alpha-v2';
const DEFAULT_ALPHA_TEST = 0.02;

export interface CinematicTerrainMaterialOptions {
  /** The scalar BufferGeometry attribute carrying one alpha value per vertex. */
  attributeName?: string;
  /** Absolute route-distance attribute, in real meters. */
  distanceAttributeName?: string;
  /** Initial rider route distance, in real meters. */
  focusDistanceMeters?: number;
  /** Fully opaque distance and fully transparent distance from the rider. */
  distanceFadeMeters?: readonly [opaqueThroughMeters: number, transparentAtMeters: number];
  /** Fragments below this final alpha are discarded. Defaults to 0.02. */
  alphaTest?: number;
  /** Defaults to false so feathered fragments do not occlude the backdrop. */
  depthWrite?: boolean;
  /** Defaults to true. */
  depthTest?: boolean;
  /** Optional name for renderer diagnostics. */
  name?: string;
}

export interface CinematicTerrainMaterialHandle {
  readonly material: THREE.MeshStandardMaterial;
  readonly attributeName: string;
  readonly distanceAttributeName: string;
  readonly disposed: boolean;
  setFocusDistance: (distanceMeters: number) => void;
  /** Disposes only the cloned material; the base material and its textures remain shared. */
  dispose: () => void;
}

export interface CinematicTerrainShaderSources {
  vertexShader: string;
  fragmentShader: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function validateFalloff(opaqueThrough: number, transparentAt: number): void {
  if (!Number.isFinite(opaqueThrough) || !Number.isFinite(transparentAt)) {
    throw new TypeError('Terrain fade distances must be finite numbers.');
  }
  if (opaqueThrough < 0 || transparentAt <= opaqueThrough) {
    throw new RangeError('Terrain fade requires 0 <= opaqueThrough < transparentAt.');
  }
}

function smoothFalloff(distance: number, opaqueThrough: number, transparentAt: number): number {
  validateFalloff(opaqueThrough, transparentAt);
  if (!Number.isFinite(distance)) return 0;
  const progress = clamp01((Math.abs(distance) - opaqueThrough) / (transparentAt - opaqueThrough));
  const smoothed = progress * progress * (3 - 2 * progress);
  return 1 - smoothed;
}

/**
 * Smoothly fades terrain based on absolute distance from a focus point (normally
 * the rider). It returns 1 inside `opaqueThrough` and 0 at/after `transparentAt`.
 */
export function distanceFadeAlpha(
  distanceFromFocusMeters: number,
  opaqueThroughMeters: number,
  transparentAtMeters: number,
): number {
  return smoothFalloff(distanceFromFocusMeters, opaqueThroughMeters, transparentAtMeters);
}

/**
 * Smoothly fades terrain at both lateral edges. Signed offsets are accepted;
 * `opaqueHalfWidth` and `transparentHalfWidth` are distances from the centerline.
 */
export function lateralFadeAlpha(
  lateralOffset: number,
  opaqueHalfWidth: number,
  transparentHalfWidth: number,
): number {
  return smoothFalloff(lateralOffset, opaqueHalfWidth, transparentHalfWidth);
}

/** Combines independent distance and lateral feathering into one vertex weight. */
export function cinematicTerrainAlphaWeight(
  distanceFromFocusMeters: number,
  lateralOffset: number,
  distanceFade: readonly [opaqueThroughMeters: number, transparentAtMeters: number],
  lateralFade: readonly [opaqueHalfWidth: number, transparentHalfWidth: number],
): number {
  return distanceFadeAlpha(distanceFromFocusMeters, distanceFade[0], distanceFade[1])
    * lateralFadeAlpha(lateralOffset, lateralFade[0], lateralFade[1]);
}

function validateAttributeName(attributeName: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(attributeName) || attributeName.startsWith('gl_')) {
    throw new Error(`Invalid GLSL terrain alpha attribute name: "${attributeName}".`);
  }
}

function includePattern(name: string): RegExp {
  return new RegExp(`(^[\\t ]*#include[\\t ]+<${name}>[\\t ]*$)`, 'm');
}

function injectAfterInclude(source: string, include: string, addition: string, stage: string): string {
  const pattern = includePattern(include);
  if (!pattern.test(source)) {
    throw new Error(`Cannot patch cinematic terrain ${stage} shader: missing <${include}> include.`);
  }
  return source.replace(pattern, (_match, marker: string) => `${marker}\n${addition}`);
}

function injectBeforeInclude(source: string, include: string, addition: string, stage: string): string {
  const pattern = includePattern(include);
  if (!pattern.test(source)) {
    throw new Error(`Cannot patch cinematic terrain ${stage} shader: missing <${include}> include.`);
  }
  return source.replace(pattern, (_match, marker: string) => `${addition}\n${marker}`);
}

/**
 * Applies the source transformation used by `createCinematicTerrainMaterial`.
 * Kept public and side-effect-free so shader compatibility can be tested without
 * creating a WebGL renderer.
 */
export function patchCinematicTerrainShaderSources(
  sources: CinematicTerrainShaderSources,
  attributeName = CINEMATIC_TERRAIN_ALPHA_ATTRIBUTE,
  distanceAttributeName = CINEMATIC_TERRAIN_DISTANCE_ATTRIBUTE,
): CinematicTerrainShaderSources {
  validateAttributeName(attributeName);
  validateAttributeName(distanceAttributeName);

  const declarationSentinel = `attribute float ${attributeName};`;
  const distanceDeclarationSentinel = `attribute float ${distanceAttributeName};`;
  const fragmentSentinel = `varying float ${CINEMATIC_TERRAIN_VARYING};`;
  const assignmentSentinel = [
    `float cinematicTerrainFadeProgress = clamp((abs(${distanceAttributeName} - ${CINEMATIC_TERRAIN_FOCUS_UNIFORM}) - ${CINEMATIC_TERRAIN_FADE_UNIFORM}.x) / max(0.0001, ${CINEMATIC_TERRAIN_FADE_UNIFORM}.y - ${CINEMATIC_TERRAIN_FADE_UNIFORM}.x), 0.0, 1.0);`,
    'float cinematicTerrainDistanceAlpha = 1.0 - cinematicTerrainFadeProgress * cinematicTerrainFadeProgress * (3.0 - 2.0 * cinematicTerrainFadeProgress);',
    `${CINEMATIC_TERRAIN_VARYING} = clamp(${attributeName}, 0.0, 1.0) * cinematicTerrainDistanceAlpha;`,
  ].join('\n');
  const alphaSentinel = `diffuseColor.a *= clamp(${CINEMATIC_TERRAIN_VARYING}, 0.0, 1.0);`;
  const patchState = [
    sources.vertexShader.includes(declarationSentinel),
    sources.vertexShader.includes(distanceDeclarationSentinel),
    sources.vertexShader.includes(assignmentSentinel),
    sources.fragmentShader.includes(fragmentSentinel),
    sources.fragmentShader.includes(alphaSentinel),
  ];
  if (patchState.every(Boolean)) {
    return sources;
  }
  if (patchState.some(Boolean)) {
    throw new Error('Cannot patch cinematic terrain shader: a partial alpha patch is already present.');
  }

  let vertexShader = injectAfterInclude(
    sources.vertexShader,
    'common',
    [
      declarationSentinel,
      distanceDeclarationSentinel,
      `uniform float ${CINEMATIC_TERRAIN_FOCUS_UNIFORM};`,
      `uniform vec2 ${CINEMATIC_TERRAIN_FADE_UNIFORM};`,
      `varying float ${CINEMATIC_TERRAIN_VARYING};`,
    ].join('\n'),
    'vertex',
  );
  vertexShader = injectAfterInclude(
    vertexShader,
    'begin_vertex',
    assignmentSentinel,
    'vertex',
  );

  let fragmentShader = injectAfterInclude(
    sources.fragmentShader,
    'common',
    fragmentSentinel,
    'fragment',
  );
  fragmentShader = injectBeforeInclude(
    fragmentShader,
    'alphatest_fragment',
    alphaSentinel,
    'fragment',
  );

  return { vertexShader, fragmentShader };
}

/**
 * Adds a one-component alpha attribute after verifying it matches the geometry's
 * vertex count. Inputs are clamped because interpolated alpha is expected in [0, 1].
 */
export function setCinematicTerrainAlphaAttribute(
  geometry: THREE.BufferGeometry,
  weights: Iterable<number> | ArrayLike<number>,
  attributeName = CINEMATIC_TERRAIN_ALPHA_ATTRIBUTE,
): THREE.Float32BufferAttribute {
  validateAttributeName(attributeName);
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Cinematic terrain geometry requires a position attribute.');

  const values = Array.from(weights, (weight) => Number.isFinite(weight) ? clamp01(weight) : 0);
  if (values.length !== position.count) {
    throw new Error(
      `Terrain alpha count (${values.length}) must match the geometry vertex count (${position.count}).`,
    );
  }

  const attribute = new THREE.Float32BufferAttribute(values, 1);
  geometry.setAttribute(attributeName, attribute);
  return attribute;
}

export function setCinematicTerrainDistanceAttribute(
  geometry: THREE.BufferGeometry,
  distances: Iterable<number> | ArrayLike<number>,
  attributeName = CINEMATIC_TERRAIN_DISTANCE_ATTRIBUTE,
): THREE.Float32BufferAttribute {
  validateAttributeName(attributeName);
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Cinematic terrain geometry requires a position attribute.');
  const values = Array.from(distances, (distance) => Number.isFinite(distance) ? distance : 0);
  if (values.length !== position.count) {
    throw new Error(
      `Terrain distance count (${values.length}) must match the geometry vertex count (${position.count}).`,
    );
  }
  const attribute = new THREE.Float32BufferAttribute(values, 1);
  geometry.setAttribute(attributeName, attribute);
  return attribute;
}

/**
 * Clones a standard material and layers per-vertex feathering over its existing
 * opacity and texture alpha. Texture/map references stay shared with `baseMaterial`.
 */
export function createCinematicTerrainMaterial(
  baseMaterial: THREE.MeshStandardMaterial,
  options: CinematicTerrainMaterialOptions = {},
): CinematicTerrainMaterialHandle {
  const attributeName = options.attributeName ?? CINEMATIC_TERRAIN_ALPHA_ATTRIBUTE;
  const distanceAttributeName = options.distanceAttributeName ?? CINEMATIC_TERRAIN_DISTANCE_ATTRIBUTE;
  validateAttributeName(attributeName);
  validateAttributeName(distanceAttributeName);
  const alphaTest = options.alphaTest ?? DEFAULT_ALPHA_TEST;
  if (!Number.isFinite(alphaTest) || alphaTest < 0 || alphaTest > 1) {
    throw new RangeError('Cinematic terrain alphaTest must be between 0 and 1.');
  }
  const distanceFade = options.distanceFadeMeters ?? [330, 760];
  validateFalloff(distanceFade[0], distanceFade[1]);
  const focusUniform = { value: Number.isFinite(options.focusDistanceMeters) ? options.focusDistanceMeters! : 0 };
  const fadeUniform = { value: new THREE.Vector2(distanceFade[0], distanceFade[1]) };

  const material = baseMaterial.clone();
  const baseOnBeforeCompile = baseMaterial.onBeforeCompile;
  const baseProgramCacheKey = baseMaterial.customProgramCacheKey;

  material.name = options.name ?? `${baseMaterial.name || 'terrain'}-cinematic-feather`;
  material.transparent = true;
  material.alphaTest = alphaTest;
  material.depthWrite = options.depthWrite ?? false;
  material.depthTest = options.depthTest ?? true;
  material.onBeforeCompile = (shader, renderer) => {
    baseOnBeforeCompile.call(material, shader, renderer);
    shader.uniforms[CINEMATIC_TERRAIN_FOCUS_UNIFORM] = focusUniform;
    shader.uniforms[CINEMATIC_TERRAIN_FADE_UNIFORM] = fadeUniform;
    const patched = patchCinematicTerrainShaderSources(shader, attributeName, distanceAttributeName);
    shader.vertexShader = patched.vertexShader;
    shader.fragmentShader = patched.fragmentShader;
  };
  material.customProgramCacheKey = () => (
    `${baseProgramCacheKey.call(baseMaterial)}|${SHADER_PATCH_VERSION}|${attributeName}|${distanceAttributeName}`
  );
  material.needsUpdate = true;

  let disposed = false;
  return {
    material,
    attributeName,
    distanceAttributeName,
    get disposed() {
      return disposed;
    },
    setFocusDistance(distanceMeters: number) {
      focusUniform.value = Number.isFinite(distanceMeters) ? distanceMeters : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
    },
  };
}

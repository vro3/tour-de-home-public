import * as THREE from 'three';

/**
 * Instanced attributes consumed by the GPU billboard vertex patch. Geometry
 * using these attributes must be unique to one billboard draw group.
 */
export const GPU_BILLBOARD_SCALE_ATTRIBUTE = 'gpuBillboardScale';
export const GPU_BILLBOARD_ORIENTATION_ATTRIBUTE = 'gpuBillboardOrientation';
export const GPU_BILLBOARD_WIND_ATTRIBUTE = 'gpuBillboardWind';
export const GPU_BILLBOARD_MIRROR_ATTRIBUTE = 'gpuBillboardMirror';

const GPU_BILLBOARD_CAMERA_UNIFORM = 'gpuBillboardCameraPositionObject';
const GPU_BILLBOARD_TIME_UNIFORM = 'gpuBillboardTime';
const GPU_BILLBOARD_WIND_STRENGTH_UNIFORM = 'gpuBillboardWindStrength';
const SHADER_PATCH_VERSION = 'gpu-billboard-v1';

const DEFAULT_WIND_SPEED = 0.6;
const MIN_BOUNDING_RADIUS = 1e-4;

export interface GpuBillboardVector2Like {
  readonly x: number;
  readonly y: number;
}

export interface GpuBillboardVector3Like extends GpuBillboardVector2Like {
  readonly z: number;
}

/**
 * One static billboard instance. Negative X scale is accepted for compatibility
 * with the existing scenery generator, but is converted to a positive width and
 * a separate mirror sign before upload.
 */
export interface GpuBillboardInstance {
  readonly position: GpuBillboardVector3Like;
  readonly scale: GpuBillboardVector2Like;
  readonly mirrorX?: boolean;
  /** Authored/fixed yaw in mesh-local radians. Defaults to 0. */
  readonly baseYaw?: number;
  /** 0 keeps `baseYaw`; 1 fully faces the camera. Defaults to 1. */
  readonly facingStrength?: number;
  /** Applied after authored/camera direction interpolation. */
  readonly yawOffset?: number;
  readonly lean?: number;
  readonly windPhase?: number;
  readonly windSpeed?: number;
  readonly windAmplitude?: number;
}

export interface GpuBillboardInstanceAttributes {
  /** Width and height. Values are always finite and non-negative. */
  readonly scale: THREE.InstancedBufferAttribute;
  /** XYZW are base yaw, yaw offset, lean, and clamped camera-facing strength. */
  readonly orientation: THREE.InstancedBufferAttribute;
  /** X is phase; Y is angular speed; Z is angular amplitude. */
  readonly wind: THREE.InstancedBufferAttribute;
  /** +1 keeps the texture orientation and -1 mirrors it. */
  readonly mirror: THREE.InstancedBufferAttribute;
}

export interface ConfigureGpuBillboardInstancesResult extends GpuBillboardInstanceAttributes {
  readonly boundingBox: THREE.Box3;
  readonly boundingSphere: THREE.Sphere;
}

export interface GpuBillboardShaderSources {
  vertexShader: string;
  fragmentShader: string;
}

export interface GpuBillboardMaterialOptions {
  /** Initial scalar applied to every instance's wind amplitude. Defaults to 1. */
  windStrength?: number;
  /**
   * Flat double-sided cutouts do not need Three.js's transparent back/front
   * double pass. Defaults to true; set false only for genuinely volumetric use.
   */
  forceSinglePass?: boolean;
  /** Optional name for renderer diagnostics. */
  name?: string;
}

export interface GpuBillboardMaterialHandle {
  readonly material: THREE.MeshBasicMaterial;
  readonly disposed: boolean;
  /**
   * Updates the two shared per-frame inputs without touching instance matrices.
   * `cameraPositionObjectSpace` must use the billboard mesh's local coordinates.
   */
  setFrame: (cameraPositionObjectSpace: GpuBillboardVector3Like, elapsedSeconds: number) => void;
  /** Convenience wrapper that converts a camera world position into mesh-local space. */
  updateFrame: (camera: THREE.Camera, billboardRoot: THREE.Object3D, elapsedSeconds: number) => void;
  setWindStrength: (strength: number) => void;
  /** Disposes only the cloned material; the base material and textures remain shared. */
  dispose: () => void;
}

function includePattern(name: string): RegExp {
  return new RegExp(`(^[\\t ]*#include[\\t ]+<${name}>[\\t ]*$)`, 'm');
}

function injectAfterInclude(source: string, include: string, addition: string): string {
  const pattern = includePattern(include);
  if (!pattern.test(source)) {
    throw new Error(`Cannot patch GPU billboard vertex shader: missing <${include}> include.`);
  }
  return source.replace(pattern, (_match, marker: string) => `${marker}\n${addition}`);
}

const GPU_BILLBOARD_DECLARATIONS = [
  '#ifdef USE_INSTANCING',
  `attribute vec2 ${GPU_BILLBOARD_SCALE_ATTRIBUTE};`,
  `attribute vec4 ${GPU_BILLBOARD_ORIENTATION_ATTRIBUTE};`,
  `attribute vec3 ${GPU_BILLBOARD_WIND_ATTRIBUTE};`,
  `attribute float ${GPU_BILLBOARD_MIRROR_ATTRIBUTE};`,
  `uniform vec3 ${GPU_BILLBOARD_CAMERA_UNIFORM};`,
  `uniform float ${GPU_BILLBOARD_TIME_UNIFORM};`,
  `uniform float ${GPU_BILLBOARD_WIND_STRENGTH_UNIFORM};`,
  '#endif',
].join('\n');

const GPU_BILLBOARD_TRANSFORM = [
  '#ifdef USE_INSTANCING',
  'vec3 gpuBillboardCenter = instanceMatrix[3].xyz;',
  `vec2 gpuBillboardToCamera = ${GPU_BILLBOARD_CAMERA_UNIFORM}.xz - gpuBillboardCenter.xz;`,
  `vec2 gpuBillboardAuthoredDirection = vec2(sin(${GPU_BILLBOARD_ORIENTATION_ATTRIBUTE}.x), cos(${GPU_BILLBOARD_ORIENTATION_ATTRIBUTE}.x));`,
  'vec2 gpuBillboardCameraDirection = gpuBillboardAuthoredDirection;',
  'float gpuBillboardCameraDistanceSquared = dot(gpuBillboardToCamera, gpuBillboardToCamera);',
  'if (gpuBillboardCameraDistanceSquared > 0.00000001) {',
  '  gpuBillboardCameraDirection = gpuBillboardToCamera * inversesqrt(gpuBillboardCameraDistanceSquared);',
  '}',
  'float gpuBillboardDirectionCross = gpuBillboardAuthoredDirection.y * gpuBillboardCameraDirection.x - gpuBillboardAuthoredDirection.x * gpuBillboardCameraDirection.y;',
  'float gpuBillboardDirectionDot = clamp(dot(gpuBillboardAuthoredDirection, gpuBillboardCameraDirection), -1.0, 1.0);',
  'float gpuBillboardShortestYawDelta = atan(gpuBillboardDirectionCross, gpuBillboardDirectionDot);',
  `float gpuBillboardYaw = ${GPU_BILLBOARD_ORIENTATION_ATTRIBUTE}.x + gpuBillboardShortestYawDelta * clamp(${GPU_BILLBOARD_ORIENTATION_ATTRIBUTE}.w, 0.0, 1.0) + ${GPU_BILLBOARD_ORIENTATION_ATTRIBUTE}.y;`,
  `float gpuBillboardSway = sin(${GPU_BILLBOARD_TIME_UNIFORM} * ${GPU_BILLBOARD_WIND_ATTRIBUTE}.y + ${GPU_BILLBOARD_WIND_ATTRIBUTE}.x) * ${GPU_BILLBOARD_WIND_ATTRIBUTE}.z * ${GPU_BILLBOARD_WIND_STRENGTH_UNIFORM};`,
  `float gpuBillboardLean = ${GPU_BILLBOARD_ORIENTATION_ATTRIBUTE}.z + gpuBillboardSway;`,
  'float gpuBillboardLeanCos = cos(gpuBillboardLean);',
  'float gpuBillboardLeanSin = sin(gpuBillboardLean);',
  `vec2 gpuBillboardLocal = vec2(position.x * ${GPU_BILLBOARD_SCALE_ATTRIBUTE}.x * ${GPU_BILLBOARD_MIRROR_ATTRIBUTE}, position.y * ${GPU_BILLBOARD_SCALE_ATTRIBUTE}.y);`,
  'vec2 gpuBillboardLeant = vec2(',
  '  gpuBillboardLocal.x * gpuBillboardLeanCos - gpuBillboardLocal.y * gpuBillboardLeanSin,',
  '  gpuBillboardLocal.x * gpuBillboardLeanSin + gpuBillboardLocal.y * gpuBillboardLeanCos',
  ');',
  'vec3 gpuBillboardRight = vec3(cos(gpuBillboardYaw), 0.0, -sin(gpuBillboardYaw));',
  'transformed = gpuBillboardRight * gpuBillboardLeant.x + vec3(0.0, gpuBillboardLeant.y, 0.0);',
  '#endif',
].join('\n');

/**
 * Patches only the stock vertex transform. The fragment shader is returned
 * untouched, retaining MeshBasicMaterial map, alpha-test, alpha-to-coverage,
 * fog, tone-mapping, and color-space behavior.
 */
export function patchGpuBillboardShaderSources(
  sources: GpuBillboardShaderSources,
): GpuBillboardShaderSources {
  const hasDeclarations = sources.vertexShader.includes(GPU_BILLBOARD_DECLARATIONS);
  const hasTransform = sources.vertexShader.includes(GPU_BILLBOARD_TRANSFORM);
  if (hasDeclarations && hasTransform) return sources;
  if (hasDeclarations || hasTransform) {
    throw new Error('Cannot patch GPU billboard vertex shader: a partial patch is already present.');
  }

  let vertexShader = injectAfterInclude(sources.vertexShader, 'common', GPU_BILLBOARD_DECLARATIONS);
  vertexShader = injectAfterInclude(vertexShader, 'begin_vertex', GPU_BILLBOARD_TRANSFORM);
  return { vertexShader, fragmentShader: sources.fragmentShader };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * CPU reference for the shader's authored-to-camera yaw interpolation. It is
 * useful for visual tests and diagnostics: unlike direct angle lerp, crossing
 * the -PI/PI seam always follows the shortest arc.
 */
export function interpolateGpuBillboardYaw(
  baseYaw: number,
  cameraYaw: number,
  facingStrength: number,
  yawOffset = 0,
): number {
  const safeBaseYaw = finiteOr(baseYaw, 0);
  const safeCameraYaw = finiteOr(cameraYaw, safeBaseYaw);
  const delta = Math.atan2(
    Math.sin(safeCameraYaw - safeBaseYaw),
    Math.cos(safeCameraYaw - safeBaseYaw),
  );
  return safeBaseYaw
    + delta * clamp01(finiteOr(facingStrength, 1))
    + finiteOr(yawOffset, 0);
}

function finiteScale(value: number): number {
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

function validatePosition(position: GpuBillboardVector3Like, index: number): void {
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new TypeError(`GPU billboard instance ${index} requires a finite XYZ position.`);
  }
}

function staticAttribute(array: Float32Array, itemSize: number): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(array, itemSize, false, 1);
  attribute.setUsage(THREE.StaticDrawUsage);
  return attribute;
}

function reusableStaticAttribute(
  geometry: THREE.BufferGeometry,
  name: string,
  itemSize: number,
  minimumCapacity: number,
): THREE.InstancedBufferAttribute | null {
  const attribute = geometry.getAttribute(name);
  return attribute instanceof THREE.InstancedBufferAttribute
    && attribute.array instanceof Float32Array
    && attribute.itemSize === itemSize
    && attribute.count >= minimumCapacity
    && attribute.meshPerAttribute === 1
    && attribute.usage === THREE.StaticDrawUsage
    ? attribute
    : null;
}

function reusableGpuBillboardAttributes(
  geometry: THREE.BufferGeometry,
  minimumCapacity: number,
): GpuBillboardInstanceAttributes | null {
  const scale = reusableStaticAttribute(
    geometry,
    GPU_BILLBOARD_SCALE_ATTRIBUTE,
    2,
    minimumCapacity,
  );
  const orientation = reusableStaticAttribute(
    geometry,
    GPU_BILLBOARD_ORIENTATION_ATTRIBUTE,
    4,
    minimumCapacity,
  );
  const wind = reusableStaticAttribute(
    geometry,
    GPU_BILLBOARD_WIND_ATTRIBUTE,
    3,
    minimumCapacity,
  );
  const mirror = reusableStaticAttribute(
    geometry,
    GPU_BILLBOARD_MIRROR_ATTRIBUTE,
    1,
    minimumCapacity,
  );
  return scale && orientation && wind && mirror
    ? { scale, orientation, wind, mirror }
    : null;
}

function hasGpuBillboardAttributes(geometry: THREE.BufferGeometry): boolean {
  return [
    GPU_BILLBOARD_SCALE_ATTRIBUTE,
    GPU_BILLBOARD_ORIENTATION_ATTRIBUTE,
    GPU_BILLBOARD_WIND_ATTRIBUTE,
    GPU_BILLBOARD_MIRROR_ATTRIBUTE,
  ].some((name) => geometry.hasAttribute(name));
}

function createGpuBillboardAttributes(
  geometry: THREE.BufferGeometry,
  capacity: number,
): GpuBillboardInstanceAttributes {
  if (hasGpuBillboardAttributes(geometry)) {
    // BufferAttribute has no public dispose method. Disposing the geometry while
    // the old attributes are still attached lets WebGLRenderer's geometry
    // listener delete every old GL buffer. The CPU geometry remains reusable
    // and is uploaded again on its next render.
    geometry.dispose();
    geometry.deleteAttribute(GPU_BILLBOARD_SCALE_ATTRIBUTE);
    geometry.deleteAttribute(GPU_BILLBOARD_ORIENTATION_ATTRIBUTE);
    geometry.deleteAttribute(GPU_BILLBOARD_WIND_ATTRIBUTE);
    geometry.deleteAttribute(GPU_BILLBOARD_MIRROR_ATTRIBUTE);
  }

  const attributes: GpuBillboardInstanceAttributes = {
    scale: staticAttribute(new Float32Array(capacity * 2), 2),
    orientation: staticAttribute(new Float32Array(capacity * 4), 4),
    wind: staticAttribute(new Float32Array(capacity * 3), 3),
    mirror: staticAttribute(new Float32Array(capacity), 1),
  };
  geometry.setAttribute(GPU_BILLBOARD_SCALE_ATTRIBUTE, attributes.scale);
  geometry.setAttribute(GPU_BILLBOARD_ORIENTATION_ATTRIBUTE, attributes.orientation);
  geometry.setAttribute(GPU_BILLBOARD_WIND_ATTRIBUTE, attributes.wind);
  geometry.setAttribute(GPU_BILLBOARD_MIRROR_ATTRIBUTE, attributes.mirror);
  return attributes;
}

/**
 * Uploads per-instance attributes to a geometry. Compatible buffers are updated
 * in place. If larger buffers are unavoidable, the geometry is disposed before
 * replacement so an attached renderer can release every old GL allocation; its
 * CPU data remains usable and will upload again on the next render.
 */
export function setGpuBillboardInstanceAttributes(
  geometry: THREE.BufferGeometry,
  instances: readonly GpuBillboardInstance[],
  capacity = instances.length,
): GpuBillboardInstanceAttributes {
  if (!Number.isSafeInteger(capacity) || capacity < instances.length) {
    throw new RangeError(
      `GPU billboard attribute capacity (${capacity}) must be an integer at least as large as the instance count (${instances.length}).`,
    );
  }
  instances.forEach((instance, index) => validatePosition(instance.position, index));

  const attributes = reusableGpuBillboardAttributes(geometry, capacity)
    ?? createGpuBillboardAttributes(geometry, capacity);
  const scales = attributes.scale.array as Float32Array;
  const orientations = attributes.orientation.array as Float32Array;
  const winds = attributes.wind.array as Float32Array;
  const mirrors = attributes.mirror.array as Float32Array;
  scales.fill(0);
  orientations.fill(0);
  winds.fill(0);
  mirrors.fill(1);

  instances.forEach((instance, index) => {
    const width = finiteScale(instance.scale.x);
    const height = finiteScale(instance.scale.y);
    const mirrored = instance.mirrorX ?? (instance.scale.x < 0);

    scales[index * 2] = width;
    scales[index * 2 + 1] = height;
    orientations[index * 4] = finiteOr(instance.baseYaw, 0);
    orientations[index * 4 + 1] = finiteOr(instance.yawOffset, 0);
    orientations[index * 4 + 2] = finiteOr(instance.lean, 0);
    orientations[index * 4 + 3] = clamp01(finiteOr(instance.facingStrength, 1));
    winds[index * 3] = finiteOr(instance.windPhase, 0);
    winds[index * 3 + 1] = finiteOr(instance.windSpeed, DEFAULT_WIND_SPEED);
    winds[index * 3 + 2] = finiteOr(instance.windAmplitude, 0);
    mirrors[index] = mirrored ? -1 : 1;
  });

  attributes.scale.needsUpdate = true;
  attributes.orientation.needsUpdate = true;
  attributes.wind.needsUpdate = true;
  attributes.mirror.needsUpdate = true;
  return attributes;
}

function setConservativeBillboardBounds(
  mesh: THREE.InstancedMesh,
  instances: readonly GpuBillboardInstance[],
): { boundingBox: THREE.Box3; boundingSphere: THREE.Sphere } {
  const boundingBox = new THREE.Box3();
  const minimum = new THREE.Vector3();
  const maximum = new THREE.Vector3();

  for (const instance of instances) {
    const width = finiteScale(instance.scale.x);
    const height = finiteScale(instance.scale.y);
    // A sphere remains correct for every camera-facing yaw and every lean angle.
    const radius = Math.max(MIN_BOUNDING_RADIUS, Math.hypot(width, height) * 0.5);
    minimum.set(
      instance.position.x - radius,
      instance.position.y - radius,
      instance.position.z - radius,
    );
    maximum.set(
      instance.position.x + radius,
      instance.position.y + radius,
      instance.position.z + radius,
    );
    boundingBox.expandByPoint(minimum);
    boundingBox.expandByPoint(maximum);
  }

  const boundingSphere = instances.length > 0
    ? boundingBox.getBoundingSphere(new THREE.Sphere())
    : new THREE.Sphere(new THREE.Vector3(), 0);
  mesh.boundingBox = boundingBox;
  mesh.boundingSphere = boundingSphere;
  return { boundingBox, boundingSphere };
}

/**
 * Configures an InstancedMesh once. Instance matrices carry translation only;
 * scale, orientation, mirror, and wind remain immutable GPU attributes. The
 * geometry should be a unit XY plane and unique to this draw group.
 */
export function configureGpuBillboardInstances(
  mesh: THREE.InstancedMesh,
  instances: readonly GpuBillboardInstance[],
): ConfigureGpuBillboardInstancesResult {
  if (instances.length > mesh.instanceMatrix.count) {
    throw new RangeError(
      `GPU billboard instance count (${instances.length}) exceeds mesh capacity (${mesh.instanceMatrix.count}).`,
    );
  }

  // Allocate to the fixed mesh capacity on the first call. Streaming windows
  // can subsequently grow/shrink within that capacity without replacing any
  // BufferAttribute or orphaning its WebGL buffer.
  const attributes = setGpuBillboardInstanceAttributes(
    mesh.geometry,
    instances,
    mesh.instanceMatrix.count,
  );
  const translation = new THREE.Matrix4();
  instances.forEach((instance, index) => {
    translation.makeTranslation(instance.position.x, instance.position.y, instance.position.z);
    mesh.setMatrixAt(index, translation);
  });
  mesh.count = instances.length;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;

  return { ...attributes, ...setConservativeBillboardBounds(mesh, instances) };
}

/**
 * Clones a MeshBasicMaterial and adds GPU camera-facing/wind deformation. The
 * clone keeps all base maps and render flags by reference; disposal never owns
 * or destroys those shared resources.
 */
export function createGpuBillboardMaterial(
  baseMaterial: THREE.MeshBasicMaterial,
  options: GpuBillboardMaterialOptions = {},
): GpuBillboardMaterialHandle {
  const cameraUniform = { value: new THREE.Vector3() };
  const timeUniform = { value: 0 };
  const windStrengthUniform = { value: Math.max(0, finiteOr(options.windStrength, 1)) };
  const worldCameraPosition = new THREE.Vector3();
  const inverseBillboardWorld = new THREE.Matrix4();

  const material = baseMaterial.clone();
  const baseOnBeforeCompile = baseMaterial.onBeforeCompile;
  const baseProgramCacheKey = baseMaterial.customProgramCacheKey;
  material.name = options.name ?? `${baseMaterial.name || 'billboard'}-gpu`;
  material.forceSinglePass = options.forceSinglePass ?? true;
  material.onBeforeCompile = (shader, renderer) => {
    baseOnBeforeCompile.call(material, shader, renderer);
    shader.uniforms[GPU_BILLBOARD_CAMERA_UNIFORM] = cameraUniform;
    shader.uniforms[GPU_BILLBOARD_TIME_UNIFORM] = timeUniform;
    shader.uniforms[GPU_BILLBOARD_WIND_STRENGTH_UNIFORM] = windStrengthUniform;
    const patched = patchGpuBillboardShaderSources(shader);
    shader.vertexShader = patched.vertexShader;
    shader.fragmentShader = patched.fragmentShader;
  };
  material.customProgramCacheKey = () => (
    `${baseProgramCacheKey.call(baseMaterial)}|${SHADER_PATCH_VERSION}`
  );
  material.needsUpdate = true;

  let disposed = false;
  const setFrame = (cameraPositionObjectSpace: GpuBillboardVector3Like, elapsedSeconds: number) => {
    cameraUniform.value.set(
      finiteOr(cameraPositionObjectSpace.x, 0),
      finiteOr(cameraPositionObjectSpace.y, 0),
      finiteOr(cameraPositionObjectSpace.z, 0),
    );
    timeUniform.value = finiteOr(elapsedSeconds, 0);
  };

  return {
    material,
    get disposed() {
      return disposed;
    },
    setFrame,
    updateFrame(camera, billboardRoot, elapsedSeconds) {
      camera.getWorldPosition(worldCameraPosition);
      billboardRoot.updateWorldMatrix(true, false);
      inverseBillboardWorld.copy(billboardRoot.matrixWorld).invert();
      worldCameraPosition.applyMatrix4(inverseBillboardWorld);
      setFrame(worldCameraPosition, elapsedSeconds);
    },
    setWindStrength(strength) {
      windStrengthUniform.value = Math.max(0, finiteOr(strength, 0));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
    },
  };
}

export interface ScenicWaterShaderSources {
  vertexShader: string;
  fragmentShader: string;
}

function replaceRequired(source: string, marker: string, replacement: string): string {
  if (!source.includes(marker)) {
    throw new Error(`Cannot patch scenic water shader: missing ${marker}.`);
  }
  return source.replace(marker, replacement);
}

/**
 * Adds a per-fragment bank feather to a stock Three material shader. Water
 * ribbons have only two cross-width vertices (UV.x 0 and 1), so the raw UV is
 * interpolated and the smoothstep must happen in the fragment shader.
 */
export function patchScenicWaterShaderSources(
  sources: ScenicWaterShaderSources,
  featherEdges: boolean,
): ScenicWaterShaderSources {
  let vertexShader = replaceRequired(
    sources.vertexShader,
    '#include <common>',
    '#include <common>\nvarying float vScenicWaterAcross;',
  );
  vertexShader = replaceRequired(
    vertexShader,
    '#include <uv_vertex>',
    '#include <uv_vertex>\nvScenicWaterAcross = clamp(uv.x, 0.0, 1.0);',
  );

  let fragmentShader = replaceRequired(
    sources.fragmentShader,
    '#include <common>',
    '#include <common>\nvarying float vScenicWaterAcross;',
  );
  fragmentShader = replaceRequired(
    fragmentShader,
    '#include <opaque_fragment>',
    `${featherEdges ? `float scenicWaterEdgeAlpha = smoothstep(0.0, 0.16, vScenicWaterAcross)
  * (1.0 - smoothstep(0.84, 1.0, vScenicWaterAcross));
diffuseColor.a *= scenicWaterEdgeAlpha;
` : ''}#include <opaque_fragment>`,
  );
  return { vertexShader, fragmentShader };
}

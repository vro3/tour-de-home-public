export type BillboardVariationKind = 'foliage' | 'ground' | 'rigid' | 'water';

export interface BillboardVariation {
  mirrorX: boolean;
  heightScale: number;
  widthScale: number;
  yawOffset: number;
  lean: number;
  windPhase: number;
  windAmplitude: number;
  windSpeed: number;
}

export function stableBillboardHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function channel(hash: number, shift: number): number {
  const mixed = Math.imul((hash >>> shift) ^ hash, 0x45d9f3b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

/** Stable visual variation that never changes as scenery windows stream. */
export function deriveBillboardVariation(
  stableId: string,
  kind: BillboardVariationKind,
): BillboardVariation {
  const hash = stableBillboardHash(`${kind}:${stableId}`);
  const first = channel(hash, 3);
  const second = channel(hash, 9);
  const third = channel(hash, 15);
  const fourth = channel(hash, 21);
  const foliage = kind === 'foliage';
  const ground = kind === 'ground';
  return {
    mirrorX: kind !== 'water' && (hash & 1) === 1,
    heightScale: foliage ? 0.84 + first * 0.32 : ground ? 0.88 + first * 0.24 : 0.94 + first * 0.12,
    widthScale: foliage ? 0.76 + second * 0.48 : ground ? 0.78 + second * 0.44 : 0.91 + second * 0.18,
    yawOffset: (third - 0.5) * (foliage ? 0.2 : ground ? 0.12 : 0.06),
    lean: (fourth - 0.5) * (foliage ? 0.07 : ground ? 0.025 : 0.012),
    windPhase: second * Math.PI * 2,
    windAmplitude: foliage ? 0.006 + first * 0.018 : ground ? 0.002 + first * 0.006 : 0,
    windSpeed: 0.42 + third * 0.46,
  };
}

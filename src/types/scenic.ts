export const SCENIC_THEME_OPTIONS = [
  { id: 'daybreak', label: 'Daybreak', group: 'Tour de Home' },
  { id: 'moonride', label: 'Moonride', group: 'Tour de Home' },
  { id: 'deathisland', label: 'Verdant Tide', group: 'Cinematic worlds' },
  { id: 'avalanche', label: 'Glacier Vault', group: 'Cinematic worlds' },
  { id: 'sidewinder', label: 'Frozen Night', group: 'Cinematic worlds' },
  { id: 'snowbound', label: 'Cobalt Expanse', group: 'Cinematic worlds' },
  { id: 'forgeworld', label: 'Alpine Fjord', group: 'Cinematic worlds' },
  { id: 'powerhouse', label: 'Copper Ravine', group: 'Cinematic worlds' },
  { id: 'nmpdhq', label: 'Violet Metropolis', group: 'Cinematic worlds' },
  { id: 'coastalhighway', label: 'Sunset Promenade', group: 'Cinematic worlds' },
] as const;

export type ScenicTheme = typeof SCENIC_THEME_OPTIONS[number]['id'];

export const SCENIC_QUALITY_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'High' },
  { id: 'efficient', label: 'Efficient' },
] as const;

export type ScenicQualityMode = typeof SCENIC_QUALITY_OPTIONS[number]['id'];

export function isScenicTheme(value: unknown): value is ScenicTheme {
  return SCENIC_THEME_OPTIONS.some((theme) => theme.id === value);
}

export function isScenicQualityMode(value: unknown): value is ScenicQualityMode {
  return SCENIC_QUALITY_OPTIONS.some((quality) => quality.id === value);
}

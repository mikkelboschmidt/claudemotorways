import { musicEnabled } from './music.ts';

const SFX_VOLUME = 0.4;
const cache = new Map<string, HTMLAudioElement>();
const EFFECTS = ['build', 'demolish', 'road'];

for (const name of EFFECTS) {
  const audio = new Audio(`sfx/${name}.mp3`);
  audio.preload = 'auto';
  cache.set(name, audio);
}

export function playSfx(name: string) {
  if (!musicEnabled) return;
  const src = cache.get(name);
  if (!src) return;
  const clone = src.cloneNode() as HTMLAudioElement;
  clone.volume = SFX_VOLUME;
  clone.play().catch(() => {});
}

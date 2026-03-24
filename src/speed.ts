// Game speed multiplier: controls how many simulation ticks run per frame.
// 1 = normal, 2 = 2x, 3 = 3x, 0 = paused
export const SPEED_OPTIONS = [0, 1, 2, 3] as const;
export const SPEED_LABELS = ['||', '1x', '2x', '3x'];

export let gameSpeed: number = 1;

export function setGameSpeed(speed: number) {
  gameSpeed = speed;
}

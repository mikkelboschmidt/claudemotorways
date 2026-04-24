import { gameSpeed } from './speed.ts';

// Shared simulation clock. Advances in simulation time while the game is
// running, and freezes while paused.
let gameClockMs = 0;
let lastRealMs = performance.now();
let wasPaused = false;

export function updateGameClock(): number {
  const realNow = performance.now();
  if (gameSpeed > 0 && !wasPaused) {
    gameClockMs += (realNow - lastRealMs) * gameSpeed;
  }
  lastRealMs = realNow;
  wasPaused = gameSpeed === 0;
  return gameClockMs;
}

export function getGameClockMs(): number {
  return gameClockMs;
}


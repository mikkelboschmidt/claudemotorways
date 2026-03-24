// Background music player — loops an MP3 from public/music/

export let musicEnabled = true;

const VOLUME = 0.3;
const audio = new Audio();
audio.loop = true;
audio.volume = VOLUME;

// Tracks in public/music/ — add more filenames here to get random selection
const TRACKS = [
  'Skyline Springtime.mp3',
];

function pickTrack(): string {
  const idx = Math.floor(Math.random() * TRACKS.length);
  return `music/${TRACKS[idx]}`;
}

let started = false;

export function startMusic() {
  if (!audio.src || audio.src.endsWith('/')) {
    audio.src = pickTrack();
  }
  audio.play().catch(() => {
    // Browser blocked autoplay — will retry on next user gesture
  });
  started = true;
}

export function stopMusic() {
  audio.pause();
}

export function toggleMusic(): boolean {
  musicEnabled = !musicEnabled;
  if (musicEnabled) {
    startMusic();
  } else {
    stopMusic();
  }
  return musicEnabled;
}

// Call on first user interaction to unlock audio autoplay
export function ensureMusicStarted() {
  if (musicEnabled && !started) {
    startMusic();
  }
}

import { loadFromData, saveGame, SaveData } from './save.ts';

export interface CityEntry { name: string; file: string; }

export let cities: CityEntry[] = [];
export let backendAvailable = false;

export async function fetchCities() {
  try {
    const res = await fetch('/api/cities');
    if (res.ok) {
      cities = await res.json();
      backendAvailable = true;
      return;
    }
  } catch {
    // backend not available
  }
  // Fallback: load from static manifest
  try {
    console.log('Backend unavailable, loading cities from static manifest');
    const base = import.meta.env.BASE_URL || '/';
    const res = await fetch(`${base}cities/manifest.json`);
    if (!res.ok) return;
    cities = await res.json();
  } catch {
    // manifest not found either
  }
}

export async function loadCity(slug: string) {
  try {
    const res = await fetch(`/api/cities/${slug}`);
    if (res.ok) {
      const data: SaveData = await res.json();
      data.score = 0;
      if (loadFromData(data)) {
        saveGame();
      }
      return;
    }
  } catch {
    // backend not available
  }
  // Fallback: load from static file
  try {
    console.log(`Backend unavailable, loading city "${slug}" from static files`);
    const base = import.meta.env.BASE_URL || '/';
    const file = slug.endsWith('.json') ? slug : `${slug}.json`;
    const res = await fetch(`${base}cities/${file}`);
    if (!res.ok) return;
    const data: SaveData = await res.json();
    data.score = 0;
    if (loadFromData(data)) {
      saveGame();
    }
  } catch {
    // silently ignore
  }
}

import { loadFromData, saveGame, SaveData } from './save.ts';

export interface CityEntry { name: string; file: string; }

export let cities: CityEntry[] = [];

export async function fetchCities() {
  try {
    const base = import.meta.env.BASE_URL || '/';
    const res = await fetch(`${base}cities/manifest.json`);
    if (!res.ok) return;
    cities = await res.json();
  } catch {
    // manifest not found
  }
}

export async function loadCity(file: string) {
  try {
    const base = import.meta.env.BASE_URL || '/';
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

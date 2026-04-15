export function darkenHex(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `rgb(${r},${g},${b})`;
}

export function lightenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr},${lg},${lb})`;
}

export function darkenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`;
}

export function colorToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function expandHex(c: string): string {
  if (c.length === 4) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  return c;
}

export function lerpColor(c0: string, c1: string, f: number): string {
  const a = expandHex(c0), b = expandHex(c1);
  const r0 = parseInt(a.slice(1, 3), 16), g0 = parseInt(a.slice(3, 5), 16), b0 = parseInt(a.slice(5, 7), 16);
  const r1 = parseInt(b.slice(1, 3), 16), g1 = parseInt(b.slice(3, 5), 16), b1 = parseInt(b.slice(5, 7), 16);
  const r = Math.round(r0 + (r1 - r0) * f), g = Math.round(g0 + (g1 - g0) * f), bb = Math.round(b0 + (b1 - b0) * f);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bb).toString(16).slice(1);
}


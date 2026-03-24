// Camera state: camX/camY = world position at screen top-left, zoom = scale factor
export let camX = 0;
export let camY = 0;
export let zoom = 1;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;

export function screenToWorld(sx: number, sy: number): [number, number] {
  return [sx / zoom + camX, sy / zoom + camY];
}

export function worldToScreen(wx: number, wy: number): [number, number] {
  return [(wx - camX) * zoom, (wy - camY) * zoom];
}

export function pan(dScreenX: number, dScreenY: number) {
  camX -= dScreenX / zoom;
  camY -= dScreenY / zoom;
}

export function zoomAt(screenX: number, screenY: number, factor: number) {
  // Keep the world point under the cursor fixed
  const [wx, wy] = screenToWorld(screenX, screenY);
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
  camX = wx - screenX / zoom;
  camY = wy - screenY / zoom;
}

export function resetCamera() {
  camX = 0;
  camY = 0;
  zoom = 1;
}

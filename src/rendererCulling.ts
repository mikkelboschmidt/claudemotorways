let cullLeft = -Infinity;
let cullTop = -Infinity;
let cullRight = Infinity;
let cullBottom = Infinity;

export function setCullBounds(left: number, top: number, right: number, bottom: number) {
  cullLeft = left;
  cullTop = top;
  cullRight = right;
  cullBottom = bottom;
}

export function rectVisible(x: number, y: number, w: number, h: number, pad = 0): boolean {
  return x + w >= cullLeft - pad
    && x <= cullRight + pad
    && y + h >= cullTop - pad
    && y <= cullBottom + pad;
}

export function circleVisible(cx: number, cy: number, r: number, pad = 0): boolean {
  const rr = r + pad;
  return cx + rr >= cullLeft
    && cx - rr <= cullRight
    && cy + rr >= cullTop
    && cy - rr <= cullBottom;
}

export function segmentVisible(fx: number, fy: number, tx: number, ty: number, pad = 0): boolean {
  const minX = Math.min(fx, tx);
  const maxX = Math.max(fx, tx);
  const minY = Math.min(fy, ty);
  const maxY = Math.max(fy, ty);
  return rectVisible(minX, minY, maxX - minX, maxY - minY, pad);
}


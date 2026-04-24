import { cities } from './cities.ts';
import { productivityBreakdown } from './score.ts';
import { theme, themeAssets } from './theme.ts';
import { productivityInfoScroll } from './toolbar.ts';

const splashCache = new Map<string, HTMLImageElement>();

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const lines = wrapLines(ctx, text, maxWidth);
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function getSplashImage(): HTMLImageElement {
  const url = themeAssets.splashUrl;
  let img = splashCache.get(url);
  if (img) return img;
  img = new Image();
  img.src = url;
  splashCache.set(url, img);
  return img;
}

export const MODAL_BTN_W = 130;
export const MODAL_BTN_H = 42;
const MODAL_RADIUS = 14;

export function getModalMetrics(width: number, height: number) {
  const size = Math.min(width * 0.7, height * 0.8);
  const mx = (width - size) / 2;
  const my = (height - size) / 2;
  return { size, mx, my };
}

export function drawDemoModal(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = theme.overlayDim;
  ctx.fillRect(0, 0, width, height);

  const { size, mx, my } = getModalMetrics(width, height);

  ctx.save();
  ctx.shadowColor = theme.modalShadow;
  ctx.shadowBlur = 32;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
  ctx.fill();
  ctx.restore();

  const splashImg = getSplashImage();
  if (splashImg.complete && splashImg.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
    ctx.clip();
    ctx.drawImage(splashImg, mx, my, size, size);
    ctx.restore();
  }

  ctx.strokeStyle = theme.modalOutline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
  ctx.stroke();

  const closeSize = 28;
  const closePad = 8;
  const closeX = mx + size - closeSize - closePad;
  const closeY = my + closePad;
  ctx.fillStyle = theme.closeButtonBg;
  ctx.beginPath();
  ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = theme.btnBorder;
  ctx.lineWidth = 2;
  const xPad = 8;
  ctx.beginPath();
  ctx.moveTo(closeX + xPad, closeY + xPad);
  ctx.lineTo(closeX + closeSize - xPad, closeY + closeSize - xPad);
  ctx.moveTo(closeX + closeSize - xPad, closeY + xPad);
  ctx.lineTo(closeX + xPad, closeY + closeSize - xPad);
  ctx.stroke();

  const gradH = 100;
  const grad = ctx.createLinearGradient(0, my + size - gradH, 0, my + size);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, theme.bottomGradientEnd);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(mx, my + size - gradH, size, gradH);
  ctx.restore();

  const gap = 14;
  const pillRadius = MODAL_BTN_H / 2;
  const totalBtnW = MODAL_BTN_W * 2 + gap;
  const btnStartX = mx + (size - totalBtnW) / 2;
  const btnY = my + size - MODAL_BTN_H - 46;

  const glowColors = theme.glowColors;
  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const colorIdx = t * 0.8;
  const c0 = glowColors[Math.floor(colorIdx) % glowColors.length];
  const c1 = glowColors[(Math.floor(colorIdx) + 1) % glowColors.length];
  const frac = colorIdx % 1;
  const gr = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
  const gg = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
  const gb = Math.round(c0[2] + (c1[2] - c0[2]) * frac);
  const glowAlpha = 0.5 + 0.4 * pulse;
  const glowBlur = 12 + 10 * pulse;

  const drawGlowBtn = (bx: number, gradFill: CanvasGradient, label: string) => {
    ctx.save();
    ctx.shadowColor = `rgba(${gr}, ${gg}, ${gb}, ${glowAlpha})`;
    ctx.shadowBlur = glowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = gradFill;
    ctx.beginPath();
    ctx.roundRect(bx, btnY, MODAL_BTN_W, MODAL_BTN_H, pillRadius);
    ctx.fill();
    ctx.shadowBlur = glowBlur * 1.5;
    ctx.shadowColor = `rgba(${gr}, ${gg}, ${gb}, ${glowAlpha * 0.4})`;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = theme.btnBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, btnY, MODAL_BTN_W, MODAL_BTN_H, pillRadius);
    ctx.stroke();
    ctx.fillStyle = theme.btnText;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + MODAL_BTN_W / 2, btnY + MODAL_BTN_H / 2);
  };

  const demoGrad = ctx.createLinearGradient(0, btnY, 0, btnY + MODAL_BTN_H);
  demoGrad.addColorStop(0, theme.demoBtnGradTop);
  demoGrad.addColorStop(1, theme.demoBtnGradBottom);
  drawGlowBtn(btnStartX, demoGrad, 'Demo City');

  const freshGrad = ctx.createLinearGradient(0, btnY, 0, btnY + MODAL_BTN_H);
  freshGrad.addColorStop(0, theme.freshBtnGradTop);
  freshGrad.addColorStop(1, theme.freshBtnGradBottom);
  drawGlowBtn(btnStartX + MODAL_BTN_W + gap, freshGrad, 'Start Fresh');
}

export const CITY_MODAL_W = 320;
export const CITY_MODAL_PAD = 16;
export const CITY_ROW_H = 44;
export const CITY_ROW_GAP = 8;
export const PRODUCTIVITY_MODAL_W = 420;
const PRODUCTIVITY_MODAL_RADIUS = 14;
let productivityModalMaxScroll = 0;

export function getProductivityModalMaxScroll() {
  return productivityModalMaxScroll;
}

export function getCityModalMetrics(width: number, height: number) {
  const cityCount = cities.length;
  const headerH = 48;
  const contentH = cityCount * (CITY_ROW_H + CITY_ROW_GAP) - CITY_ROW_GAP;
  const modalH = headerH + contentH + CITY_MODAL_PAD * 2;
  const mx = (width - CITY_MODAL_W) / 2;
  const my = (height - modalH) / 2;
  return { modalH, mx, my, headerH };
}

export function drawCityModal(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = theme.overlayDim;
  ctx.fillRect(0, 0, width, height);

  const cityCount = cities.length;
  const { modalH, mx, my, headerH } = getCityModalMetrics(width, height);

  ctx.save();
  ctx.shadowColor = theme.modalShadow;
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = theme.cityModalBg;
  ctx.beginPath();
  ctx.roundRect(mx, my, CITY_MODAL_W, modalH, 12);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = theme.cityModalOutline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(mx, my, CITY_MODAL_W, modalH, 12);
  ctx.stroke();

  ctx.fillStyle = theme.cityRowText;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Choose a City', mx + CITY_MODAL_W / 2, my + headerH / 2);

  const closeSize = 28;
  const closePad = 10;
  const closeX = mx + CITY_MODAL_W - closeSize - closePad;
  const closeY = my + closePad;
  ctx.fillStyle = theme.cityCloseBg;
  ctx.beginPath();
  ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = theme.btnBorder;
  ctx.lineWidth = 2;
  const xInset = 8;
  ctx.beginPath();
  ctx.moveTo(closeX + xInset, closeY + xInset);
  ctx.lineTo(closeX + closeSize - xInset, closeY + closeSize - xInset);
  ctx.moveTo(closeX + closeSize - xInset, closeY + xInset);
  ctx.lineTo(closeX + xInset, closeY + closeSize - xInset);
  ctx.stroke();

  let rowY = my + headerH;
  for (let i = 0; i < cityCount; i++) {
    const rowX = mx + CITY_MODAL_PAD;
    const rowW = CITY_MODAL_W - CITY_MODAL_PAD * 2;

    ctx.fillStyle = theme.cityRowBg;
    ctx.beginPath();
    ctx.roundRect(rowX, rowY, rowW, CITY_ROW_H, 8);
    ctx.fill();

    ctx.fillStyle = theme.cityRowText;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cities[i].name, mx + CITY_MODAL_W / 2, rowY + CITY_ROW_H / 2);

    rowY += CITY_ROW_H + CITY_ROW_GAP;
  }

  if (cityCount === 0) {
    ctx.fillStyle = theme.cityEmptyText;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No cities available', mx + CITY_MODAL_W / 2, my + headerH + 20);
  }
}

export function getProductivityModalMetrics(width: number, height: number) {
  const modalW = Math.min(PRODUCTIVITY_MODAL_W, width - 32);
  const modalH = Math.min(540, height - 32);
  const mx = (width - modalW) / 2;
  const my = (height - modalH) / 2;
  return { modalW, modalH, mx, my };
}

export function drawProductivityInfoModal(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = theme.overlayDim;
  ctx.fillRect(0, 0, width, height);

  const { modalW, modalH, mx, my } = getProductivityModalMetrics(width, height);

  ctx.save();
  ctx.shadowColor = theme.modalShadow;
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = 'rgba(12, 12, 12, 0.96)';
  ctx.beginPath();
  ctx.roundRect(mx, my, modalW, modalH, PRODUCTIVITY_MODAL_RADIUS);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = theme.modalOutline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(mx, my, modalW, modalH, PRODUCTIVITY_MODAL_RADIUS);
  ctx.stroke();

  const closeSize = 28;
  const closePad = 10;
  const closeX = mx + modalW - closeSize - closePad;
  const closeY = my + closePad;
  ctx.fillStyle = theme.closeButtonBg;
  ctx.beginPath();
  ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = theme.btnBorder;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(closeX + 8, closeY + 8);
  ctx.lineTo(closeX + closeSize - 8, closeY + closeSize - 8);
  ctx.moveTo(closeX + closeSize - 8, closeY + 8);
  ctx.lineTo(closeX + 8, closeY + closeSize - 8);
  ctx.stroke();

  const left = mx + 20;
  const right = mx + modalW - 20;
  const contentWidth = right - left - 12;
  const headerTop = my + 22;
  const viewportTop = my + 64;
  const viewportBottom = my + modalH - 20;
  const viewportHeight = viewportBottom - viewportTop;
  let y = headerTop;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.fillStyle = '#ffd966';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('How Productivity Works', left, y);
  y = viewportTop - productivityInfoScroll;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left - 4, viewportTop, modalW - 40, viewportHeight);
  ctx.clip();

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '14px sans-serif';
  for (const line of [
    'Productivity measures how well your whole city keeps pins moving.',
    'Handle pins steadily, avoid jams, protect factories, and build a bigger, smarter city.'
  ]) {
    y = drawWrappedText(ctx, line, left, y, contentWidth, 18);
    y += 2;
  }

  y += 8;
  const sections: [string, string][] = [
    ['Throughput', 'Pins handled each minute are the base of the score. Cars and trucks both count.'],
    ['Flow', 'Traffic that keeps moving scores better. Traffic jams and stale vehicles reduce it.'],
    ['Logistics', 'Storage should be useful as a working buffer, not empty forever and not full forever.'],
    ['Stability', 'Factories lose value when they fill up and sit near overflow.'],
    ['City Bonus', 'Expansion, road network depth, diversity, and longer useful travel all raise the ceiling.'],
  ];

  for (const [title, body] of sections) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(title, left, y);
    y += 18;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '13px sans-serif';
    y = drawWrappedText(ctx, body, left, y, contentWidth, 17);
    y += 14;
  }

  ctx.fillStyle = '#ffd966';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('Right now', left, y);
  y += 22;

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '13px sans-serif';
  for (const line of [
    `Throughput: ${productivityBreakdown.throughput}/min`,
    `Flow: ${productivityBreakdown.flow}%`,
    `Logistics: ${productivityBreakdown.logistics}%`,
    `Stability: ${productivityBreakdown.stability}%`,
    `City bonus: +${productivityBreakdown.cityBonus}%`,
  ]) {
    ctx.fillText(line, left, y);
    y += 18;
  }

  y += 10;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '13px sans-serif';
  y = drawWrappedText(ctx, 'City planning tip: keep routes active, use storage to absorb busy periods, and spread the city so travel has real value.', left, y, contentWidth, 17);
  ctx.restore();

  const contentHeight = Math.max(0, y - (viewportTop - productivityInfoScroll));
  productivityModalMaxScroll = Math.max(0, contentHeight - viewportHeight);

  if (productivityModalMaxScroll > 0) {
    const trackX = mx + modalW - 10;
    const trackY = viewportTop;
    const trackH = viewportHeight;
    const thumbH = Math.max(28, trackH * (viewportHeight / contentHeight));
    const travel = Math.max(0, trackH - thumbH);
    const thumbY = trackY + (productivityModalMaxScroll > 0 ? (productivityInfoScroll / productivityModalMaxScroll) * travel : 0);

    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.roundRect(trackX, trackY, 4, trackH, 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,217,102,0.75)';
    ctx.beginPath();
    ctx.roundRect(trackX, thumbY, 4, thumbH, 2);
    ctx.fill();
  }
}

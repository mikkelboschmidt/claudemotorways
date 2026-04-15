import { cities } from './cities.ts';
import { theme, themeAssets } from './theme.ts';

const splashCache = new Map<string, HTMLImageElement>();

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


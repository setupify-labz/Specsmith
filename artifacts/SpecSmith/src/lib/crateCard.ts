import { drawLogo, truncate } from './buildCard';
import { RARITY_STYLE, type CrateRarity } from './buildCrate';

export interface CrateCardPart {
  label: string;
  name: string;
  rarity: CrateRarity;
}

export interface CrateCardOptions {
  rarity: CrateRarity;
  parts: CrateCardPart[];
  totalCost: number;
  avgFps: number;
}

const W = 920;
const H = 520;

const C = {
  bg:      '#0A0A0F',
  text:    '#FFFFFF',
  text2:   '#8888AA',
  text3:   'rgba(255,255,255,0.28)',
  border:  'rgba(255,255,255,0.08)',
};

export function generateCrateCardCanvas(options: CrateCardOptions): HTMLCanvasElement {
  const { rarity, parts, totalCost, avgFps } = options;
  const style = RARITY_STYLE[rarity];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // ── Background ──────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Rarity-colored radial glow, centered high — brighter/bigger for rarer
  // pulls, same escalation the on-page landing effects use.
  const glowStrength = { common: 0.10, uncommon: 0.14, rare: 0.18, epic: 0.22, legendary: 0.30 }[rarity];
  const glowRadius = { common: 260, uncommon: 300, rare: 340, epic: 380, legendary: 440 }[rarity];
  const glow = ctx.createRadialGradient(W / 2, 40, 0, W / 2, 40, glowRadius);
  glow.addColorStop(0, style.color + Math.round(glowStrength * 255).toString(16).padStart(2, '0'));
  glow.addColorStop(1, style.color + '00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid texture
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // ── Rarity-colored frame ────────────────────────────────────────
  const frameInset = 6;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = rarity === 'legendary' ? 4 : rarity === 'epic' ? 3 : 2;
  ctx.shadowColor = style.color;
  ctx.shadowBlur = rarity === 'legendary' ? 28 : rarity === 'epic' ? 18 : 10;
  ctx.beginPath();
  ctx.roundRect(frameInset, frameInset, W - frameInset * 2, H - frameInset * 2, 18);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const PAD = 40;

  // ── Header: logo + rarity banner ────────────────────────────────
  drawLogo(ctx, PAD, 26, 34);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text;
  ctx.fillText('SpecSmith', PAD + 42, 42);

  ctx.textAlign = 'right';
  ctx.font = '900 30px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = style.color;
  ctx.fillText(`✦ ${style.label.toUpperCase()} PULL ✦`, W - PAD, 46);

  // ── Divider ──────────────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, 78);
  ctx.lineTo(W - PAD, 78);
  ctx.stroke();

  // ── Stat row: total cost + avg FPS ──────────────────────────────
  const statY = 122;
  ctx.textAlign = 'left';
  ctx.font = '700 10px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text2;
  ctx.fillText('TOTAL COST', PAD, statY - 20);
  ctx.font = '900 34px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text;
  ctx.fillText(`$${totalCost.toLocaleString()}`, PAD, statY + 14);

  const statX2 = PAD + 240;
  ctx.font = '700 10px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text2;
  ctx.fillText('AVG FPS (1440p, 20 games)', statX2, statY - 20);
  ctx.font = '900 34px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = style.color;
  ctx.fillText(`${avgFps}`, statX2, statY + 14);

  // ── Divider ──────────────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.beginPath();
  ctx.moveTo(PAD, statY + 40);
  ctx.lineTo(W - PAD, statY + 40);
  ctx.stroke();

  // ── Parts grid (2 columns x 4 rows), each with its own rarity dot ──
  const gridY = statY + 66;
  const colW = (W - PAD * 2) / 2;
  const rowH = 58;

  parts.forEach((part, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = PAD + col * colW;
    const y = gridY + row * rowH;
    const partColor = RARITY_STYLE[part.rarity].color;

    // Rarity dot
    ctx.beginPath();
    ctx.arc(x + 5, y + 8, 4, 0, Math.PI * 2);
    ctx.fillStyle = partColor;
    ctx.shadowColor = partColor;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.textAlign = 'left';
    ctx.font = '700 9px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = C.text2;
    ctx.fillText(part.label.toUpperCase(), x + 16, y);

    ctx.font = '600 14px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(truncate(part.name, 30), x + 16, y + 18);
  });

  // ── Bottom bar ───────────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.beginPath();
  ctx.moveTo(PAD, H - 44);
  ctx.lineTo(W - PAD, H - 44);
  ctx.stroke();

  ctx.font = '500 12px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text2;
  ctx.textAlign = 'left';
  ctx.fillText('specsmithpc.com/crate', PAD, H - 22);

  ctx.font = '500 11px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text3;
  ctx.textAlign = 'right';
  ctx.fillText('Open a Build Crate — every part guaranteed to fit', W - PAD, H - 22);

  return canvas;
}

export async function generateCrateCardBlob(options: CrateCardOptions): Promise<Blob> {
  const canvas = generateCrateCardCanvas(options);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate image'));
    }, 'image/png');
  });
}

export async function downloadCrateCard(options: CrateCardOptions): Promise<void> {
  const blob = await generateCrateCardBlob(options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `specsmith-crate-${options.rarity}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function copyCrateCardToClipboard(options: CrateCardOptions): Promise<void> {
  const blob = await generateCrateCardBlob(options);
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

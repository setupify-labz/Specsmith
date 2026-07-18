import { estimateFpsForBuild, type BuildFpsGame } from './fps';
import gamesData from '../data/games.json';

export interface BuildCardPart {
  label: string;
  name: string;
  price: number;
}

export interface BuildCardOptions {
  buildName?: string;
  parts: BuildCardPart[];
  totalCost: number;
  gpu: { name: string; gpu_multiplier: number } | null;
  cpu: { name: string; cpu_multiplier: number } | null;
}

const W = 920;
const H = 520;

const C = {
  bg:       '#0A0A0F',
  surface:  '#13131A',
  card:     '#1C1C26',
  border:   'rgba(255,255,255,0.08)',
  accent:   '#6C63FF',
  cyan:     '#00D4FF',
  text:     '#FFFFFF',
  text2:    '#8888AA',
  text3:    'rgba(255,255,255,0.28)',
  green:    '#00E676',
  yellow:   '#FFB300',
  red:      '#FF1744',
};

const games = gamesData as BuildFpsGame[];

// FPS on the card is rendered at 1080p/High for these three games.
const FEATURED_GAME_IDS = ['cyberpunk2077', 'valorant', 'cs2'];
const FEATURED_GAMES = FEATURED_GAME_IDS
  .map(id => games.find(g => g.id === id))
  .filter((g): g is BuildFpsGame => !!g);

const PRIORITY_LABELS = ['GPU', 'CPU', 'RAM', 'Storage', 'Motherboard', 'PSU', 'Case', 'Cooler'];

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

// The Anvil Chip mark, drawn in the same 64-unit space as Logo.tsx /
// favicon.svg and scaled to `size` pixels at (x, y) top-left.
function drawAnvilLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);

  const grad = ctx.createLinearGradient(10, 12, 56, 58);
  grad.addColorStop(0, '#7C6BFF');
  grad.addColorStop(1, C.cyan);

  ctx.fillStyle = C.cyan;
  ctx.fill(new Path2D('M24 3 L25.8 7.6 L30.5 9.5 L25.8 11.4 L24 16 L22.2 11.4 L17.5 9.5 L22.2 7.6 Z'));
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(34, 6, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = grad;
  ctx.fill(new Path2D('M11 16 H38 C46 16 53.5 16.5 57.5 19.5 C55.5 24.5 47 28.5 40 30 H11 Q8 30 8 27 V19 Q8 16 11 16 Z'));
  ctx.fill(new Path2D('M22 30 H40 C38.5 33.5 37 36.5 37 40 H27 C27 36.5 25.5 33.5 22 30 Z'));
  ctx.beginPath();
  ctx.roundRect(13, 40, 38, 13, 3);
  ctx.fill();
  for (const px of [17, 26.3, 35.6, 45]) {
    ctx.beginPath();
    ctx.roundRect(px, 53, 5, 6, 1.2);
    ctx.fill();
  }

  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(19, 46.5);
  ctx.lineTo(34, 46.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(38.5, 46.5, 2.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawGradientBar(ctx: CanvasRenderingContext2D, y: number, h: number) {
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, C.accent);
  grad.addColorStop(1, C.cyan);
  ctx.fillStyle = grad;
  ctx.fillRect(0, y, W, h);
}

function getFpsColor(fps: number): string {
  if (fps >= 144) return C.accent;
  if (fps >= 90)  return C.cyan;
  if (fps >= 60)  return C.green;
  if (fps >= 30)  return C.yellow;
  return C.red;
}

export function generateBuildCardCanvas(options: BuildCardOptions): HTMLCanvasElement {
  const { buildName, parts, totalCost, gpu, cpu } = options;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // ── Background ──────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid texture
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Glow blob top-left
  const glow = ctx.createRadialGradient(100, 100, 0, 100, 100, 220);
  glow.addColorStop(0, 'rgba(108,99,255,0.12)');
  glow.addColorStop(1, 'rgba(108,99,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Glow blob top-right
  const glow2 = ctx.createRadialGradient(W - 80, 60, 0, W - 80, 60, 180);
  glow2.addColorStop(0, 'rgba(0,212,255,0.10)');
  glow2.addColorStop(1, 'rgba(0,212,255,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // ── Top gradient bar ─────────────────────────────────────────────
  drawGradientBar(ctx, 0, 5);

  // ── Header area ──────────────────────────────────────────────────
  const PAD = 36;
  const headerY = 30;

  // Anvil Chip logo
  drawAnvilLogo(ctx, PAD, headerY - 2, 36);

  // "SpecSmith" wordmark
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text;
  ctx.fillText('SpecSmith', PAD + 38, headerY + 16);

  // Build name (right side)
  const title = truncate(buildName && buildName.trim() ? buildName : 'My SpecSmith Build', 36);
  ctx.textAlign = 'right';
  ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text;
  ctx.fillText(title, W - PAD, headerY + 10);

  // Total cost (right, below name)
  const costStr = totalCost > 0 ? `$${totalCost.toLocaleString()}` : 'Budget TBD';
  const costGrad = ctx.createLinearGradient(W - PAD - 120, 0, W - PAD, 0);
  costGrad.addColorStop(0, C.accent);
  costGrad.addColorStop(1, C.cyan);
  ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = costGrad;
  ctx.fillText(costStr, W - PAD, headerY + 32);

  // ── Divider ───────────────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, 72);
  ctx.lineTo(W - PAD, 72);
  ctx.stroke();

  // ── Left column: Parts list ───────────────────────────────────────
  const colLeft = PAD;
  const colDivX = 480;
  const rowStart = 88;

  ctx.textAlign = 'left';
  ctx.font = '700 9px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text2;
  ctx.letterSpacing = '1px';
  ctx.fillText('COMPONENTS', colLeft, rowStart);
  ctx.letterSpacing = '0px';

  // Sort parts by priority
  const sortedParts = [...parts].sort((a, b) => {
    const ai = PRIORITY_LABELS.indexOf(a.label);
    const bi = PRIORITY_LABELS.indexOf(b.label);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const maxParts = 7;
  const displayParts = sortedParts.slice(0, maxParts);
  const rowH = 37;
  const partsY = rowStart + 16;

  displayParts.forEach((part, i) => {
    const y = partsY + i * rowH;

    // Row bg on alternating rows
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(colLeft - 6, y - 2, colDivX - colLeft + 6, rowH - 4, 6);
      } else {
        ctx.rect(colLeft - 6, y - 2, colDivX - colLeft + 6, rowH - 4);
      }
      ctx.fill();
    }

    // Label
    ctx.font = '600 9px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = C.text2;
    ctx.textAlign = 'left';
    ctx.fillText(part.label.toUpperCase(), colLeft, y + 8);

    // Name
    ctx.font = '500 12px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(truncate(part.name, 32), colLeft, y + 24);

    // Price
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = C.text2;
    ctx.textAlign = 'right';
    ctx.fillText(`$${part.price.toLocaleString()}`, colDivX - 10, y + 24);
    ctx.textAlign = 'left';
  });

  // Total cost row at bottom of parts
  const totalY = partsY + displayParts.length * rowH + 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(colLeft, totalY - 4);
  ctx.lineTo(colDivX - 10, totalY - 4);
  ctx.stroke();

  ctx.font = '600 11px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text2;
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL', colLeft, totalY + 10);

  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text;
  ctx.textAlign = 'right';
  ctx.fillText(costStr, colDivX - 10, totalY + 12);

  // ── Vertical divider ──────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(colDivX + 10, 80);
  ctx.lineTo(colDivX + 10, H - 50);
  ctx.stroke();

  // ── Right column: FPS estimates ───────────────────────────────────
  const colRight = colDivX + 30;

  ctx.textAlign = 'left';
  ctx.font = '700 9px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text2;
  ctx.fillText('FPS ESTIMATES · 1080p / High', colRight, rowStart);

  if (gpu && cpu) {
    const fpsRowH = 68;
    const fpsY = rowStart + 18;
    const barMaxW = W - PAD - colRight;

    FEATURED_GAMES.forEach((game, i) => {
      const y = fpsY + i * fpsRowH;
      const fps = estimateFpsForBuild(gpu, cpu, game, '1080p', 'high').estimated;
      const fpsColor = getFpsColor(fps);

      // Game name
      ctx.font = '500 12px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = C.text;
      ctx.textAlign = 'left';
      ctx.fillText(truncate(game.name, 26), colRight, y + 4);

      // FPS bar background
      const barY = y + 14;
      const barH = 20;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.roundRect(colRight, barY, barMaxW, barH, 4);
      ctx.fill();

      // FPS bar fill (capped at sensible max for display)
      const displayMax = 400;
      const barFill = Math.min(fps / displayMax, 1) * barMaxW;
      const barGrad = ctx.createLinearGradient(colRight, 0, colRight + barFill, 0);
      barGrad.addColorStop(0, fpsColor + 'CC');
      barGrad.addColorStop(1, fpsColor + '44');
      ctx.fillStyle = barGrad;
      ctx.beginPath();
      ctx.roundRect(colRight, barY, barFill, barH, 4);
      ctx.fill();

      // FPS value
      ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = fpsColor;
      ctx.textAlign = 'right';
      ctx.fillText(`${fps} FPS`, W - PAD, barY + 14);
    });
  } else {
    ctx.font = '13px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = C.text2;
    ctx.textAlign = 'left';
    ctx.fillText('Select GPU + CPU to see FPS estimates', colRight, rowStart + 60);
  }

  // ── Bottom bar ───────────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, H - 44);
  ctx.lineTo(W - PAD, H - 44);
  ctx.stroke();

  // URL
  ctx.font = '500 12px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text2;
  ctx.textAlign = 'left';
  ctx.fillText('specsmithpc.com', PAD, H - 22);

  // Tagline
  ctx.font = '500 11px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = C.text3;
  ctx.textAlign = 'right';
  ctx.fillText('Build smarter. Game better.', W - PAD, H - 22);

  // Bottom gradient bar
  drawGradientBar(ctx, H - 5, 5);

  return canvas;
}

export async function generateBuildCardBlob(options: BuildCardOptions): Promise<Blob> {
  const canvas = generateBuildCardCanvas(options);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate image'));
    }, 'image/png');
  });
}

export async function downloadBuildCard(options: BuildCardOptions): Promise<void> {
  const blob = await generateBuildCardBlob(options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'specsmith-build.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function copyBuildCardToClipboard(options: BuildCardOptions): Promise<void> {
  const blob = await generateBuildCardBlob(options);
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

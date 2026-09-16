#!/usr/bin/env tsx
/**
 * Build ONE rights-safe reference image of a generic premium gaming PC,
 * composed for image-to-3D conversion.
 *
 * Drawn as a fixed three-quarter projection in SVG rather than CSS 3D. A single
 * viewpoint means layer order is chosen explicitly, so the interior can be
 * painted behind a translucent glass panel — the exact thing CSS 3D could not
 * composite, where a bright magenta motherboard came out invisible.
 *
 * Composition rules for reliable conversion, applied deliberately:
 *   one closed object, whole silhouette inside the frame with margin,
 *   even lighting, no mirror floor, no smoke, no foreground occluder,
 *   nothing detached from the chassis, plain graduated backdrop.
 *
 * Rights: generic silhouette, no logo, wordmark, label, serial or readable text
 * of any kind. Product identity is added later as SpecSmith typography outside
 * the asset.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

type Point = readonly [number, number];

/** Corners of the two visible faces, in screen space on a 1024 canvas. */
const FRONT_TL: Point = [408, 268];
const FRONT_TR: Point = [706, 240];
const FRONT_BR: Point = [706, 796];
const FRONT_BL: Point = [408, 824];

const SIDE_TB: Point = [196, 322];   // side face, back-top
const SIDE_BB: Point = [196, 778];   // side face, back-bottom

/** Bilinear map of unit (u,v) onto a quad given as tl, tr, br, bl. */
function onQuad(tl: Point, tr: Point, br: Point, bl: Point, u: number, v: number): Point {
  const top: Point = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
  const bottom: Point = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
  return [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v];
}

const onFront = (u: number, v: number) => onQuad(FRONT_TL, FRONT_TR, FRONT_BR, FRONT_BL, u, v);
// Side face runs from the front edge (u=0) back to the rear edge (u=1).
const onSide = (u: number, v: number) => onQuad(FRONT_TL, SIDE_TB, SIDE_BB, FRONT_BL, u, v);

const poly = (pts: readonly Point[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** A quad in side-face space, as an SVG points string. */
function sideQuad(u0: number, v0: number, u1: number, v1: number): string {
  return poly([onSide(u0, v0), onSide(u1, v0), onSide(u1, v1), onSide(u0, v1)]);
}

function svg(): string {
  const parts: string[] = [];
  const push = (s: string) => parts.push(s);

  // ---- interior, painted before the glass ---------------------------------
  const interior: string[] = [];

  // Motherboard, standing against the far panel.
  interior.push(`<polygon points="${sideQuad(0.14, 0.09, 0.93, 0.80)}" fill="#191C25" stroke="#3E4355" stroke-width="2"/>`);
  // Socket-area heatsinks and VRM blocks. No text, no markings.
  interior.push(`<polygon points="${sideQuad(0.30, 0.16, 0.50, 0.34)}" fill="#5B6178" stroke="#9AA1B8" stroke-width="1.5"/>`);
  interior.push(`<polygon points="${sideQuad(0.16, 0.13, 0.27, 0.30)}" fill="#545A72" stroke="#949BB2" stroke-width="1.5"/>`);
  interior.push(`<polygon points="${sideQuad(0.16, 0.62, 0.40, 0.76)}" fill="#4C5268" stroke="#8C93AB" stroke-width="1.5"/>`);

  // Top-mounted radiator with fins, tubes running down to the pump.
  interior.push(`<polygon points="${sideQuad(0.18, 0.005, 0.88, 0.075)}" fill="#565C74" stroke="#98A0B8" stroke-width="2"/>`);
  for (let i = 0; i <= 16; i += 1) {
    const u = 0.20 + (i / 16) * 0.66;
    const a = onSide(u, 0.012);
    const b = onSide(u, 0.068);
    interior.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#AEB5C9" stroke-width="1.6"/>`);
  }

  // Pump block on the processor, with an illuminated ring.
  const pump = onSide(0.40, 0.25);
  interior.push(`<ellipse cx="${pump[0].toFixed(1)}" cy="${pump[1].toFixed(1)}" rx="46" ry="40" fill="#3C415350" />`);
  interior.push(`<ellipse cx="${pump[0].toFixed(1)}" cy="${pump[1].toFixed(1)}" rx="44" ry="38" fill="#3C4153" stroke="#727892" stroke-width="2"/>`);
  interior.push(`<ellipse cx="${pump[0].toFixed(1)}" cy="${pump[1].toFixed(1)}" rx="31" ry="26" fill="none" stroke="url(#rgbRing)" stroke-width="7" opacity="0.95"/>`);
  interior.push(`<ellipse cx="${pump[0].toFixed(1)}" cy="${pump[1].toFixed(1)}" rx="15" ry="12" fill="#464B5F"/>`);

  // Two braided tubes, pump to radiator. Attached at both ends; nothing floats.
  const tubeA0 = onSide(0.335, 0.20);
  const tubeA1 = onSide(0.30, 0.085);
  const tubeB0 = onSide(0.465, 0.20);
  const tubeB1 = onSide(0.54, 0.085);
  interior.push(`<path d="M ${tubeA0[0].toFixed(1)} ${tubeA0[1].toFixed(1)} C ${(tubeA0[0] - 34).toFixed(1)} ${(tubeA0[1] - 54).toFixed(1)}, ${(tubeA1[0] - 26).toFixed(1)} ${(tubeA1[1] + 40).toFixed(1)}, ${tubeA1[0].toFixed(1)} ${tubeA1[1].toFixed(1)}" fill="none" stroke="#545A70" stroke-width="15" stroke-linecap="round"/>`);
  interior.push(`<path d="M ${tubeB0[0].toFixed(1)} ${tubeB0[1].toFixed(1)} C ${(tubeB0[0] + 30).toFixed(1)} ${(tubeB0[1] - 56).toFixed(1)}, ${(tubeB1[0] + 20).toFixed(1)} ${(tubeB1[1] + 42).toFixed(1)}, ${tubeB1[0].toFixed(1)} ${tubeB1[1].toFixed(1)}" fill="none" stroke="#545A70" stroke-width="15" stroke-linecap="round"/>`);

  // Four memory sticks with plain lit diffusers.
  for (let i = 0; i < 4; i += 1) {
    const u0 = 0.585 + i * 0.052;
    interior.push(`<polygon points="${sideQuad(u0, 0.115, u0 + 0.034, 0.395)}" fill="#646A84" stroke="#A3AAC0" stroke-width="1.5"/>`);
    interior.push(`<polygon points="${sideQuad(u0 + 0.004, 0.120, u0 + 0.030, 0.150)}" fill="url(#rgbBar)" opacity="0.95"/>`);
  }

  // Graphics card: plain shroud, two fans, attached to the board.
  interior.push(`<polygon points="${sideQuad(0.15, 0.440, 0.90, 0.620)}" fill="#5A6078" stroke="#98A0B8" stroke-width="2"/>`);
  interior.push(`<polygon points="${sideQuad(0.15, 0.440, 0.90, 0.472)}" fill="#6D7490" opacity="0.9"/>`);
  for (const cu of [0.34, 0.66]) {
    const c = onSide(cu, 0.535);
    interior.push(`<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="46" ry="30" fill="#262A36" stroke="#98A0B8" stroke-width="1.6"/>`);
    for (let b = 0; b < 7; b += 1) {
      const ang = (b / 7) * Math.PI * 2;
      const x2 = c[0] + Math.cos(ang) * 39;
      const y2 = c[1] + Math.sin(ang) * 25;
      interior.push(`<line x1="${c[0].toFixed(1)}" y1="${c[1].toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#7E849C" stroke-width="3.4" stroke-linecap="round"/>`);
    }
    interior.push(`<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="10" ry="7" fill="#4A4F63"/>`);
  }

  // Power-supply shroud and braided cables, routed between fixed points.
  interior.push(`<polygon points="${sideQuad(0.10, 0.815, 0.95, 0.965)}" fill="#343949" stroke="#5B6076" stroke-width="2"/>`);
  const cableFrom = onSide(0.52, 0.815);
  const cableTo = onSide(0.60, 0.585);
  for (const [dx, w, col] of [[-14, 13, "#4A4F63"], [6, 11, "#2E3242"], [22, 9, "#4E5468"]] as const) {
    const f = onSide(0.50 + dx / 900, 0.812);
    const t = onSide(0.62 + dx / 900, 0.590);
    interior.push(`<path d="M ${f[0].toFixed(1)} ${f[1].toFixed(1)} C ${(f[0] + 26).toFixed(1)} ${(f[1] - 66).toFixed(1)}, ${(t[0] + 30).toFixed(1)} ${(t[1] + 62).toFixed(1)}, ${t[0].toFixed(1)} ${t[1].toFixed(1)}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`);
  }

  // ---- assemble -----------------------------------------------------------
  push(`<rect width="1024" height="1024" fill="url(#bg)"/>`);

  // Soft contact shadow. Grounds the tower without a mirror floor.
  push(`<ellipse cx="452" cy="846" rx="290" ry="34" fill="#9AA0B0" opacity="0.42" filter="url(#soft)"/>`);

  // Top panel.
  const topBackR: Point = [FRONT_TR[0] + (SIDE_TB[0] - FRONT_TL[0]), FRONT_TR[1] + (SIDE_TB[1] - FRONT_TL[1])];
  push(`<polygon points="${poly([FRONT_TL, FRONT_TR, topBackR, SIDE_TB])}" fill="url(#topMetal)" stroke="none"/>`);
  push(`<polygon points="${poly([FRONT_TL, FRONT_TR, topBackR, SIDE_TB])}" fill="none" stroke="#4A4F63" stroke-width="2"/>`);

  // Side aperture: interior sits inside this, then glass over the top.
  push(`<polygon points="${poly([FRONT_TL, SIDE_TB, SIDE_BB, FRONT_BL])}" fill="#21242E"/>`);
  push(`<g>${interior.join("")}</g>`);
  push(`<polygon points="${poly([FRONT_TL, SIDE_TB, SIDE_BB, FRONT_BL])}" fill="url(#glassTint)" opacity="0.16"/>`);
  push(`<polygon points="${poly([FRONT_TL, SIDE_TB, SIDE_BB, FRONT_BL])}" fill="none" stroke="#7D8598" stroke-width="5"/>`);

  // Front panel: perforated mesh, three lit fans.
  push(`<polygon points="${poly([FRONT_TL, FRONT_TR, FRONT_BR, FRONT_BL])}" fill="url(#frontMetal)" stroke="#4A4F63" stroke-width="2"/>`);
  push(`<polygon points="${poly([onFront(0.06, 0.03), onFront(0.94, 0.03), onFront(0.94, 0.97), onFront(0.06, 0.97)])}" fill="url(#mesh)" opacity="0.8"/>`);
  for (const fv of [0.185, 0.5, 0.815]) {
    const c = onFront(0.5, fv);
    push(`<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="104" ry="92" fill="#1B1E27" stroke="none"/>`);
    push(`<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="96" ry="85" fill="none" stroke="url(#rgbRing)" stroke-width="11" opacity="0.95"/>`);
    for (let b = 0; b < 9; b += 1) {
      const ang = (b / 9) * Math.PI * 2;
      const x2 = c[0] + Math.cos(ang) * 78;
      const y2 = c[1] + Math.sin(ang) * 69;
      push(`<line x1="${c[0].toFixed(1)}" y1="${c[1].toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#5C6179" stroke-width="9" stroke-linecap="round" opacity="0.92"/>`);
    }
    push(`<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="26" ry="23" fill="#2B2F3D" stroke="#4A4E63" stroke-width="2"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="#EDEEF2"/>
      <stop offset="62%" stop-color="#D8DAE1"/>
      <stop offset="100%" stop-color="#BFC2CC"/>
    </radialGradient>
    <linearGradient id="frontMetal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3C4052"/><stop offset="100%" stop-color="#23262F"/>
    </linearGradient>
    <linearGradient id="topMetal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4A4F62"/><stop offset="100%" stop-color="#2E323F"/>
    </linearGradient>
    <linearGradient id="glassTint" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#C9D4E8" stop-opacity="0.55"/>
      <stop offset="45%" stop-color="#8E9AB4" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#AEB8CC" stop-opacity="0.30"/>
    </linearGradient>
    <linearGradient id="rgbRing" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8B5CF6"/><stop offset="55%" stop-color="#22D3EE"/><stop offset="100%" stop-color="#A78BFA"/>
    </linearGradient>
    <linearGradient id="rgbBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#A78BFA"/><stop offset="100%" stop-color="#22D3EE"/>
    </linearGradient>
    <pattern id="mesh" width="13" height="13" patternUnits="userSpaceOnUse">
      <rect width="13" height="13" fill="#262A35"/>
      <circle cx="6.5" cy="6.5" r="2.1" fill="#171A22"/>
    </pattern>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>
  </defs>
  ${parts.join("\n  ")}
</svg>`;
}

async function main(): Promise<void> {
  const outDir = join(here, "generated");
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, "pc-reference.svg");
  await writeFile(path, svg(), "utf8");
  console.log(`wrote ${path}`);
}

main().catch((error: unknown) => {
  console.error("REFERENCE IMAGE BUILD FAILED:");
  console.error(error);
  process.exitCode = 1;
});

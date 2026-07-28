import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { loadModel, instantiateModel, type ModelName, type LoadedModel } from './modelLibrary';

// Stylized showcase 3D preview of the current build — a display-pedestal
// "hologram of your rig" rather than a render of specific SKUs (no licensed
// 3D models exist for real products). Parts spring into place as they're
// selected/revealed. Detail comes from procedural geometry only: spinning
// RGB fans, copper heatpipes, AIO tubing, circuit-trace textures, brushed
// metal, bloom-lit accents.
//
// Imperative three.js kept out of React on purpose: the Builder re-renders
// on every part click, and rebuilding a scene graph through a reconciler on
// each of those is wasted work. React owns the card shell (Build3D.tsx);
// this owns the canvas.

export interface Build3dParts {
  gpu: boolean;
  cpu: boolean;
  motherboard: boolean;
  ram: boolean;
  storage: boolean;
  psu: boolean;
  case: boolean;
  cooler: boolean;
  /** Raw cooler type from data ("Air", "240mm AIO", ...) — picks the mesh variant. */
  coolerType?: string;
  // Optional real-part details: pick which archetype model to show and how
  // big to render it, so an RTX 5090 visibly isn't an RX 6400.
  gpuTier?: number;
  gpuLengthMm?: number;
  coolerHeightMm?: number;
  caseFormFactor?: string;
  caseName?: string;
  moboFormFactor?: string;
  storageType?: string;
}

export interface Build3dScene {
  setParts(parts: Build3dParts): void;
  dispose(): void;
}

const ACCENT = 0x6c63ff;
const CYAN = 0x00d4ff;
const BG = 0x0b0c15;
const DARK_PLASTIC = 0x161a30;
const DARKER_PLASTIC = 0x10121f;
const GUNMETAL = 0x232941;
const COPPER = 0xc47a3a;

const PART_KEYS = ['case', 'motherboard', 'cpu', 'cooler', 'ram', 'gpu', 'psu', 'storage'] as const;
type PartKey = (typeof PART_KEYS)[number];

// ---------- shared animation registries (populated by builders) ----------
interface Spinner { obj: THREE.Object3D; speed: number; axis: 'x' | 'y' | 'z' }

interface BuildCtx {
  spinners: Spinner[];
  rgbMats: THREE.MeshBasicMaterial[];
  /** Guards against re-registering shared (cached-model) glow materials. */
  rgbSeen: Set<THREE.Material>;
}

// ---------- materials ----------
function plastic(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2, envMapIntensity: 0.7 });
}
function metal(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.85, envMapIntensity: 1.1 });
}
function glow(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}
function glass(): THREE.MeshPhysicalMaterial {
  // Barely-there tint: enough reflection to read as glass, not enough to
  // hide the parts behind it.
  return new THREE.MeshPhysicalMaterial({
    color: 0x99bbff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.05,
    envMapIntensity: 0.8, side: THREE.DoubleSide, depthWrite: false,
  });
}

function rbox(w: number, h: number, d: number, mat: THREE.Material, radius = 0.02): THREE.Mesh {
  const r = Math.min(radius, w / 2.01, h / 2.01, d / 2.01);
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat);
  mesh.castShadow = true;
  return mesh;
}
function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  return mesh;
}

// ---------- procedural textures ----------
function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const cnv = document.createElement('canvas');
  cnv.width = size;
  cnv.height = size;
  const ctx = cnv.getContext('2d');
  if (!ctx) return null;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cnv);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dark PCB with manhattan circuit traces and a few glowing vias. */
function pcbTexture(): THREE.CanvasTexture | null {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#131735';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#20265a';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 46; i++) {
      let x = Math.random() * s, y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let seg = 0; seg < 3; seg++) {
        if (Math.random() < 0.5) x = Math.max(0, Math.min(s, x + (Math.random() - 0.5) * 90));
        else y = Math.max(0, Math.min(s, y + (Math.random() - 0.5) * 90));
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const bright = Math.random() < 0.3;
      ctx.fillStyle = bright ? '#8f88ff' : '#2c3372';
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, bright ? 2.2 : 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Fine vertical fin stripes for radiators. */
function finTexture(): THREE.CanvasTexture | null {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#0d0f1c';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#1c2138';
    ctx.lineWidth = 1;
    for (let x = 0; x < s; x += 3) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, s);
      ctx.stroke();
    }
  });
}

/** Soft radial gradient, used for the backdrop glow and pedestal shadow. */
function radialTexture(inner: string, outer: string): THREE.CanvasTexture | null {
  return canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

// ---------- reusable sub-assemblies ----------

/** RGB case/cooler fan: frame, spinning blade set, glowing ring. */
function makeFan(ctx: BuildCtx, radius: number): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.13, 10, 36), plastic(DARKER_PLASTIC));
  g.add(frame);

  const blades = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.32, radius * 0.32, radius * 0.16, 20), plastic(GUNMETAL));
  hub.rotation.x = Math.PI / 2;
  blades.add(hub);
  const bladeGeo = new THREE.BoxGeometry(radius * 0.3, radius * 0.85, radius * 0.035);
  const bladeMat = plastic(0x1c2140);
  for (let i = 0; i < 7; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    const angle = (i / 7) * Math.PI * 2;
    blade.position.set(Math.cos(angle) * radius * 0.55, Math.sin(angle) * radius * 0.55, 0);
    blade.rotation.z = angle + Math.PI / 2;
    blade.rotation.y = 0.5; // blade pitch
    blades.add(blade);
  }
  g.add(blades);
  ctx.spinners.push({ obj: blades, speed: 3.2 + Math.random() * 1.5, axis: 'z' });

  const rgb = glow(ACCENT);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.82, radius * 0.05, 8, 36), rgb);
  ring.position.z = radius * 0.12;
  g.add(ring);
  ctx.rgbMats.push(rgb);
  return g;
}

/** Rubber tube following a curve — AIO lines, PSU cables. */
function makeTube(points: THREE.Vector3[], radius: number, color = 0x0d0f1c): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 24, radius, 8, false),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1 }),
  );
  mesh.castShadow = true;
  return mesh;
}

// ---------- part builders (case space: origin at case center) ----------

function buildCase(ctx: BuildCtx): THREE.Group {
  const g = new THREE.Group();
  const railMat = metal(0x1b1f36);
  const W = 2.0, H = 3.0, D = 3.4, T = 0.07;
  const hw = W / 2, hh = H / 2, hd = D / 2;

  // Frame: 12 rails
  const xRail = new RoundedBoxGeometry(W, T, T, 2, 0.02);
  const yRail = new RoundedBoxGeometry(T, H, T, 2, 0.02);
  const zRail = new RoundedBoxGeometry(T, T, D, 2, 0.02);
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(xRail, railMat); r.position.set(0, sy * hh, sz * hd); r.castShadow = true; g.add(r);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(yRail, railMat); r.position.set(sx * hw, 0, sz * hd); r.castShadow = true; g.add(r);
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const r = new THREE.Mesh(zRail, railMat); r.position.set(sx * hw, sy * hh, 0); r.castShadow = true; g.add(r);
  }

  // Solid right wall (motherboard tray side), top, bottom, back
  const wall = plastic(DARK_PLASTIC);
  const right = box(0.05, H - T, D - T, wall); right.position.x = hw - 0.02; g.add(right);
  const bottom = box(W - T, 0.05, D - T, wall); bottom.position.y = -hh + 0.02; g.add(bottom);
  const back = box(W - T, H - T, 0.05, wall); back.position.z = -hd + 0.02; g.add(back);
  // Vented top: slats
  for (let i = 0; i < 7; i++) {
    const slat = box(W - 0.3, 0.03, 0.16, plastic(DARKER_PLASTIC));
    slat.position.set(0, hh - 0.03, -hd + 0.5 + i * 0.42);
    g.add(slat);
  }

  // Glass: left side + front
  const glassMat = glass();
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.03, H - T, D - T), glassMat);
  left.position.x = -hw + 0.02;
  g.add(left);
  const front = new THREE.Mesh(new THREE.BoxGeometry(W - T, H - T, 0.03), glassMat);
  front.position.z = hd - 0.02;
  g.add(front);

  // Rear exhaust fan (visible through glass)
  const exhaust = makeFan(ctx, 0.24);
  exhaust.position.set(0.15, 0.95, -hd + 0.18);
  g.add(exhaust);
  // Front intake fans behind the front glass
  for (const y of [0.45, -0.35]) {
    const fan = makeFan(ctx, 0.24);
    fan.position.set(0.15, y, hd - 0.2);
    g.add(fan);
  }

  // Accent light strips on the two front vertical rails
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.025, H - 0.3, 0.025), glow(ACCENT));
    strip.position.set(sx * (hw - 0.001), 0, hd - 0.001);
    g.add(strip);
  }

  // Interior fill light — the panels shadow the key light, so without this
  // the parts inside the case read as murky silhouettes through the glass.
  const interior = new THREE.PointLight(0xaab4ff, 2.5, 3.5, 1.6);
  interior.position.set(-0.2, 0.9, 0.7);
  g.add(interior);

  // Feet
  const footGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.14, 16);
  const footMat = plastic(0x0c0e18);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.set(sx * (hw - 0.2), -hh - 0.07, sz * (hd - 0.25));
    foot.castShadow = true;
    g.add(foot);
  }
  return g;
}

function buildMotherboard(ctx: BuildCtx): THREE.Group {
  const g = new THREE.Group();
  const pcb = pcbTexture();
  const side = plastic(0x11142a);
  const faceMat = pcb
    ? new THREE.MeshStandardMaterial({ map: pcb, roughness: 0.6, metalness: 0.25, envMapIntensity: 0.6 })
    : side;
  // BoxGeometry material order: +x -x +y -y +z -z; the -x face looks at the glass.
  const plate = box(0.05, 2.3, 2.3, [side, faceMat, side, side, side, side]);
  g.add(plate);

  // I/O shroud with glowing edge
  const shroud = rbox(0.14, 0.55, 0.72, plastic(DARKER_PLASTIC), 0.03);
  shroud.position.set(-0.06, 0.82, -0.75);
  g.add(shroud);
  const shroudGlow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.6), glow(ACCENT));
  shroudGlow.position.set(-0.12, 1.05, -0.75);
  g.add(shroudGlow);
  ctx.rgbMats.push(shroudGlow.material as THREE.MeshBasicMaterial);

  // VRM heatsinks (brushed blocks flanking the CPU)
  const vrmTop = rbox(0.13, 0.16, 0.72, metal(GUNMETAL), 0.02);
  vrmTop.position.set(-0.05, 1.28, -0.45);
  g.add(vrmTop);
  const vrmSide = rbox(0.13, 0.62, 0.16, metal(GUNMETAL), 0.02);
  vrmSide.position.set(-0.05, 0.72, -1.0);
  g.add(vrmSide);

  // Chipset heatsink + M.2 shield lower on the board
  const chipset = rbox(0.09, 0.4, 0.42, metal(0x2a3050), 0.02);
  chipset.position.set(-0.04, -0.55, -0.55);
  g.add(chipset);
  const m2 = rbox(0.07, 0.2, 0.62, metal(0x262c4a), 0.02);
  m2.position.set(-0.03, -0.15, 0.15);
  g.add(m2);

  // Empty RAM + PCIe slots (filled visually when those parts land)
  const slotMat = plastic(0x0d0f1e);
  for (const z of [-0.02, 0.14]) {
    const slot = box(0.05, 0.98, 0.05, slotMat);
    slot.position.set(-0.02, 0.75, z);
    g.add(slot);
  }
  const pcie = box(0.05, 0.06, 0.95, slotMat);
  pcie.position.set(-0.02, 0.06, 0.28);
  g.add(pcie);

  g.position.set(0.92, 0.15, -0.15);
  return g;
}

function buildCpu(): THREE.Group {
  const g = new THREE.Group();
  const ihs = rbox(0.05, 0.32, 0.32, metal(0xb8bdd0), 0.015);
  g.add(ihs);
  // Socket retention frame
  const frameMat = plastic(0x0d0f1e);
  for (const [dy, dz, h, d] of [[0.2, 0, 0.05, 0.44], [-0.2, 0, 0.05, 0.44], [0, 0.2, 0.44, 0.05], [0, -0.2, 0.44, 0.05]] as const) {
    const bar = box(0.055, h, d, frameMat);
    bar.position.set(0.005, dy, dz);
    g.add(bar);
  }
  g.position.set(0.86, 0.75, -0.5);
  return g;
}

function buildAirCooler(ctx: BuildCtx): THREE.Group {
  const g = new THREE.Group();
  // Fin stack: horizontal plates
  const finMat = metal(0x3a415f);
  const finGeo = new THREE.BoxGeometry(0.5, 0.028, 0.42);
  for (let i = 0; i < 13; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.y = 0.5 + i * 0.045;
    fin.castShadow = i === 0 || i === 12;
    g.add(fin);
  }
  // Copper heatpipes rising through and proud of the stack
  const pipeMat = metal(COPPER);
  const pipeGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.75, 12);
  for (let i = 0; i < 4; i++) {
    const pipe = new THREE.Mesh(pipeGeo, pipeMat);
    pipe.position.set(0.2, 0.72, -0.15 + i * 0.1);
    g.add(pipe);
  }
  // Brushed top cap with a small glowing logo
  const cap = rbox(0.52, 0.04, 0.44, metal(GUNMETAL), 0.015);
  cap.position.y = 1.09;
  g.add(cap);
  const logo = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.045, 0.14), glow(CYAN));
  logo.position.y = 1.09;
  ctx.rgbMats.push(logo.material as THREE.MeshBasicMaterial);
  g.add(logo);
  // Fan on the glass-facing side
  const fan = makeFan(ctx, 0.22);
  fan.rotation.y = Math.PI / 2;
  fan.position.set(-0.31, 0.78, 0);
  g.add(fan);

  g.position.set(0.42, 0, -0.5); // stack sits over the CPU
  return g;
}

function buildAioCooler(ctx: BuildCtx): THREE.Group {
  const g = new THREE.Group();
  // Radiator with fin texture, mounted at the top
  const fins = finTexture();
  const radMat = fins
    ? new THREE.MeshStandardMaterial({ map: fins, roughness: 0.7, metalness: 0.4 })
    : plastic(DARKER_PLASTIC);
  const radiator = rbox(0.5, 0.16, 2.2, radMat, 0.03);
  radiator.position.set(0.25, 1.3, -0.1);
  g.add(radiator);
  // Fans under the radiator
  for (const z of [-0.62, 0.42]) {
    const fan = makeFan(ctx, 0.23);
    fan.rotation.x = Math.PI / 2;
    fan.position.set(0.25, 1.16, z);
    g.add(fan);
  }
  // Pump block on the CPU with glowing ring face
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 28), plastic(DARKER_PLASTIC));
  pump.rotation.z = Math.PI / 2;
  pump.position.set(0.76, 0.75, -0.5);
  pump.castShadow = true;
  g.add(pump);
  const pumpRgb = glow(CYAN);
  const pumpRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 32), pumpRgb);
  pumpRing.rotation.y = Math.PI / 2;
  pumpRing.position.set(0.685, 0.75, -0.5);
  g.add(pumpRing);
  ctx.rgbMats.push(pumpRgb);
  // Two coolant tubes from pump up to the radiator end
  g.add(makeTube([
    new THREE.Vector3(0.76, 0.82, -0.56), new THREE.Vector3(0.62, 1.05, -0.82), new THREE.Vector3(0.35, 1.24, -1.05),
  ], 0.032));
  g.add(makeTube([
    new THREE.Vector3(0.76, 0.82, -0.44), new THREE.Vector3(0.58, 1.02, -0.66), new THREE.Vector3(0.3, 1.22, -0.92),
  ], 0.032));
  return g;
}

function buildRam(ctx: BuildCtx): THREE.Group {
  const g = new THREE.Group();
  for (const z of [-0.02, 0.14]) {
    const stick = new THREE.Group();
    const spreader = rbox(0.34, 0.88, 0.05, metal(0x2a2f55), 0.02);
    stick.add(spreader);
    // Gold contact edge peeking from the slot
    const pins = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.056), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.35 }));
    pins.position.y = -0.44;
    stick.add(pins);
    // Full-length RGB diffuser on top
    const rgb = glow(ACCENT);
    const diffuser = rbox(0.34, 0.07, 0.055, rgb, 0.02);
    diffuser.position.y = 0.47;
    stick.add(diffuser);
    ctx.rgbMats.push(rgb);
    stick.position.set(0.72, 0.75, z);
    g.add(stick);
  }
  return g;
}

function buildGpu(ctx: BuildCtx): THREE.Group {
  const g = new THREE.Group();
  const shroud = rbox(0.85, 0.42, 1.92, plastic(0x171b36), 0.05);
  g.add(shroud);
  // Brushed backplate on top with a glowing logo slit
  const backplate = rbox(0.8, 0.03, 1.8, metal(GUNMETAL), 0.01);
  backplate.position.y = 0.22;
  g.add(backplate);
  const logoSlit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 0.07), glow(0xffffff));
  logoSlit.position.set(0, 0.22, -0.6);
  ctx.rgbMats.push(logoSlit.material as THREE.MeshBasicMaterial);
  g.add(logoSlit);
  // Triple fans on the glass-facing side
  for (const z of [-0.62, 0, 0.62]) {
    const fan = makeFan(ctx, 0.17);
    fan.rotation.y = Math.PI / 2;
    fan.position.set(-0.44, 0, z);
    g.add(fan);
  }
  // Accent strip along the top edge of the visible side
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 1.7), glow(CYAN));
  strip.position.set(-0.42, 0.19, 0);
  ctx.rgbMats.push(strip.material as THREE.MeshBasicMaterial);
  g.add(strip);
  // Rear I/O bracket
  const bracket = box(0.75, 0.4, 0.03, metal(0x8a90a8));
  bracket.position.z = -0.97;
  g.add(bracket);

  g.position.set(0.42, -0.15, 0.25);
  return g;
}

function buildPsu(): THREE.Group {
  const g = new THREE.Group();
  const body = rbox(1.68, 0.55, 1.05, plastic(DARKER_PLASTIC), 0.03);
  g.add(body);
  // Fan grille on the visible side: concentric rings
  const grilleMat = metal(0x30364f);
  for (const r of [0.08, 0.15, 0.22]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 28), grilleMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-0.85, 0, 0);
    g.add(ring);
  }
  // Glowing brand badge
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.02), glow(ACCENT));
  badge.position.set(-0.5, 0.06, 0.54);
  g.add(badge);
  // Braided cable runs climbing the motherboard tray
  g.add(makeTube([
    new THREE.Vector3(0.5, 0.3, -0.2), new THREE.Vector3(0.85, 0.9, -0.35), new THREE.Vector3(0.86, 1.5, -0.7),
  ], 0.035));
  g.add(makeTube([
    new THREE.Vector3(0.3, 0.3, 0.1), new THREE.Vector3(0.8, 0.7, 0.35), new THREE.Vector3(0.84, 1.1, 0.6),
  ], 0.028));

  g.position.set(0, -1.15, -1.05);
  return g;
}

function buildStorage(): THREE.Group {
  const g = new THREE.Group();
  const body = rbox(0.55, 0.09, 0.8, plastic(0x1a1e38), 0.02);
  g.add(body);
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.005, 0.6), plastic(0x394062));
  label.position.y = 0.048;
  g.add(label);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.05), glow(CYAN));
  led.position.set(0.2, 0.05, 0.3);
  g.add(led);
  g.position.set(0.35, -1.0, 0.85);
  return g;
}

// ---------- archetype-model placement ----------

/** Scene units per real-world millimeter (case interior ~3.4 units deep). */
const U = 0.00613;

interface Placement {
  rotation?: [number, number, number];
  /** World-axis rotations applied in order — unambiguous alternative to Euler. */
  worldRots?: ['x' | 'y' | 'z', number][];
  /** Uniform scale factor; mutually exclusive with fitInto. */
  uniformScale?: number;
  /** Non-uniform stretch to exactly this size (post-rotation). */
  fitInto?: [number, number, number];
  center: [number, number, number];
}

const WORLD_AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** Rotate, scale, then move so the instance's bbox center lands on target. */
function placeInstance(group: THREE.Group, p: Placement) {
  // Local bbox BEFORE rotating: scale applies in local space (M = T·R·S), so
  // fit ratios must be computed against local extents, mapped through the
  // rotation to the world axis each local axis ends up pointing along.
  const localSize = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  if (p.rotation) group.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
  if (p.worldRots) for (const [axis, angle] of p.worldRots) group.rotateOnWorldAxis(WORLD_AXES[axis], angle);
  if (p.fitInto) {
    const localArr = [localSize.x, localSize.y, localSize.z];
    const scales: number[] = [1, 1, 1];
    (['x', 'y', 'z'] as const).forEach((axis, i) => {
      const dir = WORLD_AXES[axis].clone().applyQuaternion(group.quaternion);
      const world = Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z) ? 0 : Math.abs(dir.y) >= Math.abs(dir.z) ? 1 : 2;
      scales[i] = p.fitInto![world] / localArr[i];
    });
    group.scale.set(scales[0], scales[1], scales[2]);
  } else if (p.uniformScale) {
    group.scale.setScalar(p.uniformScale);
  }
  const post = new THREE.Box3().setFromObject(group);
  const center = post.getCenter(new THREE.Vector3());
  group.position.add(new THREE.Vector3(...p.center).sub(center));
}

function gpuArchetype(tier?: number): ModelName {
  if (tier === undefined) return 'gpu-highend';
  if (tier >= 8) return 'gpu-flagship';
  if (tier >= 5) return 'gpu-highend';
  if (tier >= 3) return 'gpu-midrange';
  return 'gpu-compact';
}

function caseArchetype(formFactor?: string, name?: string): ModelName {
  if (formFactor === 'Full Tower') return 'case-fulltower';
  if (formFactor === 'Mini Tower') return 'case-compact';
  if (name && /air|flow|mesh|torrent/i.test(name)) return 'case-airflow';
  return 'case-midtower';
}

function coolerArchetype(type?: string, heightMm?: number): ModelName {
  if (type?.toUpperCase().includes('AIO')) {
    const mm = parseInt(type, 10);
    return mm >= 280 ? 'cooler-aio-360' : 'cooler-aio-240';
  }
  return (heightMm ?? 155) < 145 ? 'cooler-air-small' : 'cooler-air-big';
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    // Cached-model clones share geometry/materials with modelLibrary's cache
    // and with every other clone — never dispose those here.
    if (child.userData.shared) return;
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.map) std.map.dispose();
      m.dispose();
    }
  });
}

interface ManagedPart {
  group: THREE.Group;
  target: number;
  scale: number;
  velocity: number;
}

/**
 * Returns null when WebGL isn't available — the React wrapper shows a
 * plain-text fallback in that case.
 */
export function createBuild3dScene(container: HTMLElement): Build3dScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    return null;
  }

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BG, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  // pan-y: vertical touch scrolling passes through; horizontal drags rotate.
  renderer.domElement.style.touchAction = 'pan-y';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
  // Camera sits on the tempered-glass side (-X) so the default view looks
  // INTO the case at the parts, not at the motherboard-tray wall.
  camera.position.set(-4.6, 2.4, 5.2);
  camera.lookAt(0, -0.15, 0);

  // Image-based lighting for the PBR materials
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0x8890c0, 0x0c0e1c, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 6, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 5; key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const purpleLight = new THREE.PointLight(ACCENT, 26, 0, 1.8);
  purpleLight.position.set(-3, 2, 3);
  scene.add(purpleLight);
  const cyanLight = new THREE.PointLight(CYAN, 7, 0, 1.8);
  cyanLight.position.set(3, -0.5, -3);
  scene.add(cyanLight);

  // Backdrop glow so the rig doesn't float in a void
  const backGlowTex = radialTexture('rgba(108,99,255,0.20)', 'rgba(108,99,255,0)');
  if (backGlowTex) {
    const backGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: backGlowTex, depthWrite: false }));
    backGlow.scale.set(13, 10, 1);
    backGlow.position.set(0, 0.4, -5.5);
    scene.add(backGlow);
  }

  const rig = new THREE.Group();
  rig.rotation.y = 0.55;
  scene.add(rig);

  // Display pedestal (static, holds the whole show together)
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(2.45, 2.65, 0.16, 56),
    new THREE.MeshStandardMaterial({ color: 0x13152a, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.4 }),
  );
  pedestal.position.y = -1.78;
  pedestal.receiveShadow = true;
  rig.add(pedestal);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.018, 8, 72), glow(ACCENT));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -1.72;
  rig.add(rim);
  const floorGlowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
  if (floorGlowTex) {
    const soft = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: floorGlowTex, transparent: true, depthWrite: false }),
    );
    soft.rotation.x = -Math.PI / 2;
    soft.position.y = -1.69;
    rig.add(soft);
  }

  // Ghost outline of a case is always there, so the empty state reads as
  // "a rig waiting for parts" rather than a blank pedestal.
  const ghost = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.0, 3.0, 3.4)),
    new THREE.LineBasicMaterial({ color: 0x4a4f6a, transparent: true, opacity: 0.3 }),
  );
  rig.add(ghost);

  // Everything that isn't the pedestal sits slightly above it (case feet land on top)
  const parts = new THREE.Group();
  parts.position.y = -0.06;
  rig.add(parts);

  const buildCtx: BuildCtx = { spinners: [], rgbMats: [], rgbSeen: new Set() };
  const managed = new Map<PartKey, ManagedPart>();
  const signatures = new Map<PartKey, string>();
  let currentParts: Build3dParts | null = null;
  let needsRenderFlag = { set: () => {} }; // replaced below once needsRender exists

  function registerGlow(mats: THREE.MeshBasicMaterial[]) {
    for (const m of mats) {
      if (!buildCtx.rgbSeen.has(m)) {
        buildCtx.rgbSeen.add(m);
        buildCtx.rgbMats.push(m);
      }
    }
  }

  /** Async-attach an archetype model into a holder group; falls back to the
   * procedural builder if the GLB can't load. */
  function attachModel(
    holder: THREE.Group,
    name: ModelName,
    place: (model: LoadedModel) => Placement,
    fallback: (() => THREE.Group) | null,
    spinSpeed = 3.5,
  ) {
    loadModel(name)
      .then((model) => {
        if (holder.userData.dead) return;
        const inst = instantiateModel(model);
        // Shared cache resources — never disposed with the scene.
        inst.group.traverse((o) => { o.userData.shared = true; });
        placeInstance(inst.group, place(model));
        holder.add(inst.group);
        for (const s of inst.spinners) {
          buildCtx.spinners.push({ obj: s.obj, speed: spinSpeed + Math.random() * 1.2, axis: s.axis });
        }
        registerGlow(model.glowMats);
        needsRenderFlag.set();
      })
      .catch(() => {
        if (holder.userData.dead || !fallback) return;
        holder.add(fallback());
        needsRenderFlag.set();
      });
  }

  function radiatorLenMm(type?: string): number {
    const mm = parseInt(type ?? '', 10);
    return (Number.isFinite(mm) ? mm : 240) + 40; // radiator runs ~40mm past its fan span
  }

  const builders: Record<PartKey, () => THREE.Group> = {
    case: () => {
      const holder = new THREE.Group();
      const p = currentParts;
      attachModel(holder, caseArchetype(p?.caseFormFactor, p?.caseName),
        () => ({ fitInto: [2.0, 3.0, 3.4], center: [0, 0, 0] }),
        () => buildCase(buildCtx));
      // The case models ship fan cutouts but no fans — mount RGB fans.
      const fanPlacements: Placement[] = [
        { rotation: [0, 0, 0], uniformScale: 1, center: [0.15, 0.95, -1.42] },
        { rotation: [0, Math.PI, 0], uniformScale: 1, center: [0.15, 0.5, 1.42] },
        { rotation: [0, Math.PI, 0], uniformScale: 1, center: [0.15, -0.4, 1.42] },
      ];
      for (const fp of fanPlacements) {
        attachModel(holder, 'fan-rgb-120',
          (m) => ({ ...fp, uniformScale: 0.5 / Math.max(m.size.x, m.size.y) }),
          null, 5);
      }
      return holder;
    },
    motherboard: () => {
      const holder = new THREE.Group();
      const matx = /m|itx/i.test(currentParts?.moboFormFactor ?? 'ATX');
      // Model lies flat (components +Y); stand it against the tray wall with
      // components facing the glass (-X).
      attachModel(holder, matx ? 'motherboard-matx' : 'motherboard-atx',
        () => matx
          ? ({ rotation: [0, 0, Math.PI / 2], fitInto: [0.25, 1.88, 1.88], center: [0.85, 0.35, -0.3] })
          : ({ rotation: [0, 0, Math.PI / 2], fitInto: [0.25, 2.35, 1.88], center: [0.85, 0.15, -0.15] }),
        () => buildMotherboard(buildCtx));
      return holder;
    },
    cpu: () => {
      const holder = new THREE.Group();
      attachModel(holder, 'cpu-chip',
        (m) => ({ rotation: [0, 0, Math.PI / 2], uniformScale: 0.34 / m.size.x, center: [0.7, 0.75, -0.5] }),
        () => buildCpu());
      return holder;
    },
    cooler: () => {
      const holder = new THREE.Group();
      const p = currentParts;
      const arch = coolerArchetype(p?.coolerType, p?.coolerHeightMm);
      if (arch.includes('aio')) {
        // Radiator runs along model X with the pump hanging +Z; lay the
        // radiator flat under the case roof (pump down), run it front-to-back.
        attachModel(holder, arch,
          (m) => ({
            worldRots: [['x', Math.PI / 2], ['y', -Math.PI / 2]],
            uniformScale: (radiatorLenMm(p?.coolerType) * U) / m.size.x,
            center: [0.35, 1.02, -0.2],
          }),
          () => buildAioCooler(buildCtx));
      } else {
        const heightMm = Math.min(170, Math.max(120, p?.coolerHeightMm ?? 155));
        attachModel(holder, arch,
          (m) => ({ uniformScale: (heightMm * U * 1.35) / m.size.y, center: [0.5, 0.85, -0.5] }),
          () => buildAirCooler(buildCtx));
      }
      return holder;
    },
    ram: () => {
      const holder = new THREE.Group();
      for (const z of [-0.02, 0.14]) {
        // Stick stands up (length → Y), RGB diffuser toward the glass (-X).
        attachModel(holder, 'ram-rgb',
          (m) => ({ rotation: [0, 0, Math.PI / 2], uniformScale: 0.85 / m.size.x, center: [0.7, 0.75, z] }),
          null);
      }
      // Procedural fallback for the pair is handled once, via the first slot
      // failing: modelLibrary caches the rejection, so both attach calls fail
      // together — add the fallback on the first.
      loadModel('ram-rgb').catch(() => {
        if (!holder.userData.dead) holder.add(buildRam(buildCtx));
      });
      return holder;
    },
    gpu: () => {
      const holder = new THREE.Group();
      const p = currentParts;
      const lengthMm = Math.min(360, Math.max(160, p?.gpuLengthMm ?? 300));
      // Length (model X) runs front-to-back (Z); fans stay up and visible.
      attachModel(holder, gpuArchetype(p?.gpuTier),
        (m) => ({ rotation: [0, -Math.PI / 2, 0], uniformScale: (lengthMm * U) / m.size.x, center: [0.35, -0.15, 0.25] }),
        () => buildGpu(buildCtx));
      return holder;
    },
    psu: () => {
      const holder = new THREE.Group();
      attachModel(holder, 'psu-atx',
        (m) => ({ uniformScale: 1.0 / m.size.z, center: [0.3, -1.16, -1.05] }),
        () => buildPsu());
      return holder;
    },
    storage: () => {
      const holder = new THREE.Group();
      const nvme = currentParts?.storageType?.toUpperCase().includes('NVME');
      if (nvme) {
        // Vertical on the board, heatsink toward the glass.
        attachModel(holder, 'ssd-nvme',
          (m) => ({ rotation: [0, 0, Math.PI / 2], uniformScale: 0.6 / m.size.x, center: [0.72, -0.3, 0.1] }),
          () => buildStorage());
      } else {
        attachModel(holder, 'ssd-25',
          (m) => ({ uniformScale: 0.55 / m.size.x, center: [0.35, -1.0, 0.85] }),
          () => buildStorage());
      }
      return holder;
    },
  };

  function pruneAnimRegistries(removed: THREE.Group) {
    const gone = new Set<THREE.Object3D>();
    removed.traverse((o) => gone.add(o));
    buildCtx.spinners = buildCtx.spinners.filter((s) => !gone.has(s.obj));
    const goneMats = new Set<THREE.Material>();
    removed.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.material && !Array.isArray(mesh.material)) goneMats.add(mesh.material);
    });
    buildCtx.rgbMats = buildCtx.rgbMats.filter((m) => !goneMats.has(m));
  }

  function ensurePart(partKey: PartKey): ManagedPart {
    let entry = managed.get(partKey);
    if (!entry) {
      const group = builders[partKey]();
      group.scale.setScalar(0.001);
      group.visible = false;
      parts.add(group);
      entry = { group, target: 0, scale: 0.001, velocity: 0 };
      managed.set(partKey, entry);
    }
    return entry;
  }

  let needsRender = true;
  needsRenderFlag = { set: () => { needsRender = true; } };

  /** Detail fields that force a rebuild of a part's mesh when they change
   * (different archetype or different real-world size). */
  function signatureFor(key: PartKey, p: Build3dParts): string {
    switch (key) {
      case 'gpu': return `${gpuArchetype(p.gpuTier)}|${p.gpuLengthMm ?? 0}`;
      case 'cooler': return `${coolerArchetype(p.coolerType, p.coolerHeightMm)}|${p.coolerType ?? ''}|${p.coolerHeightMm ?? 0}`;
      case 'case': return caseArchetype(p.caseFormFactor, p.caseName);
      case 'motherboard': return /m|itx/i.test(p.moboFormFactor ?? 'ATX') ? 'matx' : 'atx';
      case 'storage': return p.storageType?.toUpperCase().includes('NVME') ? 'nvme' : 'sata';
      default: return '';
    }
  }

  function setParts(next: Build3dParts) {
    currentParts = next;
    for (const partKey of PART_KEYS) {
      const sig = signatureFor(partKey, next);
      const existing = managed.get(partKey);
      if (existing && signatures.get(partKey) !== sig) {
        existing.group.userData.dead = true;
        parts.remove(existing.group);
        pruneAnimRegistries(existing.group);
        disposeObject(existing.group);
        managed.delete(partKey);
      }
      signatures.set(partKey, sig);
      const want = next[partKey];
      const entry = ensurePart(partKey);
      entry.target = want ? 1 : 0;
      if (reducedMotion) {
        entry.scale = entry.target === 1 ? 1 : 0.001;
        entry.velocity = 0;
        entry.group.scale.setScalar(entry.scale);
        entry.group.visible = entry.target === 1;
      }
    }
    needsRender = true;
  }

  // ---- Post-processing: bloom makes the neon actually glow ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Drag to rotate ----
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastInteraction = 0;

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    lastInteraction = performance.now();
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    rig.rotation.y += dx * 0.008;
    if (e.pointerType !== 'touch') {
      rig.rotation.x = Math.max(-0.3, Math.min(0.4, rig.rotation.x + dy * 0.004));
    }
    lastInteraction = performance.now();
    needsRender = true;
  }
  function onPointerUp() {
    dragging = false;
    lastInteraction = performance.now();
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  // ---- Sizing ----
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsRender = true;
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // ---- Render loop: paused when offscreen or the tab is hidden ----
  let rafId: number | null = null;
  let onScreen = true;
  let lastTime = 0;
  let disposed = false;

  function anyPartVisible(): boolean {
    for (const entry of managed.values()) if (entry.group.visible) return true;
    return false;
  }

  function frame(time: number) {
    rafId = null;
    if (disposed) return;
    const dt = Math.min(0.05, lastTime === 0 ? 0.016 : (time - lastTime) / 1000);
    lastTime = time;

    let animating = false;

    if (!reducedMotion) {
      // Auto-rotate, pausing briefly after the user interacts.
      if (!dragging && time - lastInteraction > 2500) {
        rig.rotation.y += dt * 0.22;
        needsRender = true;
      }
      // Spring each part toward its target scale (slightly underdamped for
      // a small overshoot "pop" when a part lands).
      for (const entry of managed.values()) {
        const delta = entry.target - entry.scale;
        if (Math.abs(delta) > 0.001 || Math.abs(entry.velocity) > 0.001) {
          entry.velocity += delta * 120 * dt;
          entry.velocity *= Math.max(0, 1 - 14 * dt);
          entry.scale += entry.velocity * dt;
          const s = Math.max(0.001, entry.scale);
          entry.group.scale.setScalar(s);
          entry.group.visible = entry.scale > 0.01 || entry.target === 1;
          animating = true;
        } else if (entry.target === 0 && entry.group.visible) {
          entry.group.visible = false;
          needsRender = true;
        }
      }
      // Fans spin and RGB cycles while any part is on stage
      if (anyPartVisible()) {
        for (const s of buildCtx.spinners) s.obj.rotation[s.axis] += s.speed * dt;
        const t = time * 0.00006;
        buildCtx.rgbMats.forEach((m, i) => m.color.setHSL((t + i * 0.09) % 1, 0.75, 0.62));
        animating = true;
      }
    }

    if (needsRender || animating) {
      composer.render();
      needsRender = false;
    }
    scheduleFrame();
  }

  function scheduleFrame() {
    if (disposed || rafId !== null) return;
    if (!onScreen || document.visibilityState === 'hidden') return;
    rafId = requestAnimationFrame(frame);
  }

  const intersectionObserver = new IntersectionObserver((entries) => {
    onScreen = entries[0]?.isIntersecting ?? true;
    if (onScreen) {
      lastTime = 0;
      scheduleFrame();
    }
  });
  intersectionObserver.observe(container);

  function onVisibilityChange() {
    lastTime = 0;
    scheduleFrame();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  scheduleFrame();

  function dispose() {
    disposed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    intersectionObserver.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    disposeObject(scene);
    scene.environment?.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setParts, dispose };
}

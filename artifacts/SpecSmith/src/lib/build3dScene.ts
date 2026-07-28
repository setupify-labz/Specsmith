import * as THREE from 'three';

// Stylized neon-schematic 3D preview of the current build. Deliberately NOT
// photorealistic: we have no licensed 3D models of real products, so every
// part is a low-poly stand-in lit in the site's accent palette — a "hologram
// of your rig" rather than a render of specific SKUs. Parts spring into
// place as they're selected in the Builder.
//
// This module is imperative three.js kept out of React on purpose: the
// Builder re-renders on every part click, and rebuilding a scene graph
// through a reconciler on each of those is wasted work. React owns the card
// shell (Build3D.tsx); this owns the canvas.

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
}

export interface Build3dScene {
  setParts(parts: Build3dParts): void;
  dispose(): void;
}

const ACCENT = 0x6c63ff;
const CYAN = 0x00d4ff;
const BODY_DARK = 0x181b30;
const BODY_DARKER = 0x11131f;
const GHOST_EDGE = 0x4a4f6a;

const PART_KEYS = ['case', 'motherboard', 'cpu', 'cooler', 'ram', 'gpu', 'psu', 'storage'] as const;
type PartKey = (typeof PART_KEYS)[number];

function bodyMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 });
}

function glowMat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

function edges(geo: THREE.BufferGeometry, color: number, opacity = 0.9): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );
}

/** Dark slab with neon edge lines — the basic vocabulary of every part here. */
function neonBox(w: number, h: number, d: number, body: number, edge: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  g.add(new THREE.Mesh(geo, bodyMat(body)));
  g.add(edges(geo, edge));
  return g;
}

function glowRing(radius: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, 0.022, 8, 32), glowMat(color));
}

// ---- Part builders (positions are in "case space", origin at case center) ----

function buildCase(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(2.0, 3.0, 3.4);
  const glass = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }),
  );
  g.add(glass);
  g.add(edges(geo, ACCENT, 0.85));
  return g;
}

function buildMotherboard(): THREE.Group {
  const g = neonBox(0.06, 2.3, 2.3, BODY_DARK, ACCENT);
  g.position.set(0.92, 0.15, -0.15);
  return g;
}

function buildCpu(): THREE.Group {
  const g = new THREE.Group();
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.34), glowMat(ACCENT));
  g.add(chip);
  g.position.set(0.86, 0.75, -0.5);
  return g;
}

function buildAirCooler(): THREE.Group {
  const g = new THREE.Group();
  const tower = neonBox(0.6, 0.62, 0.44, BODY_DARKER, CYAN);
  g.add(tower);
  const fan = glowRing(0.16, CYAN);
  fan.rotation.y = Math.PI / 2;
  fan.position.set(-0.33, 0, 0);
  g.add(fan);
  g.position.set(0.5, 0.75, -0.5);
  return g;
}

function buildAioCooler(): THREE.Group {
  const g = new THREE.Group();
  const radiator = neonBox(0.55, 0.14, 2.2, BODY_DARKER, CYAN);
  radiator.position.set(0.3, 1.32, -0.1);
  g.add(radiator);
  for (const z of [-0.65, 0.45]) {
    const fan = glowRing(0.2, CYAN);
    fan.rotation.x = Math.PI / 2;
    fan.position.set(0.3, 1.22, z);
    g.add(fan);
  }
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 24), bodyMat(BODY_DARKER));
  pump.rotation.z = Math.PI / 2;
  pump.position.set(0.8, 0.75, -0.5);
  g.add(pump);
  const pumpGlow = glowRing(0.12, CYAN);
  pumpGlow.rotation.y = Math.PI / 2;
  pumpGlow.position.set(0.73, 0.75, -0.5);
  g.add(pumpGlow);
  return g;
}

function buildRam(): THREE.Group {
  const g = new THREE.Group();
  for (const z of [-0.02, 0.14]) {
    const stick = neonBox(0.36, 0.9, 0.05, BODY_DARK, ACCENT);
    stick.position.set(0.72, 0.75, z);
    g.add(stick);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.055), glowMat(CYAN));
    strip.position.set(0.72, 1.22, z);
    g.add(strip);
  }
  return g;
}

function buildGpu(): THREE.Group {
  const g = new THREE.Group();
  const shell = neonBox(0.85, 0.42, 1.9, BODY_DARK, ACCENT);
  g.add(shell);
  for (const z of [-0.5, 0.5]) {
    const fan = glowRing(0.17, ACCENT);
    fan.rotation.y = Math.PI / 2;
    fan.position.set(-0.44, 0, z);
    g.add(fan);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.04, 0.06), glowMat(CYAN));
  strip.position.set(0, 0.23, -0.92);
  g.add(strip);
  g.position.set(0.42, -0.15, 0.25);
  return g;
}

function buildPsu(): THREE.Group {
  const g = neonBox(1.7, 0.55, 1.05, BODY_DARKER, GHOST_EDGE);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), glowMat(ACCENT));
  badge.position.set(-0.5, 0, 0.54);
  g.add(badge);
  g.position.set(0, -1.15, -1.05);
  return g;
}

function buildStorage(): THREE.Group {
  const g = neonBox(0.55, 0.09, 0.8, BODY_DARK, CYAN);
  g.position.set(0.35, -1.0, 0.85);
  return g;
}

/** Soft radial "shadow" under the rig, drawn as a canvas gradient texture. */
function buildFloorShadow(): THREE.Mesh | null {
  const size = 128;
  const cnv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cnv) return null;
  cnv.width = size;
  cnv.height = size;
  const ctx = cnv.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cnv);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 4.6),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.68;
  return mesh;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
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
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  // pan-y: vertical touch scrolling passes through; horizontal drags rotate.
  renderer.domElement.style.touchAction = 'pan-y';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(3.8, 2.5, 4.8);
  camera.lookAt(0, -0.05, 0);

  scene.add(new THREE.AmbientLight(0x8888aa, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 4, 2);
  scene.add(key);
  const purple = new THREE.PointLight(ACCENT, 14, 0, 1.6);
  purple.position.set(-2.5, 1.5, 2.5);
  scene.add(purple);
  const cyan = new THREE.PointLight(CYAN, 8, 0, 1.6);
  cyan.position.set(2.5, -1, -2.5);
  scene.add(cyan);

  const rig = new THREE.Group();
  rig.rotation.y = -0.55;
  scene.add(rig);

  // Ghost outline of a case is always there, so the empty state reads as
  // "a rig waiting for parts" rather than a blank void.
  const ghostGeo = new THREE.BoxGeometry(2.0, 3.0, 3.4);
  const ghost = edges(ghostGeo, GHOST_EDGE, 0.35);
  rig.add(ghost);
  const shadow = buildFloorShadow();
  if (shadow) rig.add(shadow);

  const managed = new Map<PartKey, ManagedPart>();
  let coolerVariant: 'air' | 'aio' = 'air';

  const builders: Record<PartKey, () => THREE.Group> = {
    case: buildCase,
    motherboard: buildMotherboard,
    cpu: buildCpu,
    cooler: () => (coolerVariant === 'aio' ? buildAioCooler() : buildAirCooler()),
    ram: buildRam,
    gpu: buildGpu,
    psu: buildPsu,
    storage: buildStorage,
  };

  function ensurePart(partKey: PartKey): ManagedPart {
    let entry = managed.get(partKey);
    if (!entry) {
      const group = builders[partKey]();
      group.scale.setScalar(0.001);
      group.visible = false;
      rig.add(group);
      entry = { group, target: 0, scale: 0.001, velocity: 0 };
      managed.set(partKey, entry);
    }
    return entry;
  }

  let needsRender = true;

  function setParts(parts: Build3dParts) {
    const nextVariant: 'air' | 'aio' = parts.coolerType?.toUpperCase().includes('AIO') ? 'aio' : 'air';
    if (nextVariant !== coolerVariant) {
      const existing = managed.get('cooler');
      if (existing) {
        rig.remove(existing.group);
        disposeObject(existing.group);
        managed.delete('cooler');
      }
      coolerVariant = nextVariant;
    }
    for (const partKey of PART_KEYS) {
      const want = parts[partKey];
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
      rig.rotation.x = Math.max(-0.35, Math.min(0.5, rig.rotation.x + dy * 0.004));
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

  function frame(time: number) {
    rafId = null;
    if (disposed) return;
    const dt = Math.min(0.05, lastTime === 0 ? 0.016 : (time - lastTime) / 1000);
    lastTime = time;

    let animating = false;

    if (!reducedMotion) {
      // Auto-rotate, pausing briefly after the user interacts.
      if (!dragging && time - lastInteraction > 2500) {
        rig.rotation.y += dt * 0.25;
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
    }

    if (needsRender || animating) {
      renderer.render(scene, camera);
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
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setParts, dispose };
}

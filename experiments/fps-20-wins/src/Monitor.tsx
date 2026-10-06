// "20 wins. Only 4 FPS apart.": the monitor-entry cut.
//
// A stylised gaming desk with a landscape (16:9) monitor and a PC beside it.
// The monitor already shows the comparison, laid out for its wide screen: the
// two GPUs on the left, the 20-game counter on the right. The camera pushes
// into the screen until the screen covers the vertical frame; during the push
// the two blocks glide and scale (uniformly, never stretched) into the layout
// designed for the full vertical frame. The pullback returns to the same
// landscape monitor for the final question.
//
// Times come from monitorplan.json (monitor/plan.mjs, from the saved Liam take's
// timestamps and measured silences); figures come from verified.json through
// `display`, which voice/check.mjs compares with the Compare model before a
// render is accepted. Only verified figures are ever drawn.
//
// Colours are SpecSmith's own tokens (artifacts/SpecSmith/src/index.css).
// The hardware is illustrative graphics, not a tested physical system.

import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export type MonitorProps = {
  plan: {
    duration: number;
    events: {
      voiceStart: number; entry: [number, number]; counterStart: number; spots: number[]; rollTo20: number; land: number;
      blowout: number; dropStart: number; reveal: number; numbers: number; n160: number; apart: number; four: number;
      pullBack: number; question: number; lastWord: number;
    };
    captions: { show: string; lines: string[]; start: number; end: number }[];
  };
  display: {
    gpuA: string; gpuB: string; cpu: string; setting: string; games: number; leadsA: number; ties: number; leadsB: number;
    avgA: number; avgB: number; gap: number; spotlights: { title: string; rosterPosition: number }[];
  };
  audio: string;
};
type Events = MonitorProps["plan"]["events"];
type Display = MonitorProps["display"];

const FONT = "Inter, sans-serif";
// --ff-bg, --ff-surface, --ff-card, --ff-text, --ff-text-2/3, --ff-accent, --ff-accent-text, --ff-cyan, --ff-border
const C = {
  bg: "#0A0A0F", surface: "#13131A", card: "#1C1C26", ink: "#F0F0FF", text2: "#8888AA", text3: "#8686B0",
  accent: "#6C63FF", sup: "#9B94FF", base: "#00D4FF", border: "rgba(255,255,255,0.08)", muted: "#B7B7D1",
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);
const easeOut = Easing.bezier(0.15, 0.85, 0.3, 1);
const lerp = (t: number, [t0, t1]: [number, number], [a, b]: [number, number], e = ease) => interpolate(t, [t0, t1], [a, b], { ...clamp, easing: e });
const mix = (a: number, b: number, m: number) => a + (b - a) * m;

// ---- Geometry ------------------------------------------------------------------------
// The opening frame: a 16:9 screen (SW x SH) at (SX, SY). Landscape screen content is
// designed on a 1920x1080 canvas, so one screen unit is SW / 1920 frame pixels at z = 1.
const SX = 50, SY = 500, SW = 776, SH = 437; // 776 x 437 is 16:9; the bezel sits 36 px from the left edge
const W = 1080, H = 1920;
// The push has two phases on one continuous, eased zoom. First the screen's centre
// glides to the frame's centre while the screen grows until its width fills the frame
// (z = Z1); the landscape content rides with it. Then the screen keeps growing until it
// covers the whole vertical frame (z = Z_IN) while the content re-flows into the
// vertical layout. The pullback returns to exactly the opening framing.
const Z1 = W / SW; // 1.39: screen width = frame width
const Z_IN = (H / SH) * 1.06; // a little past screen height = frame height, so the bezel clears early
const Q1 = Math.log(Z1) / Math.log(Z_IN);
const SCX = SX + SW / 2, SCY = SY + SH / 2;
const smooth = (x: number, a: number, b: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
type Cam = { z: number; cx: number; cy: number; q: number };
function camAt(t: number, e: Events): Cam {
  const [a, b] = e.entry;
  const q = lerp(t, [a, b], [0, 1], Easing.bezier(0.5, 0, 0.3, 1));
  const k = smooth(q, 0, Q1 * 1.15);
  let z = Math.pow(Z_IN, q), cx = mix(SCX, W / 2, k), cy = mix(SCY, H / 2, k);
  const o = lerp(t, [e.pullBack, e.pullBack + 0.85], [0, 1], Easing.bezier(0.45, 0, 0.2, 1));
  if (o > 0) {
    // Back to exactly the opening framing: the same desk, monitor and tower.
    z = Math.exp(mix(Math.log(z), 0, o));
    cx = mix(cx, SCX, o);
    cy = mix(cy, SCY, o);
  }
  return { z, cx, cy, q };
}
/** A world layer at depth d: the screen centre goes to the camera centre, scaled by z^d about it. */
const layer = (c: Cam, depth: number): React.CSSProperties => ({ transformOrigin: `${SCX}px ${SCY}px`, transform: `translate(${c.cx - SCX}px, ${c.cy - SCY}px) scale(${Math.pow(c.z, depth)})` });
/** Where the screen is on the frame (optionally at a smaller zoom about the same centre). */
function screenRect(c: Cam, z = c.z) {
  return { x: c.cx - (SW * z) / 2, y: c.cy - (SH * z) / 2, w: SW * z, h: SH * z };
}

// ---- The desk scene (opening-frame coordinates) -----------------------------------------
const Fan: React.FC<{ cx: number; cy: number; r: number; angle: number; ring: string }> = ({ cx, cy, r, angle, ring }) => (
  <g transform={`translate(${cx} ${cy})`}>
    <circle r={r + 5} fill="none" stroke={ring} strokeWidth={8} opacity={0.2} />
    <circle r={r} fill="#101019" stroke={ring} strokeWidth={5} />
    <circle r={r - 6} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1.5} />
    <g transform={`rotate(${angle})`}>
      {Array.from({ length: 7 }, (_, i) => (
        <path key={i} transform={`rotate(${(i * 360) / 7})`} d={`M ${r * 0.2} -6 C ${r * 0.45} -${r * 0.45}, ${r * 0.82} -${r * 0.36}, ${r * 0.88} -${r * 0.06} C ${r * 0.62} 0, ${r * 0.38} 3, ${r * 0.2} 6 Z`} fill="#55557A" stroke="#7474A0" strokeWidth={1.2} />
      ))}
    </g>
    <circle r={r * 0.22} fill="#1C1C26" stroke="#7474A0" strokeWidth={2} />
    <circle r={r * 0.08} fill={ring} />
  </g>
);

const Wall: React.FC<{ t: number }> = ({ t }) => {
  const pulse = 0.85 + 0.15 * Math.sin(t * 1.6);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, #0D0D17 0%, #0B0B12 55%, #0A0A0F 100%)" }} />
      {/* The screen lights the wall behind it (violet); the PC's RGB adds cyan. */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 620px 470px at ${SCX}px ${SCY}px, rgba(108,99,255,${0.5 * pulse}), transparent 72%)` }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 260px 480px at 950px 900px, rgba(0,212,255,0.20), transparent 70%)" }} />
      {/* A wall light strip above the desk. */}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="strip" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={C.accent} />
            <stop offset="1" stopColor={C.base} />
          </linearGradient>
        </defs>
        <rect x={70} y={404} width={940} height={5} rx={2.5} fill="url(#strip)" opacity={0.7} />
        <rect x={70} y={397} width={940} height={19} rx={9.5} fill="url(#strip)" opacity={0.1} />
      </svg>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 560px 120px at 540px 403px, rgba(108,99,255,0.18), transparent 70%)" }} />
    </AbsoluteFill>
  );
};

const DeskAndHardware: React.FC<{ t: number }> = ({ t }) => {
  const angle = t * 330; // a little under one turn a second: clearly spinning at 30 fps
  const hue = (Math.sin(t * 1.3) + 1) / 2;
  const ringA = hue < 0.5 ? C.sup : C.base, ringB = hue < 0.5 ? C.base : C.sup;
  const DESK = 1160;
  // The tower: slimmer, beside the monitor, with clear space to the frame's right edge.
  const PX = 872, PW = 158, PT = 640, FX = PX + PW / 2;
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="desk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22222F" />
          <stop offset="1" stopColor="#14141C" />
        </linearGradient>
        <radialGradient id="spill" cx={SCX / W} cy="0" r="0.75">
          <stop offset="0" stopColor="rgba(108,99,255,0.48)" />
          <stop offset="0.55" stopColor="rgba(108,99,255,0.12)" />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <radialGradient id="cyanSpill" cx={FX / W} cy="0" r="0.3">
          <stop offset="0" stopColor="rgba(0,212,255,0.22)" />
          <stop offset="1" stopColor="rgba(0,212,255,0)" />
        </radialGradient>
        <linearGradient id="caseFront" x1="0" y1="0" x2="1" y2="0">
          {/* Screen light from the left falls on the case. */}
          <stop offset="0" stopColor="#2A2840" />
          <stop offset="0.35" stopColor="#1E1E2B" />
          <stop offset="1" stopColor="#16161F" />
        </linearGradient>
        <linearGradient id="neck" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2C2C3C" />
          <stop offset="0.5" stopColor="#40405A" />
          <stop offset="1" stopColor="#202030" />
        </linearGradient>
        <linearGradient id="bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#15151F" />
          <stop offset="1" stopColor="#0D0D14" />
        </linearGradient>
      </defs>
      {/* Desk: top, the screen's light and the tower's cyan on it, a lit front edge. */}
      <rect x={-60} y={DESK} width={1200} height={300} fill="url(#desk)" />
      <rect x={-60} y={DESK} width={1200} height={300} fill="url(#spill)" />
      <rect x={-60} y={DESK} width={1200} height={300} fill="url(#cyanSpill)" />
      <rect x={-60} y={DESK} width={1200} height={3} fill="rgba(155,148,255,0.30)" />
      <rect x={-60} y={DESK + 300} width={1200} height={60} fill="#0F0F17" />
      <rect x={-60} y={DESK + 300} width={1200} height={2} fill="rgba(155,148,255,0.18)" />
      {/* Tower: grounded by a soft shadow; a side face for depth; three RGB fans behind glass. */}
      <ellipse cx={FX} cy={DESK + 6} rx={112} ry={9} fill="rgba(0,0,0,0.65)" />
      <path d={`M ${PX - 16} ${PT + 14} L ${PX} ${PT} L ${PX} ${DESK} L ${PX - 16} ${DESK} Z`} fill="#15151F" stroke="rgba(155,148,255,0.22)" strokeWidth={1.5} />
      <rect x={PX} y={PT} width={PW} height={DESK - PT} rx={9} fill="url(#caseFront)" stroke="rgba(200,196,255,0.30)" strokeWidth={2} />
      <rect x={PX + 1} y={PT + 1} width={3} height={DESK - PT - 2} rx={1.5} fill="rgba(155,148,255,0.55)" />
      <rect x={PX + 12} y={PT + 12} width={PW - 24} height={24} rx={6} fill="#13131A" stroke="rgba(255,255,255,0.06)" />
      <circle cx={PX + PW - 24} cy={PT + 24} r={5.5} fill="none" stroke={C.base} strokeWidth={2.5} />
      <rect x={PX + 22} y={PT + 21} width={44} height={6} rx={3} fill="#33334A" />
      <Fan cx={FX} cy={PT + 120} r={60} angle={angle} ring={ringA} />
      <Fan cx={FX} cy={PT + 260} r={60} angle={angle + 21} ring={ringB} />
      <Fan cx={FX} cy={PT + 400} r={60} angle={angle + 42} ring={ringA} />
      <rect x={PX + 10} y={DESK - 14} width={PW - 20} height={4} rx={2} fill={ringB} opacity={0.75} />
      {/* Monitor: shadow, stand, then the bezel with a lit edge; the screen surface is drawn on top. */}
      <ellipse cx={SCX} cy={DESK + 8} rx={160} ry={10} fill="rgba(0,0,0,0.65)" />
      <rect x={SCX - 24} y={SY + SH + 20} width={48} height={DESK - (SY + SH + 20) + 2} rx={6} fill="url(#neck)" stroke="rgba(255,255,255,0.10)" />
      <path d={`M ${SCX - 132} ${DESK + 10} L ${SCX + 132} ${DESK + 10} L ${SCX + 110} ${DESK - 8} L ${SCX - 110} ${DESK - 8} Z`} fill="#30304A" stroke="rgba(200,196,255,0.25)" strokeWidth={1.5} />
      <rect x={SX - 14} y={SY - 14} width={SW + 28} height={SH + 40} rx={16} fill="url(#bezel)" stroke="rgba(200,196,255,0.34)" strokeWidth={2} />
      <rect x={SCX - 18} y={SY + SH + 12} width={36} height={4} rx={2} fill={C.sup} opacity={0.7} />
    </svg>
  );
};

const Peripherals: React.FC<{ t: number }> = ({ t }) => {
  const glow = 0.45 + 0.2 * Math.sin(t * 2);
  const KY = 1268;
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      {/* Keyboard in slight perspective, mouse beside it. */}
      <path d={`M 150 ${KY} L 650 ${KY} L 676 ${KY + 78} L 124 ${KY + 78} Z`} fill="#1B1B25" stroke="rgba(200,196,255,0.22)" strokeWidth={2} />
      <path d={`M 132 ${KY + 78} L 668 ${KY + 78}`} stroke={C.accent} strokeWidth={4} opacity={glow} />
      {Array.from({ length: 4 }, (_, row) => {
        const y = KY + 8 + row * 17;
        const left = 158 - row * 6.5, right = 642 + row * 6.5;
        const w = (right - left) / 15;
        return Array.from({ length: 15 }, (_, col) => <rect key={`${row}-${col}`} x={left + col * w + 2} y={y} width={w - 4} height={12} rx={2} fill="#24242F" />);
      })}
      <path d={`M 760 ${KY + 20} C 760 ${KY - 4}, 816 ${KY - 4}, 816 ${KY + 20} L 816 ${KY + 58} C 816 ${KY + 82}, 760 ${KY + 82}, 760 ${KY + 58} Z`} fill="#1B1B25" stroke="rgba(200,196,255,0.22)" strokeWidth={2} />
      <line x1={788} y1={KY + 2} x2={788} y2={KY + 24} stroke={C.base} strokeWidth={2.5} opacity={glow} />
    </svg>
  );
};

// ---- What the screen shows ---------------------------------------------------------------
function countAt(t: number, e: Events, D: Display): number {
  if (t < e.spots[0]) return 0;
  let n = 0;
  D.spotlights.forEach((spot, i) => {
    if (t >= e.spots[i]) {
      const prev = i === 0 ? 0 : D.spotlights[i - 1].rosterPosition;
      n = Math.round(lerp(t, [e.spots[i], e.spots[i] + 0.22], [prev, spot.rosterPosition], Easing.linear));
    }
  });
  if (t >= e.rollTo20) n = Math.round(lerp(t, [e.rollTo20, e.land], [D.spotlights[D.spotlights.length - 1].rosterPosition, D.games], Easing.linear));
  return n;
}

/**
 * A block with two designed places: on the landscape screen (centre in 1920x1080 screen
 * units, uniform scale) and in the vertical frame (centre in frame pixels, scale 1). It
 * rides with the screen until the screen's width fills the frame, then glides to its
 * vertical place: y over `wy`, x and scale over `wx` (fractions of the push). Paths and
 * windows were checked numerically for this geometry: no block leaves the frame or the
 * screen, and the two blocks never overlap.
 */
const Morph: React.FC<{ c: Cam; land: { x: number; y: number; s: number }; port: { x: number; y: number }; wx: [number, number]; wy: [number, number]; w: number; h: number; children: React.ReactNode }> = ({ c, land, port, wx, wy, w, h, children }) => {
  const A = screenRect(c, Math.min(c.z, Z1));
  const R = screenRect(c);
  const u = A.w / 1920;
  const mx = smooth(c.q, wx[0], wx[1]), my = smooth(c.q, wy[0], wy[1]);
  const s = Math.exp(Math.log(land.s * u) * (1 - mx));
  let y = mix(A.y + land.y * u, port.y, my);
  y = Math.min(Math.max(y, R.y + 24 + (h * s) / 2), R.y + R.h - 24 - (h * s) / 2);
  const x = mix(A.x + land.x * u, port.x, mx);
  return (
    <div style={{ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h, transformOrigin: "50% 50%", transform: `scale(${s})` }}>
      {children}
    </div>
  );
};

const AppBarBlock: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", height: "100%", fontFamily: FONT, whiteSpace: "nowrap" }}>
    <div style={{ fontWeight: 900, fontSize: 34, color: C.ink, letterSpacing: -0.5 }}>Spec<span style={{ color: C.sup }}>Smith</span></div>
    <div style={{ marginLeft: 22, fontWeight: 700, fontSize: 26, color: C.text3 }}>Compare</div>
  </div>
);

const HeaderBlock: React.FC<{ D: Display }> = ({ D }) => (
  <div style={{ textAlign: "center", fontFamily: FONT, whiteSpace: "nowrap" }}>
    <div style={{ fontWeight: 900, fontSize: 82, lineHeight: 1, color: C.sup }}>{D.gpuA.toUpperCase()}</div>
    <div style={{ fontWeight: 800, fontSize: 32, lineHeight: 1, color: C.muted, margin: "10px 0" }}>vs</div>
    <div style={{ fontWeight: 900, fontSize: 82, lineHeight: 1, color: C.base }}>{D.gpuB.toUpperCase()}</div>
    <div style={{ marginTop: 20, fontWeight: 700, fontSize: 36, lineHeight: 1, color: C.ink }}>Same {D.cpu} · {D.setting}</div>
  </div>
);

const CounterBlock: React.FC<{ t: number; D: Display; e: Events }> = ({ t, D, e }) => {
  const n = countAt(t, e, D);
  const landed = t >= e.land;
  const started = t >= e.spots[0];
  const glow = landed ? lerp(t, [e.land, e.land + 0.12], [0, 1], Easing.linear) * (1 - 0.6 * lerp(t, [e.land + 0.12, e.land + 0.8], [0, 1])) : 0;
  // Before the first result a light sweep runs along the empty segments, so the screen is moving from frame one.
  const sweep = ((t * 1.2) % 1.4) / 1.4;
  return (
    <div style={{ textAlign: "center", fontFamily: FONT, whiteSpace: "nowrap" }}>
      {started ? (
        <div style={{ fontWeight: 900, fontSize: 150, lineHeight: 1 }}>
          <span style={{ color: landed ? C.ink : C.sup }}>{n}</span>
          <span style={{ color: C.text3 }}> / {D.games}</span>
        </div>
      ) : (
        <div style={{ fontWeight: 900, fontSize: 132, lineHeight: 1.137, color: C.ink }}>{D.games} GAMES</div>
      )}
      <div style={{ marginTop: 10, fontWeight: 800, fontSize: 40, lineHeight: 1, color: landed ? C.sup : C.ink, letterSpacing: 1 }}>{started ? "MODELLED GAME LEADS" : "IN SPECSMITH'S MODEL"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 62px)", gap: 10, justifyContent: "center", marginTop: 30 }}>
        {Array.from({ length: D.games }, (_, i) => {
          const on = i < n;
          const lit = !started && Math.abs((i % 10) / 10 - sweep) < 0.09;
          return <div key={i} style={{ height: 22, borderRadius: 5, background: on ? C.sup : lit ? "rgba(155,148,255,0.45)" : "rgba(255,255,255,0.08)", border: `2px solid ${on ? C.sup : "#2C2C3E"}`, boxShadow: on && glow > 0 ? `0 0 ${24 * glow}px rgba(155,148,255,${0.9 * glow})` : "none" }} />;
        })}
      </div>
      <div style={{ marginTop: 26, height: 40, opacity: lerp(t, [e.land + 0.15, e.land + 0.4], [0, 1]), fontWeight: 800, fontSize: 36, lineHeight: 1, color: C.muted, letterSpacing: 1 }}>
        {D.ties} TIES · {D.leadsB} FOR THE {D.gpuB.toUpperCase()}
      </div>
    </div>
  );
};

/** Four of the twenty, shown as the counter passes them in roster order. Each enters its own way, then holds still to be read. */
const Spotlight: React.FC<{ t: number; D: Display; e: Events }> = ({ t, D, e }) => {
  const i = e.spots.findIndex((s, k) => t >= s && t < (e.spots[k + 1] ?? e.rollTo20));
  if (i < 0) return null;
  const start = e.spots[i], end = e.spots[i + 1] ?? e.rollTo20;
  const p = lerp(t, [start, start + 0.2], [0, 1], easeOut);
  const o = interpolate(t, [start, start + 0.08, end - 0.1, end], [0, 1, 1, 0], clamp);
  const enter: React.CSSProperties[] = [
    { translate: `${-120 * (1 - p)}px 0px` },
    { translate: `${120 * (1 - p)}px 0px` },
    { clipPath: `inset(${100 * (1 - p)}% 0 0 0)` },
    { translate: `0px ${60 * (1 - p)}px` },
  ];
  const spot = D.spotlights[i];
  return (
    <div style={{ position: "absolute", left: 110, right: 110, top: 940, opacity: o, ...enter[i % 4], padding: "26px 24px 24px", borderRadius: 26, background: "rgba(108,99,255,0.14)", border: `3px solid ${C.sup}`, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontWeight: 900, fontSize: 66, lineHeight: 1.05, color: C.ink, whiteSpace: "nowrap" }}>{spot.title}</div>
      <div style={{ marginTop: 12, fontWeight: 800, fontSize: 30, color: C.sup, letterSpacing: 2 }}>GAME {spot.rosterPosition} OF {D.games} · 4080 SUPER LEADS</div>
    </div>
  );
};

/** The reversal: both averages at once with equal treatment and a clear "vs", zero-based bars, then ONLY 4 FPS APART on "four". */
const Payoff: React.FC<{ t: number; D: Display; e: Events }> = ({ t, D, e }) => {
  if (t < e.reveal + 0.1) return null;
  const inView = lerp(t, [e.reveal + 0.18, e.reveal + 0.42], [0, 1]);
  const nums = lerp(t, [e.numbers - 0.04, e.numbers + 0.22], [0, 1], easeOut);
  const apart = lerp(t, [e.four - 0.03, e.four + 0.17], [0, 1], easeOut);
  const out = 1 - lerp(t, [e.pullBack + 0.12, e.pullBack + 0.32], [0, 1]);
  const MAX = 180, X0 = 130, BW = 820, BY = 1060;
  const xOf = (v: number) => X0 + (v / MAX) * BW;
  const grow = lerp(t, [e.numbers, e.numbers + 0.55], [0, 1], easeOut);
  const lo = Math.min(D.avgA, D.avgB), hi = Math.max(D.avgA, D.avgB);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, opacity: inView * out }}>
      <div style={{ position: "absolute", left: 90, right: 90, top: 232, textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 44, color: C.sup }}>{D.leadsA} / {D.games} modelled leads…</div>
        <div style={{ marginTop: 12, opacity: apart, translate: `0px ${16 * (1 - apart)}px`, fontWeight: 900, fontSize: 92, lineHeight: 1.05, color: C.ink, letterSpacing: -1, whiteSpace: "nowrap" }}>
          ONLY <span style={{ color: C.sup }}>{D.gap}</span> FPS APART
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 480, display: "flex", justifyContent: "center", alignItems: "flex-start", opacity: nums, translate: `0px ${24 * (1 - nums)}px` }}>
        <div style={{ textAlign: "center", width: 340 }}>
          <div style={{ fontWeight: 900, fontSize: 184, lineHeight: 0.95, color: C.sup }}>{D.avgA}</div>
          <div style={{ fontWeight: 800, fontSize: 32, color: C.sup, marginTop: 10 }}>{D.gpuA.toUpperCase()}</div>
        </div>
        <div style={{ width: 150, textAlign: "center", fontWeight: 800, fontSize: 60, lineHeight: 1, color: C.ink, paddingTop: 62 }}>vs</div>
        <div style={{ textAlign: "center", width: 340 }}>
          <div style={{ fontWeight: 900, fontSize: 184, lineHeight: 0.95, color: C.base }}>{D.avgB}</div>
          <div style={{ fontWeight: 800, fontSize: 32, color: C.base, marginTop: 10 }}>{D.gpuB.toUpperCase()}</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 790, textAlign: "center", fontWeight: 700, fontSize: 34, color: C.ink }}>
        Estimated average FPS (rounded) · {D.setting}
      </div>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        <rect x={X0} y={BY - 172} width={((D.avgA * grow) / MAX) * BW} height={62} rx={10} fill={C.sup} />
        <rect x={X0} y={BY - 96} width={((D.avgB * grow) / MAX) * BW} height={62} rx={10} fill={C.base} />
        {/* The difference, marked on the bars as it is named. */}
        <rect x={xOf(lo) - 3} y={BY - 186} width={xOf(hi) - xOf(lo) + 6} height={166} rx={6} fill="none" stroke={C.ink} strokeWidth={4} opacity={apart} />
        <line x1={X0} y1={BY} x2={X0 + BW} y2={BY} stroke="#5A5A78" strokeWidth={4} />
        {[0, 60, 120, 180].map((v) => (
          <g key={v}>
            <line x1={xOf(v)} y1={BY - 12} x2={xOf(v)} y2={BY + 12} stroke="#5A5A78" strokeWidth={3} />
            <text x={xOf(v)} y={BY + 48} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={30} fill={C.muted}>{v}</text>
          </g>
        ))}
        <text x={W / 2} y={BY + 88} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={28} fill={C.muted}>Full scale from 0 FPS</text>
      </svg>
    </AbsoluteFill>
  );
};

/** The final question, laid out for the landscape screen the camera returns to. */
const Question: React.FC<{ t: number; e: Events; c: Cam }> = ({ t, e, c }) => {
  if (t < e.pullBack + 0.3) return null;
  const R = screenRect(c);
  const u = R.w / 1920;
  const q = lerp(t, [e.pullBack + 0.55, e.pullBack + 0.8], [0, 1], easeOut); // once the camera has nearly settled
  const cta = lerp(t, [e.lastWord, e.lastWord + 0.35], [0, 1]);
  return (
    <div style={{ position: "absolute", left: R.x, top: R.y, width: 1920, height: 1080, transformOrigin: "0 0", transform: `scale(${u})`, fontFamily: FONT, textAlign: "center" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 250, opacity: q, fontWeight: 900, fontSize: 150, lineHeight: 1.04, color: C.ink }}>
        Would you have<br />guessed <span style={{ color: C.sup }}>four</span>?
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 680, opacity: cta, fontWeight: 800, fontSize: 80, letterSpacing: 4, color: C.muted }}>COMPARE BUILDS ON SPECSMITH</div>
    </div>
  );
};

/** Everything on the screen, in frame coordinates, clipped to where the screen is. */
const ScreenContent: React.FC<{ t: number; D: Display; e: Events; c: Cam }> = ({ t, D, e, c }) => {
  const R = screenRect(c);
  const out = 1 - lerp(t, [e.reveal - 0.02, e.reveal + 0.16], [0, 1]);
  const dim = t >= e.dropStart && t < e.reveal + 0.3 ? lerp(t, [e.dropStart, e.dropStart + 0.3], [0, 0.4]) * (1 - lerp(t, [e.reveal, e.reveal + 0.3], [0, 1])) : 0;
  const preQuestion = t < e.pullBack + 0.3;
  return (
    <div style={{ position: "absolute", inset: 0, clipPath: `inset(${R.y}px ${W - R.x - R.w}px ${H - R.y - R.h}px ${R.x}px round ${Math.max(2, 4 * c.z)}px)` }}>
      {/* Landscape positions are in 1920x1080 screen units; vertical positions are frame pixels. */}
      {/* The app bar steps aside while the blocks re-flow, and returns in its vertical place. */}
      <div style={{ opacity: 1 - smooth(c.q, 0.22, 0.34) + smooth(c.q, 0.86, 1) }}>
        <Morph c={c} land={{ x: 360, y: 72, s: 1.5 }} port={{ x: 260, y: 112 }} wx={[0.34, 0.86]} wy={[0.34, 0.86]} w={420} h={60}>
          <AppBarBlock />
        </Morph>
      </div>
      {preQuestion ? (
        <div style={{ opacity: out }}>
          <Morph c={c} land={{ x: 560, y: 520, s: 1.0 }} port={{ x: W / 2, y: 226 + 136 }} wx={[0.4, 0.75]} wy={[0.3, 0.65]} w={1000} h={272}>
            <HeaderBlock D={D} />
          </Morph>
          <Morph c={c} land={{ x: 1370, y: 560, s: 0.9 }} port={{ x: W / 2, y: 560 + 175 }} wx={[0.5, 0.85]} wy={[0.5, 0.85]} w={1000} h={350}>
            <CounterBlock t={t} D={D} e={e} />
          </Morph>
          <Spotlight t={t} D={D} e={e} />
        </div>
      ) : null}
      {preQuestion ? <Payoff t={t} D={D} e={e} /> : null}
      <Question t={t} e={e} c={c} />
      <AbsoluteFill style={{ background: "#000", opacity: dim }} />
    </div>
  );
};

// ---- Overlays that stay put while the camera moves ------------------------------------
const Captions: React.FC<{ t: number; P: MonitorProps["plan"] }> = ({ t, P }) => {
  // The final question is shown on the screen itself; every other spoken line is captioned here.
  const cue = P.captions.find((c) => t >= c.start && t < c.end && c.start < P.events.question - 0.05);
  if (!cue) return null;
  const o = interpolate(t, [cue.start, cue.start + 0.06, cue.end - 0.06, cue.end], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 90, right: 120, top: 1190, opacity: o, textAlign: "center", fontFamily: FONT, fontWeight: 900, fontSize: 60, lineHeight: 1.08, color: C.ink, textShadow: "0 3px 14px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)" }}>
      {cue.lines.map((line) => <div key={line}>{line}</div>)}
    </div>
  );
};

const EstimateLabel: React.FC = () => (
  <div style={{ position: "absolute", left: 0, right: 0, top: 1400, display: "flex", justifyContent: "center" }}>
    <div style={{ padding: "10px 22px", borderRadius: 40, background: "rgba(10,10,15,0.85)", border: "2px solid rgba(155,148,255,0.5)", fontFamily: FONT, fontWeight: 700, fontSize: 29, color: C.ink, whiteSpace: "nowrap" }}>
      SpecSmith model estimates · not measured benchmarks
    </div>
  </div>
);

export const Monitor: React.FC<MonitorProps> = ({ plan: P, display: D, audio }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const e = P.events;
  const c = camAt(t, e);
  const z = c.z;
  // The 20/20 lands with one controlled push toward the counter, held through the drop, released at "But".
  const landPush = t < e.land ? 1 : 1 + 0.055 * lerp(t, [e.land, e.land + 0.3], [0, 1], easeOut) * (1 - lerp(t, [e.reveal, e.reveal + 0.4], [0, 1]));
  // A faint glass sheen, only while the screen is seen as an object on the desk.
  const sheen = 1 - lerp(z, [1.6, 3], [0, 1], Easing.linear);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Audio src={staticFile(audio)} />
      <AbsoluteFill style={{ transformOrigin: "540px 760px", transform: `scale(${landPush})` }}>
        <AbsoluteFill style={layer(c, 0.75)}>
          <Wall t={t} />
        </AbsoluteFill>
        <AbsoluteFill style={layer(c, 1)}>
          <DeskAndHardware t={t} />
          {/* The screen surface: lit, with a soft glow onto the bezel and wall. */}
          <div style={{ position: "absolute", left: SX, top: SY, width: SW, height: SH, borderRadius: 3, background: `radial-gradient(ellipse 90% 85% at 50% 40%, #191927 0%, #0E0E16 75%)`, boxShadow: "0 0 80px rgba(108,99,255,0.5), 0 0 18px rgba(155,148,255,0.4)" }} />
        </AbsoluteFill>
        <ScreenContent t={t} D={D} e={e} c={c} />
        <AbsoluteFill style={layer(c, 1)}>
          <div style={{ position: "absolute", left: SX, top: SY, width: SW, height: SH, opacity: 0.6 * sheen, background: "linear-gradient(120deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 35%)" }} />
        </AbsoluteFill>
        <AbsoluteFill style={layer(c, 1.35)}>
          <Peripherals t={t} />
        </AbsoluteFill>
      </AbsoluteFill>
      <Captions t={t} P={P} />
      <EstimateLabel />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 95% 80% at 50% 48%, transparent 66%, rgba(0,0,0,0.38) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

// "20 wins. Only 4 FPS apart.": the monitor-entry cut.
//
// A stylised gaming desk; the monitor already shows the comparison. The camera
// pushes into the screen, so the screen's own content becomes the full frame:
// the screen is one 1080x1920 layer, drawn once, which the camera scales from
// half size to exactly the frame. Nothing is swapped at the handoff.
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

// ---- Camera ---------------------------------------------------------------------
// Opening framing: the screen sits at (SX, SY) at half size. Zoom factor z = 1 is
// the opening, z = 2 puts the screen exactly on the frame. All layers zoom about
// the same point; the wall and keyboard zoom less and more (parallax).
const SX = 160, SY = 250, S0 = 0.5;
const CX = 2 * SX, CY = 2 * SY; // the zoom's fixed point (320, 500): z = 2 maps the screen onto the frame
function zoomAt(t: number, e: MonitorProps["plan"]["events"]) {
  const [a, b] = e.entry;
  // Exponential zoom reads as a constant-speed push.
  const inP = lerp(t, [a, b], [0, 1], Easing.bezier(0.55, 0, 0.25, 1));
  const outP = lerp(t, [e.pullBack, e.pullBack + 0.8], [0, 1], Easing.bezier(0.45, 0, 0.2, 1));
  const zIn = Math.pow(2, inP);
  const zEnd = 1.34;
  return zIn * Math.pow(zEnd / 2, outP);
}
const layer = (z: number, depth: number): React.CSSProperties => {
  const k = 1 + (z - 1) * depth;
  return { transformOrigin: `${CX}px ${CY}px`, transform: `scale(${k})` };
};

// ---- The desk scene (drawn in opening-frame coordinates) ------------------------
const Fan: React.FC<{ cx: number; cy: number; r: number; angle: number; hue: number }> = ({ cx, cy, r, angle, hue }) => {
  const ring = hue < 0.5 ? C.sup : C.base;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r={r} fill="#0E0E15" stroke={ring} strokeWidth={4} opacity={0.95} />
      <circle r={r - 7} fill="none" stroke={ring} strokeWidth={10} opacity={0.12} />
      <g transform={`rotate(${angle})`}>
        {Array.from({ length: 7 }, (_, i) => (
          <path key={i} transform={`rotate(${(i * 360) / 7})`} d={`M ${r * 0.2} -6 C ${r * 0.45} -${r * 0.42}, ${r * 0.8} -${r * 0.34}, ${r * 0.86} -${r * 0.08} C ${r * 0.62} -${r * 0.02}, ${r * 0.38} 2, ${r * 0.2} 6 Z`} fill="#3A3A52" stroke="#4A4A66" strokeWidth={1} />
        ))}
      </g>
      <circle r={r * 0.2} fill="#1C1C26" stroke="#4A4A66" strokeWidth={2} />
      <circle r={r * 0.07} fill={ring} opacity={0.7} />
    </g>
  );
};

const Wall: React.FC = () => (
  <AbsoluteFill>
    <AbsoluteFill style={{ background: `linear-gradient(180deg, #0C0C14 0%, ${C.bg} 70%)` }} />
    {/* Screen and RGB light on the wall. */}
    <AbsoluteFill style={{ background: "radial-gradient(ellipse 520px 700px at 430px 730px, rgba(108,99,255,0.30), transparent 70%)" }} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse 260px 420px at 900px 1050px, rgba(0,212,255,0.13), transparent 70%)" }} />
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
      {[110, 300, 1010].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={1350} stroke="rgba(255,255,255,0.03)" strokeWidth={2} />)}
      <line x1={0} y1={170} x2={1080} y2={170} stroke="rgba(255,255,255,0.03)" strokeWidth={2} />
    </svg>
  </AbsoluteFill>
);

const DeskAndHardware: React.FC<{ t: number }> = ({ t }) => {
  const angle = t * 324; // ~0.9 turns a second
  const hue = (Math.sin(t * 1.4) + 1) / 2;
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="desk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A1A25" />
          <stop offset="1" stopColor="#111119" />
        </linearGradient>
        <radialGradient id="screenSpill" cx="0.5" cy="0" r="0.8">
          <stop offset="0" stopColor="rgba(108,99,255,0.32)" />
          <stop offset="1" stopColor="rgba(108,99,255,0)" />
        </radialGradient>
        <linearGradient id="caseFront" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1C1C26" />
          <stop offset="1" stopColor="#13131A" />
        </linearGradient>
        <linearGradient id="neck" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#24242F" />
          <stop offset="0.5" stopColor="#30303E" />
          <stop offset="1" stopColor="#1C1C26" />
        </linearGradient>
      </defs>
      {/* Desk top and front edge. */}
      <rect x={-40} y={1350} width={1160} height={170} fill="url(#desk)" />
      <rect x={-40} y={1350} width={1160} height={170} fill="url(#screenSpill)" />
      <rect x={-40} y={1350} width={1160} height={3} fill="rgba(255,255,255,0.10)" />
      <rect x={-40} y={1520} width={1160} height={44} fill="#0D0D14" />
      <rect x={-40} y={1520} width={1160} height={2} fill="rgba(255,255,255,0.06)" />
      {/* Monitor stand and its shadow. */}
      <ellipse cx={430} cy={1362} rx={150} ry={10} fill="rgba(0,0,0,0.55)" />
      <rect x={405} y={1224} width={50} height={128} rx={6} fill="url(#neck)" />
      <path d="M 320 1365 L 540 1365 L 520 1346 L 340 1346 Z" fill="#262633" stroke="rgba(255,255,255,0.06)" />
      {/* PC case: front panel with three fans, a side face for depth, and its shadow. */}
      <ellipse cx={880} cy={1356} rx={150} ry={9} fill="rgba(0,0,0,0.6)" />
      <path d="M 738 778 L 762 760 L 762 1350 L 738 1350 Z" fill="#101018" />
      <path d="M 742 820 L 758 808 L 758 1300 L 742 1310 Z" fill="rgba(108,99,255,0.10)" />
      <rect x={762} y={760} width={236} height={590} rx={10} fill="url(#caseFront)" stroke="rgba(255,255,255,0.08)" strokeWidth={2} />
      <rect x={778} y={778} width={204} height={30} rx={6} fill="#13131A" />
      <circle cx={960} cy={793} r={7} fill="none" stroke={C.base} strokeWidth={2} opacity={0.8} />
      <rect x={792} y={789} width={60} height={8} rx={3} fill="#24242F" />
      <Fan cx={880} cy={905} r={70} angle={angle} hue={hue} />
      <Fan cx={880} cy={1065} r={70} angle={angle + 17} hue={1 - hue} />
      <Fan cx={880} cy={1225} r={70} angle={angle + 34} hue={hue} />
      <rect x={772} y={1335} width={216} height={4} rx={2} fill={hue < 0.5 ? C.sup : C.base} opacity={0.55} />
      {/* Monitor bezel: the screen itself is a separate layer drawn on top. */}
      <rect x={SX - 16} y={SY - 16} width={1080 * S0 + 32} height={1920 * S0 + 34} rx={18} fill="#0B0B11" stroke="rgba(255,255,255,0.10)" strokeWidth={2} />
      <rect x={SX + 1080 * S0 / 2 - 14} y={SY + 1920 * S0 + 6} width={28} height={4} rx={2} fill={C.sup} opacity={0.5} />
    </svg>
  );
};

const Peripherals: React.FC<{ t: number }> = ({ t }) => {
  const glow = 0.35 + 0.15 * Math.sin(t * 2);
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
      {/* Keyboard in slight perspective, mouse beside it. */}
      <path d="M 250 1446 L 690 1446 L 712 1516 L 228 1516 Z" fill="#16161F" stroke="rgba(255,255,255,0.09)" strokeWidth={2} />
      <path d="M 236 1516 L 704 1516" stroke={C.accent} strokeWidth={3} opacity={glow} />
      {Array.from({ length: 4 }, (_, row) =>
        Array.from({ length: 14 }, (_, col) => {
          const y = 1452 + row * 15;
          const inset = 22 - row * 5.5;
          const x0 = 256 + inset * (1 - 0) - row * 0;
          const w = (434 + row * 11 - inset * 0) / 14;
          return <rect key={`${row}-${col}`} x={x0 - row * 5.5 + col * w} y={y} width={w - 4} height={10} rx={2} fill="#22222E" />;
        }),
      )}
      <path d="M 790 1462 C 790 1442, 840 1442, 840 1462 L 840 1496 C 840 1516, 790 1516, 790 1496 Z" fill="#16161F" stroke="rgba(255,255,255,0.09)" strokeWidth={2} />
      <line x1={815} y1={1448} x2={815} y2={1468} stroke={C.base} strokeWidth={2} opacity={glow} />
    </svg>
  );
};

// ---- What the monitor shows (screen coordinates, 1080x1920) ----------------------
function countAt(t: number, e: MonitorProps["plan"]["events"], D: MonitorProps["display"]): number {
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

const AppBar: React.FC = () => (
  <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 150, display: "flex", alignItems: "flex-end", padding: "0 70px 26px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT }}>
    <div style={{ fontWeight: 900, fontSize: 34, color: C.ink, letterSpacing: -0.5 }}>Spec<span style={{ color: C.sup }}>Smith</span></div>
    <div style={{ marginLeft: 22, fontWeight: 700, fontSize: 26, color: C.text3 }}>Compare</div>
  </div>
);

const Header: React.FC<{ t: number; D: MonitorProps["display"]; e: MonitorProps["plan"]["events"] }> = ({ t, D, e }) => {
  const out = 1 - lerp(t, [e.reveal - 0.02, e.reveal + 0.16], [0, 1]);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 226, opacity: out, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontWeight: 900, fontSize: 82, lineHeight: 1, color: C.sup }}>{D.gpuA.toUpperCase()}</div>
      <div style={{ fontWeight: 800, fontSize: 32, color: C.muted, margin: "8px 0" }}>vs</div>
      <div style={{ fontWeight: 900, fontSize: 82, lineHeight: 1, color: C.base }}>{D.gpuB.toUpperCase()}</div>
      <div style={{ marginTop: 18, fontWeight: 700, fontSize: 36, color: C.ink }}>Same {D.cpu} · {D.setting}</div>
    </div>
  );
};

const Counter: React.FC<{ t: number; D: MonitorProps["display"]; e: MonitorProps["plan"]["events"] }> = ({ t, D, e }) => {
  const n = countAt(t, e, D);
  const landed = t >= e.land;
  const started = t >= e.spots[0];
  const out = 1 - lerp(t, [e.reveal - 0.02, e.reveal + 0.16], [0, 1]);
  const glow = landed ? lerp(t, [e.land, e.land + 0.12], [0, 1], Easing.linear) * (1 - 0.6 * lerp(t, [e.land + 0.12, e.land + 0.8], [0, 1])) : 0;
  // Before the first result, a light sweep runs along the empty segments, so frame one is already moving.
  const sweep = ((t * 1.1) % 1.6) / 1.6;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 560, opacity: out, textAlign: "center", fontFamily: FONT }}>
      {started ? (
        <div style={{ fontWeight: 900, fontSize: 150, lineHeight: 1 }}>
          <span style={{ color: landed ? C.ink : C.sup }}>{n}</span>
          <span style={{ color: C.text3 }}> / {D.games}</span>
        </div>
      ) : (
        <div style={{ fontWeight: 900, fontSize: 130, lineHeight: 1.15, color: C.ink }}>{D.games} GAMES</div>
      )}
      <div style={{ marginTop: 8, fontWeight: 800, fontSize: 40, color: landed ? C.sup : C.ink, letterSpacing: 1 }}>{started ? "MODELLED GAME LEADS" : "IN SPECSMITH'S MODEL"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 62px)", gap: 10, justifyContent: "center", marginTop: 30 }}>
        {Array.from({ length: D.games }, (_, i) => {
          const on = i < n;
          const lit = !started && Math.abs((i % 10) / 10 - sweep) < 0.08;
          return (
            <div key={i} style={{ height: 22, borderRadius: 5, background: on ? C.sup : lit ? "rgba(155,148,255,0.30)" : "rgba(255,255,255,0.07)", border: `2px solid ${on ? C.sup : "#2A2A3A"}`, boxShadow: on && glow > 0 ? `0 0 ${24 * glow}px rgba(155,148,255,${0.9 * glow})` : "none" }} />
          );
        })}
      </div>
      <div style={{ marginTop: 26, height: 44, opacity: lerp(t, [e.land + 0.15, e.land + 0.4], [0, 1]), fontWeight: 800, fontSize: 36, color: C.muted, letterSpacing: 1 }}>
        {D.ties} TIES · {D.leadsB} FOR THE {D.gpuB.toUpperCase()}
      </div>
    </div>
  );
};

/** Four of the twenty, shown as the counter passes them in roster order. Each enters its own way, then holds still to be read. */
const Spotlight: React.FC<{ t: number; D: MonitorProps["display"]; e: MonitorProps["plan"]["events"] }> = ({ t, D, e }) => {
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
    <div style={{ position: "absolute", left: 110, right: 110, top: 940, opacity: o, ...enter[i % 4], padding: "26px 24px 24px", borderRadius: 26, background: "rgba(108,99,255,0.12)", border: `3px solid ${C.sup}`, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontWeight: 900, fontSize: 66, lineHeight: 1.05, color: C.ink, whiteSpace: "nowrap" }}>{spot.title}</div>
      <div style={{ marginTop: 12, fontWeight: 800, fontSize: 30, color: C.sup, letterSpacing: 2 }}>GAME {spot.rosterPosition} OF {D.games} · 4080 SUPER LEADS</div>
    </div>
  );
};

/** The reversal: both averages at once, equal treatment, zero-based bars, then ONLY 4 FPS APART. */
const Payoff: React.FC<{ t: number; D: MonitorProps["display"]; e: MonitorProps["plan"]["events"] }> = ({ t, D, e }) => {
  if (t < e.reveal - 0.05) return null;
  const inView = lerp(t, [e.reveal + 0.18, e.reveal + 0.42], [0, 1]);
  const nums = lerp(t, [e.numbers - 0.04, e.numbers + 0.22], [0, 1], easeOut);
  const apart = lerp(t, [e.apart - 0.04, e.apart + 0.2], [0, 1], easeOut);
  const out = 1 - lerp(t, [e.pullBack + 0.1, e.pullBack + 0.3], [0, 1]);
  const MAX = 180, X0 = 130, W = 820, BY = 1040;
  const xOf = (v: number) => X0 + (v / MAX) * W;
  const grow = lerp(t, [e.numbers, e.numbers + 0.55], [0, 1], easeOut);
  const lo = Math.min(D.avgA, D.avgB), hi = Math.max(D.avgA, D.avgB);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, opacity: inView * out }}>
      <div style={{ position: "absolute", left: 90, right: 90, top: 232, textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 44, color: C.sup }}>{D.leadsA} / {D.games} modelled leads…</div>
        <div style={{ marginTop: 10, opacity: apart, translate: `0px ${18 * (1 - apart)}px`, fontWeight: 900, fontSize: 92, lineHeight: 1.05, color: C.ink, letterSpacing: -1, whiteSpace: "nowrap" }}>
          ONLY <span style={{ color: C.sup }}>{D.gap}</span> FPS APART
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 470, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 60, opacity: nums, translate: `0px ${24 * (1 - nums)}px` }}>
        <div style={{ textAlign: "center", width: 360 }}>
          <div style={{ fontWeight: 900, fontSize: 190, lineHeight: 0.95, color: C.sup }}>{D.avgA}</div>
          <div style={{ fontWeight: 800, fontSize: 34, color: C.sup, marginTop: 8 }}>{D.gpuA.toUpperCase()}</div>
        </div>
        <div style={{ textAlign: "center", width: 360 }}>
          <div style={{ fontWeight: 900, fontSize: 190, lineHeight: 0.95, color: C.base }}>{D.avgB}</div>
          <div style={{ fontWeight: 800, fontSize: 34, color: C.base, marginTop: 8 }}>{D.gpuB.toUpperCase()}</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 772, textAlign: "center", fontWeight: 700, fontSize: 34, color: C.ink }}>
        Estimated average FPS (rounded) · {D.setting}
      </div>
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }}>
        <rect x={X0} y={BY - 172} width={((D.avgA * grow) / MAX) * W} height={62} rx={10} fill={C.sup} />
        <rect x={X0} y={BY - 96} width={((D.avgB * grow) / MAX) * W} height={62} rx={10} fill={C.base} />
        {/* The difference, marked on the bars once it is named. */}
        <rect x={xOf(lo) - 3} y={BY - 186} width={xOf(hi) - xOf(lo) + 6} height={166} rx={6} fill="none" stroke={C.ink} strokeWidth={4} opacity={apart} />
        <line x1={X0} y1={BY} x2={X0 + W} y2={BY} stroke="#5A5A78" strokeWidth={4} />
        {[0, 60, 120, 180].map((v) => (
          <g key={v}>
            <line x1={xOf(v)} y1={BY - 12} x2={xOf(v)} y2={BY + 12} stroke="#5A5A78" strokeWidth={3} />
            <text x={xOf(v)} y={BY + 48} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={30} fill={C.muted}>{v}</text>
          </g>
        ))}
        <text x={540} y={BY + 88} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={28} fill={C.muted}>Full scale from 0 FPS</text>
      </svg>
    </AbsoluteFill>
  );
};

const Question: React.FC<{ t: number; e: MonitorProps["plan"]["events"] }> = ({ t, e }) => {
  if (t < e.pullBack + 0.3) return null;
  const q = lerp(t, [e.pullBack + 0.35, e.pullBack + 0.65], [0, 1], easeOut);
  const cta = lerp(t, [e.lastWord, e.lastWord + 0.35], [0, 1]);
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 80, right: 80, top: 560, opacity: q, textAlign: "center", fontWeight: 900, fontSize: 116, lineHeight: 1.04, color: C.ink }}>
        Would you have guessed <span style={{ color: C.sup }}>four</span>?
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 980, opacity: cta, textAlign: "center", fontWeight: 800, fontSize: 58, letterSpacing: 3, color: C.muted }}>
        COMPARE BUILDS ON SPECSMITH
      </div>
    </AbsoluteFill>
  );
};

const Screen: React.FC<{ t: number; D: MonitorProps["display"]; e: MonitorProps["plan"]["events"]; z: number }> = ({ t, D, e, z }) => {
  // The drop: the screen dims and everything holds still in the silence before "But".
  const dim = t >= e.dropStart && t < e.reveal + 0.3 ? lerp(t, [e.dropStart, e.dropStart + 0.3], [0, 0.4]) * (1 - lerp(t, [e.reveal, e.reveal + 0.3], [0, 1])) : 0;
  // A faint glass sheen, only while the screen is seen as an object on the desk.
  const sheen = 1 - lerp(z, [1.3, 1.9], [0, 1], Easing.linear);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 120% 80% at 50% 35%, #15151F 0%, ${C.bg} 70%)`, overflow: "hidden" }}>
      <AppBar />
      <Header t={t} D={D} e={e} />
      <Counter t={t} D={D} e={e} />
      <Spotlight t={t} D={D} e={e} />
      <Payoff t={t} D={D} e={e} />
      <Question t={t} e={e} />
      <AbsoluteFill style={{ background: "#000", opacity: dim }} />
      <AbsoluteFill style={{ opacity: 0.5 * sheen, background: "linear-gradient(125deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.0) 32%, rgba(255,255,255,0) 100%)" }} />
    </AbsoluteFill>
  );
};

// ---- Overlays that stay put while the camera moves --------------------------------
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
  <div style={{ position: "absolute", left: 0, right: 0, top: 1380, display: "flex", justifyContent: "center" }}>
    <div style={{ padding: "10px 22px", borderRadius: 40, background: "rgba(10,10,15,0.82)", border: "2px solid rgba(155,148,255,0.45)", fontFamily: FONT, fontWeight: 700, fontSize: 29, color: C.ink, whiteSpace: "nowrap" }}>
      SpecSmith model estimates · not measured benchmarks
    </div>
  </div>
);

export const Monitor: React.FC<MonitorProps> = ({ plan: P, display: D, audio }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const e = P.events;
  const z = zoomAt(t, e);
  // The 20/20 lands with one controlled push toward the counter, held through the drop, released at "But".
  const landPush = t < e.land ? 1 : 1 + 0.055 * lerp(t, [e.land, e.land + 0.3], [0, 1], easeOut) * (1 - lerp(t, [e.reveal, e.reveal + 0.4], [0, 1]));
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Audio src={staticFile(audio)} />
      <AbsoluteFill style={{ transformOrigin: "540px 720px", transform: `scale(${landPush})` }}>
        <AbsoluteFill style={layer(z, 0.6)}>
          <Wall />
        </AbsoluteFill>
        <AbsoluteFill style={layer(z, 1)}>
          <DeskAndHardware t={t} />
          <div style={{ position: "absolute", left: SX, top: SY, width: 1080, height: 1920, transformOrigin: "0 0", transform: `scale(${S0})`, borderRadius: 4, overflow: "hidden", boxShadow: "0 0 80px rgba(108,99,255,0.25)" }}>
            <Screen t={t} D={D} e={e} z={z} />
          </div>
        </AbsoluteFill>
        <AbsoluteFill style={layer(z, 1.7)}>
          <Peripherals t={t} />
        </AbsoluteFill>
      </AbsoluteFill>
      <Captions t={t} P={P} />
      <EstimateLabel />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 95% 80% at 50% 48%, transparent 64%, rgba(0,0,0,0.42) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

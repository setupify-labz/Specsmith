// "The PC is on. The screen says NO SIGNAL. Which port would you use?"
//
// One standalone creative experiment, drawn entirely in code (SVG/CSS). The
// hardware is an ILLUSTRATION of one verified setup (FACT_SHEET.md): an Intel
// Core i5-12400F (no processor graphics) on an MSI PRO B760M-A WIFI, with an
// MSI GeForce RTX 4060 VENTUS 2X BLACK 8G OC. It is not a photograph, not
// footage, and not a recorded hardware test; port order on the I/O shield is
// illustrative. Every timing comes from timeline.json, which the sound uses too.

import "@fontsource/inter/500.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import T from "./timeline.json";

const FONT = "Inter, sans-serif";
const C = {
  bg: "#0a0c10",
  panel: "#17191e",
  panelEdge: "#262a31",
  metal: "#a7afb9",
  metalDark: "#5d646e",
  hole: "#050608",
  text: "#f3f5f8",
  muted: "rgba(243,245,248,0.72)",
  a: "#ff6b5e", // wrong choice, after the reveal
  b: "#3fd68f", // right choice, after the reveal
  neutral: "#f3f5f8",
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);
const lerp = (t: number, [t0, t1]: [number, number], [a, b]: [number, number], e = ease) => interpolate(t, [t0, t1], [a, b], { ...clamp, easing: e });

// ---- Scene geometry (rear view, scene pixels) --------------------------------
const PORT_A = { x: 320, y: 785 }; // motherboard HDMI (upper)
const PORT_B = { x: 628, y: 1196 }; // graphics card HDMI
const CABLE_ORIGIN = { x: -90, y: 960 }; // hangs down from the monitor, which is off to the left

/** HDMI receptacle seen head-on: metal shell, tapered lower corners, black tongue. */
const Hdmi: React.FC<{ x: number; y: number; w?: number; glow?: string }> = ({ x, y, w = 104, glow }) => {
  const h = w * 0.36;
  const c = w * 0.13;
  const path = `M ${-w / 2} ${-h / 2} H ${w / 2} V ${h / 2 - c} L ${w / 2 - c} ${h / 2} H ${-w / 2 + c} L ${-w / 2} ${h / 2 - c} Z`;
  return (
    <g transform={`translate(${x} ${y})`}>
      {glow ? <path d={path} fill="none" stroke={glow} strokeWidth={10} opacity={0.55} /> : null}
      <path d={path} fill={C.metal} />
      <path d={path} transform="scale(0.86 0.72)" fill={C.hole} />
      <rect x={-w * 0.33} y={-h * 0.1} width={w * 0.66} height={h * 0.2} rx={2} fill="#2b2f36" />
    </g>
  );
};

/** DisplayPort receptacle: one corner cut. */
const Dp: React.FC<{ x: number; y: number; w?: number }> = ({ x, y, w = 96 }) => {
  const h = w * 0.38;
  const c = w * 0.16;
  const path = `M ${-w / 2} ${-h / 2} H ${w / 2} V ${h / 2} H ${-w / 2 + c} L ${-w / 2} ${h / 2 - c} Z`;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={path} fill={C.metal} />
      <path d={path} transform="scale(0.86 0.72)" fill={C.hole} />
      <rect x={-w * 0.3} y={-h * 0.09} width={w * 0.6} height={h * 0.18} rx={2} fill="#2b2f36" />
    </g>
  );
};

const UsbA: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x={-40} y={-15} width={80} height={30} rx={3} fill={C.metal} />
    <rect x={-34} y={-10} width={68} height={20} rx={2} fill={C.hole} />
    <rect x={-30} y={-9} width={60} height={8} fill="#2f5fd0" opacity={0.85} />
  </g>
);

/** A spinning 120 mm exhaust fan behind its grille. */
const RearFan: React.FC<{ x: number; y: number; size: number; t: number }> = ({ x, y, size, t }) => {
  const r = size / 2;
  const angle = t * 300;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="#0d0f12" />
      <g transform={`rotate(${angle})`} opacity={0.9}>
        {Array.from({ length: 7 }, (_, i) => (
          <path key={i} transform={`rotate(${(i * 360) / 7})`} d={`M ${r * 0.22} ${-r * 0.05} C ${r * 0.48} ${-r * 0.3}, ${r * 0.8} ${-r * 0.2}, ${r * 0.86} ${r * 0.02} L ${r * 0.28} ${r * 0.1} Z`} fill="#272b33" />
        ))}
      </g>
      <circle r={r * 0.22} fill="#1d2027" stroke="#2a2e36" strokeWidth={2} />
      {/* grille */}
      {[0.35, 0.6, 0.85].map((k) => (
        <circle key={k} r={r * k} fill="none" stroke="#3a3f48" strokeWidth={3} />
      ))}
      <line x1={-r} y1={0} x2={r} y2={0} stroke="#3a3f48" strokeWidth={3} />
      <line x1={0} y1={-r} x2={0} y2={r} stroke="#3a3f48" strokeWidth={3} />
    </g>
  );
};

/** The back of the PC, as one SVG, with port glows driven by the story. */
const RearPanel: React.FC<{ t: number; glowA?: string; glowB?: string; dimOthers?: number }> = ({ t, glowA, glowB, dimOthers = 0 }) => (
  <svg width={1080} height={1960} viewBox="0 0 1080 1960" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
    <defs>
      <linearGradient id="chassis" x1="0" x2="1">
        <stop offset="0" stopColor="#14161a" />
        <stop offset="0.5" stopColor="#1b1e24" />
        <stop offset="1" stopColor="#121418" />
      </linearGradient>
      <pattern id="vent" width="22" height="22" patternUnits="userSpaceOnUse">
        <rect width="22" height="22" fill="#15171b" />
        <circle cx="11" cy="11" r="5" fill="#07080a" />
      </pattern>
    </defs>
    {/* chassis */}
    <rect x={150} y={560} width={780} height={1420} rx={16} fill="url(#chassis)" stroke={C.panelEdge} strokeWidth={3} />
    <RearFan x={765} y={760} size={250} t={t} />
    {/* motherboard I/O shield */}
    <rect x={200} y={610} width={240} height={510} rx={6} fill="#22252b" stroke="#30343c" strokeWidth={2} />
    <g opacity={1 - dimOthers}>
      <UsbA x={320} y={645} />
      <UsbA x={320} y={685} />
      <circle cx={268} cy={730} r={13} fill="#b9973f" />
      <circle cx={372} cy={730} r={13} fill="#b9973f" />
      <Dp x={320} y={840} />
      <Hdmi x={320} y={895} />
      <Dp x={320} y={950} />
      <rect x={288} y={990} width={64} height={52} rx={4} fill={C.metal} />
      <rect x={296} y={998} width={48} height={38} rx={2} fill={C.hole} />
      {[262, 320, 378].map((cx, i) => (
        <circle key={cx} cx={cx} cy={1078} r={14} fill={["#56b3ff", "#7ee08a", "#ff9fd0"][i]} stroke="#111" strokeWidth={4} />
      ))}
    </g>
    <Hdmi x={PORT_A.x} y={PORT_A.y} glow={glowA} />
    {/* expansion slots: graphics card bracket (two slots), then covers */}
    <rect x={200} y={1150} width={580} height={104} rx={4} fill="#2a2e35" stroke="#3a3f48" strokeWidth={2} />
    <g opacity={1 - dimOthers}>
      <Dp x={290} y={PORT_B.y} />
      <Dp x={400} y={PORT_B.y} />
      <Dp x={510} y={PORT_B.y} />
      <rect x={210} y={1226} width={560} height={20} fill="url(#vent)" />
    </g>
    <Hdmi x={PORT_B.x} y={PORT_B.y} glow={glowB} />
    {Array.from({ length: 5 }, (_, i) => (
      <rect key={i} x={200} y={1266 + i * 54} width={580} height={44} rx={3} fill="#1c1f24" stroke="#2a2e35" strokeWidth={2} />
    ))}
    {/* power supply: fan, socket with cord, switch ON */}
    <rect x={200} y={1570} width={680} height={330} rx={8} fill="#121418" stroke="#262a31" strokeWidth={2} />
    <circle cx={380} cy={1730} r={118} fill="#0c0d10" stroke="#30343c" strokeWidth={3} />
    {[0.35, 0.65, 0.95].map((k) => (
      <circle key={k} cx={380} cy={1730} r={118 * k} fill="none" stroke="#30343c" strokeWidth={3} />
    ))}
    <rect x={640} y={1680} width={90} height={70} rx={8} fill="#08090b" stroke="#3a3f48" strokeWidth={2} />
    <path d="M 685 1750 C 685 1830, 640 1880, 600 1990" stroke="#0b0c0e" strokeWidth={30} fill="none" strokeLinecap="round" />
    <rect x={760} y={1688} width={46} height={56} rx={5} fill="#0e0f12" stroke="#3a3f48" strokeWidth={2} />
    <rect x={766} y={1694} width={34} height={22} rx={3} fill="#2d3138" />
    <text x={783} y={1712} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={16} fill="#c8ced6">I</text>
  </svg>
);

/** Plug position and depth for the cable's story. depth 1 = hovering in front of the panel, 0 = seated. */
function plugState(t: number): { x: number; y: number; depth: number; visible: boolean } {
  const hoverA = { x: PORT_A.x, y: PORT_A.y };
  const hoverB = { x: PORT_B.x, y: PORT_B.y };
  const rest = { x: 90 + Math.sin(t * 2.4) * 10, y: 1330 + Math.cos(t * 2.4) * 6 }; // dangling, swaying a little
  if (t < T.cableStart) return { ...rest, depth: 1, visible: true };
  if (t < T.hoverA) {
    const k = lerp(t, [T.cableStart, T.hoverA], [0, 1], Easing.bezier(0.3, 0, 0.15, 1));
    return { x: rest.x + (hoverA.x - rest.x) * k, y: rest.y + (hoverA.y - rest.y) * k - Math.sin(k * Math.PI) * 90, depth: 1, visible: true };
  }
  if (t < T.unplugA) {
    return { ...hoverA, depth: lerp(t, [T.plugA - 0.22, T.plugA], [1, 0], Easing.bezier(0.6, 0, 0.9, 0.6)), visible: true };
  }
  if (t < T.hoverB) {
    const out = lerp(t, [T.unplugA, T.unplugA + 0.18], [0, 1]);
    const k = lerp(t, [T.unplugA + 0.15, T.hoverB], [0, 1], Easing.bezier(0.4, 0, 0.15, 1));
    return { x: hoverA.x + (hoverB.x - hoverA.x) * k, y: hoverA.y + (hoverB.y - hoverA.y) * k + Math.sin(k * Math.PI) * 70, depth: out, visible: true };
  }
  return { ...hoverB, depth: lerp(t, [T.plugB - 0.22, T.plugB], [1, 0], Easing.bezier(0.6, 0, 0.9, 0.6)), visible: true };
}

/** The monitor's HDMI cable: hangs from the monitor (above left), its plug seen from behind. */
const Cable: React.FC<{ t: number }> = ({ t }) => {
  const p = plugState(t);
  if (!p.visible) return null;
  const s = 1 + 0.22 * p.depth; // closer to camera when hovering
  const shadow = 8 + 26 * p.depth;
  const o = CABLE_ORIGIN;
  // Gravity: the cable sags between the monitor and the plug.
  const c1 = { x: o.x + 180, y: o.y + 260 };
  const c2 = { x: p.x - 200, y: p.y + 120 + 40 * p.depth };
  const d = `M ${o.x} ${o.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p.x - 18} ${p.y}`;
  return (
    <svg width={1080} height={1960} viewBox="0 0 1080 1960" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <defs>
        <filter id="cableShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={6 + 8 * p.depth} />
        </filter>
      </defs>
      <path d={d} transform={`translate(${shadow * 0.6} ${shadow})`} stroke="rgba(0,0,0,0.55)" strokeWidth={30} fill="none" strokeLinecap="round" filter="url(#cableShadow)" />
      <path d={d} stroke="#5d636d" strokeWidth={30} fill="none" strokeLinecap="round" />
      <path d={d} stroke="#c9ced6" strokeWidth={24} fill="none" strokeLinecap="round" />
      <path d={d} stroke="rgba(255,255,255,0.55)" strokeWidth={6} fill="none" strokeLinecap="round" transform="translate(-3 -5)" />
      <g transform={`translate(${p.x} ${p.y}) scale(${s})`}>
        <rect x={-74 + shadow * 0.4} y={-36 + shadow * 0.7} width={148} height={72} rx={14} fill="rgba(0,0,0,0.5)" filter="url(#cableShadow)" />
        <rect x={-74} y={-36} width={148} height={72} rx={14} fill="#d6dae0" stroke="#7a818c" strokeWidth={3} />
        <rect x={-74} y={-36} width={148} height={20} rx={10} fill="rgba(255,255,255,0.45)" />
        <circle r={21} fill="#c9ced6" stroke="#8a919c" strokeWidth={3} />
      </g>
    </svg>
  );
};

/** Desktop shown once the monitor wakes: a generic wallpaper and bar, no brand. */
const Desktop: React.FC<{ opacity: number }> = ({ opacity }) => (
  <AbsoluteFill style={{ opacity }}>
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 30% 25%, #3a63d8 0%, #1f2f7a 40%, #0e1438 80%)" }} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 80% 90%, rgba(150,90,255,0.45), transparent 55%)" }} />
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ position: "absolute", left: "4%", top: `${8 + i * 17}%`, width: "6%", height: "11%", borderRadius: "16%", background: "rgba(255,255,255,0.22)" }} />
    ))}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "9%", background: "rgba(10,14,30,0.75)" }} />
    {[0, 1, 2, 3].map((i) => (
      <div key={i} style={{ position: "absolute", left: `${41 + i * 5}%`, bottom: "2%", width: "3.2%", height: "5%", borderRadius: "22%", background: "rgba(255,255,255,0.55)" }} />
    ))}
  </AbsoluteFill>
);

/** What the monitor shows at time t: NO SIGNAL until the card's port is connected, then input name, then desktop. */
const ScreenContent: React.FC<{ t: number; scale: number }> = ({ t, scale }) => {
  const awake = t >= T.plugB;
  const osd = interpolate(t, [T.osd, T.osd + 0.12, T.desktop - 0.05, T.desktop + 0.1], [0, 1, 1, 0], clamp);
  const desk = lerp(t, [T.desktop, T.desktop + 0.5], [0, 1]);
  return (
    <AbsoluteFill style={{ background: "#06070a" }}>
      {!awake ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ padding: `${18 * scale}px ${34 * scale}px`, background: "rgba(24,26,32,0.96)", border: `${3 * scale}px solid #4c525e`, borderRadius: 6 * scale, color: C.text, fontFamily: FONT, fontWeight: 800, fontSize: 76 * scale, letterSpacing: 5 * scale, lineHeight: 1 }}>
            NO SIGNAL
          </div>
        </AbsoluteFill>
      ) : (
        <>
          <Desktop opacity={desk} />
          <div style={{ position: "absolute", left: 30 * scale, top: 26 * scale, opacity: osd, padding: `${8 * scale}px ${18 * scale}px`, background: "rgba(24,26,32,0.92)", border: `${2 * scale}px solid #4c525e`, borderRadius: 5 * scale, color: C.text, fontFamily: FONT, fontWeight: 700, fontSize: 40 * scale }}>
            HDMI
          </div>
        </>
      )}
    </AbsoluteFill>
  );
};

/** The front of the desk: tower with lit fans, the monitor, the room lit by whatever is on. */
const FrontScene: React.FC<{ t: number; local: number }> = ({ t, local }) => {
  const awake = t >= T.plugB;
  const powerUp = lerp(t, [0, 0.35], [0.45, 1]);
  const screenLight = awake ? lerp(t, [T.desktop, T.desktop + 0.6], [0, 1]) : 0;
  const push = lerp(local, [0, 2.6], [1.04, 1.1], Easing.bezier(0.33, 0, 0.2, 1));
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ scale: String(push), transformOrigin: "45% 48%" }}>
        <AbsoluteFill style={{ background: "linear-gradient(180deg,#0b0d13 0%,#0e1119 60%,#0b0c10 100%)" }} />
        {/* PC light on the wall */}
        <AbsoluteFill style={{ opacity: powerUp * 0.9, background: "radial-gradient(ellipse 560px 820px at 930px 980px, rgba(140,70,255,0.26), rgba(40,140,255,0.10) 45%, transparent 75%)" }} />
        {/* the payoff: the screen lights the room */}
        <AbsoluteFill style={{ opacity: screenLight, background: "radial-gradient(ellipse 760px 700px at 470px 820px, rgba(80,120,255,0.38), rgba(80,120,255,0.10) 50%, transparent 78%)" }} />
        {/* monitor */}
        <div style={{ position: "absolute", left: 425, top: 1060, width: 90, height: 215, background: "linear-gradient(90deg,#15171c,#23262d 50%,#121419)" }} />
        <div style={{ position: "absolute", left: 285, top: 1252, width: 370, height: 34, borderRadius: "50%", background: "radial-gradient(ellipse at 50% 30%, #2a2d34, #101115 70%)" }} />
        <div style={{ position: "absolute", left: 30, top: 545, width: 880, height: 530, borderRadius: 14, background: "#121318", boxShadow: `0 30px 80px rgba(0,0,0,0.6), 0 0 ${120 * screenLight}px rgba(90,130,255,${0.45 * screenLight})` }}>
          <div style={{ position: "absolute", inset: 14, borderRadius: 4, overflow: "hidden" }}>
            <ScreenContent t={t} scale={1} />
          </div>
          <div style={{ position: "absolute", right: 34, bottom: 4, width: 8, height: 8, borderRadius: 4, background: "#e8f0ff", boxShadow: "0 0 10px 3px rgba(200,220,255,0.6)" }} />
        </div>
        {/* desk */}
        <div style={{ position: "absolute", left: 0, top: 1275, width: 1080, height: 645, background: "linear-gradient(180deg,#1a1612 0%,#120f0c 40%,#0a0908 100%)" }} />
        <div style={{ position: "absolute", left: 0, top: 1275, width: 1080, height: 3, background: "rgba(255,255,255,0.07)" }} />
        <div style={{ position: "absolute", left: 120, top: 1270, width: 760, height: 220, opacity: screenLight, background: "radial-gradient(ellipse at 50% 0%, rgba(90,130,255,0.30), transparent 70%)" }} />
        <div style={{ position: "absolute", left: 640, top: 1240, width: 520, height: 260, opacity: powerUp, background: "radial-gradient(ellipse at 50% 15%, rgba(150,70,255,0.33), rgba(40,140,255,0.12) 45%, transparent 72%)" }} />
        {/* tower front: three lit intake fans */}
        <div style={{ position: "absolute", left: 772, top: 615, width: 300, height: 668, borderRadius: 10, background: "linear-gradient(90deg,#0d0e11,#17191e 40%,#101115)", boxShadow: "-20px 30px 70px rgba(0,0,0,0.7)" }}>
          <div style={{ position: "absolute", left: 128, top: 16, width: 44, height: 22, borderRadius: 11, background: "#1d2026", border: "1px solid #2c3038" }}>
            <div style={{ position: "absolute", left: 18, top: 7, width: 8, height: 8, borderRadius: 4, background: "#7fd0ff", opacity: powerUp, boxShadow: "0 0 10px 3px rgba(120,200,255,0.8)" }} />
          </div>
        </div>
        <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: powerUp }}>
          {[{ y: 772, hue: 265 }, { y: 970, hue: 215 }, { y: 1168, hue: 290 }].map(({ y, hue }, i) => {
            const r = 98;
            const angle = i * 23 + t * 330;
            return (
              <g key={y} transform={`translate(922 ${y})`}>
                <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={16} fill="#0c0d10" stroke="#1d1f24" strokeWidth={3} />
                <circle r={r * 0.93} fill="none" stroke={`hsl(${hue},85%,62%)`} strokeWidth={7} />
                <circle r={r * 1.05} fill="none" stroke={`hsla(${hue},90%,60%,0.25)`} strokeWidth={14} />
                <circle r={r * 0.85} fill="#08090b" />
                <g transform={`rotate(${angle})`}>
                  {Array.from({ length: 7 }, (_, k) => (
                    <path key={k} transform={`rotate(${(k * 360) / 7})`} d={`M ${r * 0.24} ${-r * 0.06} C ${r * 0.5} ${-r * 0.32}, ${r * 0.78} ${-r * 0.22}, ${r * 0.82} ${r * 0.02} L ${r * 0.3} ${r * 0.1} Z`} fill={`hsla(${hue},35%,32%,0.95)`} />
                  ))}
                </g>
                <circle r={r * 0.25} fill="#15171b" stroke="#25282e" strokeWidth={2} />
              </g>
            );
          })}
        </svg>
        <div style={{ position: "absolute", left: 772, top: 1262, width: 300, height: 21, borderRadius: "0 0 10px 10px", background: "#0d0e11" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 70% at 50% 48%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};

/** Camera over the rear panel: focus point and zoom keyed to the story. */
function rearCamera(t: number): { fx: number; fy: number; s: number } {
  const keys: [number, number, number, number][] = [
    // t, fx, fy, scale
    [T.whipEnd - 0.3, 560, 1120, 0.98],
    [T.cableStart, 545, 1095, 1.02],
    [T.plugA, 430, 960, 1.1],
    [T.why, 360, 880, 1.22],
    [T.unplugA, 345, 860, 1.28],
    [T.hoverB, 520, 1080, 1.12],
    [T.plugB, 540, 1110, 1.1],
  ];
  const times = keys.map((k) => k[0]);
  const at = (i: number) => interpolate(t, times, keys.map((k) => k[i]), { ...clamp, easing: Easing.bezier(0.45, 0, 0.25, 1) });
  return { fx: at(1), fy: at(2), s: at(3) };
}

const Badge: React.FC<{ label: string; x: number; y: number; color: string; mark?: "x" | "check"; pulse: number; appear: number }> = ({ label, x, y, color, mark, pulse, appear }) => (
  <div style={{ position: "absolute", left: x - 50, top: y - 50, width: 100, height: 100, scale: String(appear * (1 + 0.06 * pulse)), opacity: appear }}>
    <div style={{ position: "absolute", inset: 0, borderRadius: 50, background: color, boxShadow: `0 8px 28px rgba(0,0,0,0.55), 0 0 0 6px rgba(10,12,16,0.85)` }} />
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontWeight: 800, fontSize: 60, color: "#0b0d12" }}>{label}</div>
    {mark ? (
      <div style={{ position: "absolute", right: -18, top: -18, width: 52, height: 52, borderRadius: 26, background: "#0b0d12", display: "flex", alignItems: "center", justifyContent: "center", color, fontFamily: FONT, fontWeight: 800, fontSize: 38 }}>{mark === "x" ? "✕" : "✓"}</div>
    ) : null}
  </div>
);

/** Rear-view shot: panel under a moving camera, cable, badges and the monitor inset. */
const RearScene: React.FC<{ t: number; takeaway?: boolean }> = ({ t, takeaway }) => {
  const { fps } = useVideoConfig();
  const cam = takeaway ? { fx: 545, fy: 1080, s: lerp(t, [T.takeaway, T.duration], [0.97, 1.0]) } : rearCamera(t);
  const CX = 540, CY = 1060; // where the focus lands on screen
  const toScreen = (p: { x: number; y: number }) => ({ x: (p.x - cam.fx) * cam.s + CX, y: (p.y - cam.fy) * cam.s + CY });
  const aDone = t >= T.plugA + 0.15;
  const bDone = t >= T.plugB;
  const glowA = takeaway ? C.a : aDone && t < T.unplugA ? C.a : undefined;
  const glowB = takeaway || bDone ? C.b : undefined;
  const appear = takeaway ? 1 : lerp(t, [T.question, T.question + 0.25], [0, 1], Easing.bezier(0.2, 1.4, 0.4, 1));
  const tickPulse = T.ticks.reduce((acc, tk) => acc + Math.max(0, 1 - Math.abs(t - tk) * 6), 0);
  const a = toScreen(PORT_A), b = toScreen(PORT_B);
  const dim = takeaway ? lerp(t, [T.takeaway, T.takeaway + 0.4], [0, 0.55]) : 0;
  // Click shake on each connection.
  const shake = [T.plugA, T.plugB].reduce((acc, k) => acc + (t >= k && t < k + 0.2 ? Math.sin((t - k) * 90) * 5 * (1 - (t - k) / 0.2) : 0), 0);
  void fps;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 900px 1100px at 50% 55%, #141821 0%, #0a0c10 70%)" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1960, transformOrigin: "0 0", transform: `translate(${CX + shake}px, ${CY}px) scale(${cam.s}) translate(${-cam.fx}px, ${-cam.fy}px)` }}>
        <RearPanel t={t} glowA={glowA} glowB={glowB} dimOthers={dim} />
        <Cable t={t} />
      </div>
      {/* the two choices */}
      <Badge label="A" x={a.x - 130 * cam.s} y={a.y} color={aDone || takeaway ? C.a : C.neutral} mark={aDone || takeaway ? "x" : undefined} pulse={tickPulse} appear={appear} />
      <Badge label="B" x={b.x} y={b.y + 118 * cam.s} color={bDone || takeaway ? C.b : C.neutral} mark={bDone || takeaway ? "check" : undefined} pulse={tickPulse} appear={appear} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 90% 75% at 50% 52%, transparent 58%, rgba(0,0,0,0.6) 100%)" }} />
    </AbsoluteFill>
  );
};

/** A small live view of the monitor, so the result of each move is visible from behind the PC. */
const MonitorInset: React.FC<{ t: number; appear: number }> = ({ t, appear }) => {
  const awake = t >= T.plugB;
  return (
    <div style={{ position: "absolute", left: 560, top: 300, width: 470, height: 290, opacity: appear, translate: `0px ${(1 - appear) * -30}px` }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 18, background: "#121318", boxShadow: `0 18px 50px rgba(0,0,0,0.7), 0 0 ${awake ? 60 : 0}px rgba(90,130,255,0.5)`, border: "2px solid #2a2e36" }}>
        <div style={{ position: "absolute", inset: 12, borderRadius: 6, overflow: "hidden" }}>
          <ScreenContent t={t} scale={0.56} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 6, top: -42, fontFamily: FONT, fontWeight: 600, fontSize: 30, color: C.muted, letterSpacing: 1 }}>MONITOR</div>
    </div>
  );
};

const Caption: React.FC<{ text: string; t: number; from: number; to: number; top?: number; size?: number; color?: string }> = ({ text, t, from, to, top = 150, size = 66, color = C.text }) => {
  const o = interpolate(t, [from, from + 0.15, to - 0.12, to], [0, 1, 1, 0], clamp);
  if (o <= 0) return null;
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top, textAlign: "center", opacity: o, translate: `0px ${(1 - o) * 14}px`, fontFamily: FONT, fontWeight: 800, fontSize: size, color, lineHeight: 1.12, textShadow: "0 4px 24px rgba(0,0,0,0.8)" }}>
      {text}
    </div>
  );
};

/** The why: one fact about this PC, kept at the bottom, away from the ports. */
const WhyCard: React.FC<{ t: number }> = ({ t }) => {
  const o = interpolate(t, [T.why, T.why + 0.2, T.unplugA - 0.1, T.unplugA + 0.1], [0, 1, 1, 0], clamp);
  if (o <= 0) return null;
  const line2 = lerp(t, [T.why + 0.7, T.why + 0.9], [0, 1]);
  return (
    <div style={{ position: "absolute", left: 50, right: 50, top: 120, opacity: o, translate: `0px ${(1 - o) * 30}px`, padding: "34px 40px", borderRadius: 26, background: "rgba(12,14,19,0.92)", border: "2px solid #2b3039", fontFamily: FONT, color: C.text }}>
      <div style={{ fontSize: 40, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>This PC’s CPU: Core i5-12400F</div>
      <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1.12, marginTop: 10 }}>No built-in graphics.</div>
      <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.15, marginTop: 12, color: C.a, opacity: line2 }}>Port A has no picture to send.</div>
    </div>
  );
};

const TakeawayLabels: React.FC<{ t: number }> = ({ t }) => {
  const la = lerp(t, [T.takeaway + 0.15, T.takeaway + 0.45], [0, 1]);
  const lb = lerp(t, [T.takeaway + 0.35, T.takeaway + 0.65], [0, 1]);
  const line = lerp(t, [T.line, T.line + 0.3], [0, 1]);
  const sign = lerp(t, [T.signoff, T.signoff + 0.4], [0, 1]);
  const label = (o: number, top: number, color: string, title: string, sub: string) => (
    <div style={{ position: "absolute", left: 60, right: 60, top, opacity: o, translate: `${(1 - o) * -30}px 0px`, display: "flex", gap: 22, alignItems: "flex-start", fontFamily: FONT }}>
      <div style={{ width: 14, alignSelf: "stretch", borderRadius: 7, background: color }} />
      <div>
        <div style={{ fontSize: 52, fontWeight: 800, color: C.text, lineHeight: 1.1 }}>{title}</div>
        <div style={{ fontSize: 40, fontWeight: 600, color, lineHeight: 1.2, marginTop: 6 }}>{sub}</div>
      </div>
    </div>
  );
  return (
    <>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,12,16,0.92) 0%, rgba(10,12,16,0.0) 22%, rgba(10,12,16,0.0) 66%, rgba(10,12,16,0.94) 80%)" }} />
      {label(la, 120, C.a, "A · Motherboard port", "Needs a CPU with built-in graphics")}
      {label(lb, 330, C.b, "B · Graphics card port", "Plug the monitor in here")}
      <div style={{ position: "absolute", left: 60, right: 60, top: 1540, opacity: line, fontFamily: FONT, fontWeight: 800, fontSize: 58, lineHeight: 1.15, color: C.text, textAlign: "center" }}>
        Have a graphics card? Check where the monitor is plugged in.
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1790, opacity: sign * 0.85, textAlign: "center", fontFamily: FONT, fontWeight: 700, fontSize: 34, letterSpacing: 3, color: C.muted }}>
        SPECSMITH
      </div>
    </>
  );
};

export const Puzzle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const inFront1 = t < T.whipEnd;
  const inRear = t >= T.front1End && t < T.front2;
  const inFront2 = t >= T.front2 && t < T.takeaway;
  const inTakeaway = t >= T.takeaway;

  // Whip pan from the front of the desk round to the back of the PC.
  const whip = lerp(t, [T.front1End, T.whipEnd], [0, 1], Easing.bezier(0.6, 0, 0.3, 1));
  const whipBlur = Math.sin(whip * Math.PI) * 18;
  const whyHide = interpolate(t, [T.why - 0.15, T.why, T.unplugA, T.unplugA + 0.2], [1, 0, 0, 1], clamp);
  const inset = inRear ? lerp(t, [T.whipEnd, T.whipEnd + 0.3], [0, 1]) * whyHide : 0;

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Audio src={staticFile("puzzle-sound.wav")} />
      {inFront1 ? (
        <AbsoluteFill style={{ translate: `${-whip * 1080}px 0px`, filter: `blur(${whipBlur}px)` }}>
          <FrontScene t={t} local={t} />
        </AbsoluteFill>
      ) : null}
      {inRear ? (
        <AbsoluteFill style={{ translate: `${(1 - whip) * 1080}px 0px`, filter: `blur(${whipBlur}px)` }}>
          <RearScene t={t} />
        </AbsoluteFill>
      ) : null}
      {inFront2 ? <FrontScene t={t} local={t - T.front2} /> : null}
      {inTakeaway ? <RearScene t={t} takeaway /> : null}

      {inRear ? <MonitorInset t={t} appear={inset} /> : null}

      <Caption text="Which port?" t={t} from={T.question} to={T.plugA + 0.1} />
      <Caption text="A: still no signal" t={t} from={T.plugA + 0.15} to={T.why} color={C.a} />
      <Caption text="Try B: the graphics card" t={t} from={T.unplugA + 0.1} to={T.front2} />
      <Caption text="B ✓ Picture" t={t} from={T.front2 + 0.25} to={T.takeaway} top={170} color={C.b} />
      <WhyCard t={t} />
      {inTakeaway ? <TakeawayLabels t={t} /> : null}
    </AbsoluteFill>
  );
};

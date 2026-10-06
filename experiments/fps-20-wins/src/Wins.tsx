// "20 wins. Only 4 FPS apart?": one standalone Short.
//
// Every number on screen comes from verified.json, which verify/verify.mts
// recomputes from SpecSmith's Compare model; the /compare page shows the same
// 20 vs 0 leads and 164 vs 160 averages. These are model estimates, not
// measured benchmarks, and the footer says so on every frame. Timings come from
// timeline.json, which the sound uses too. Drawn in code; no footage.

import "@fontsource/inter/600.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import T from "./timeline.json";
import V from "./verified.json";

const FONT = "Inter, sans-serif";
const C = {
  bg: "#07080c",
  ink: "#f4f6fa",
  muted: "rgba(244,246,250,0.66)",
  sup: "#ffb21f", // RTX 4080 Super
  base: "#7fa8ff", // RTX 4080
  line: "#2a2f3a",
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);
const pop = Easing.bezier(0.2, 1.5, 0.4, 1);
const lerp = (t: number, [t0, t1]: [number, number], [a, b]: [number, number], e = ease) => interpolate(t, [t0, t1], [a, b], { ...clamp, easing: e });
const fade = (t: number, from: number, to: number, inS = 0.15, outS = 0.15) => interpolate(t, [from, from + inS, to - outS, to], [0, 1, 1, 0], clamp);

const NAMED = ["Cyberpunk 2077", "Fortnite", "Valorant"];
const SUPER = V.inputs.gpuAName.toUpperCase(); // "RTX 4080 SUPER"
const BASE = V.inputs.gpuBName.toUpperCase(); // "RTX 4080"

/** How many leads have landed by time t. */
const leadsAt = (t: number) => T.beats.filter((b) => t >= b).length;

const Footer: React.FC = () => (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, textAlign: "center", fontFamily: FONT, fontWeight: 600, fontSize: 32, color: C.muted, letterSpacing: 0.5 }}>
    SpecSmith model estimates · not measured benchmarks
  </div>
);

/** The matchup plate at the top: both GPUs and the setting. */
const Matchup: React.FC<{ t: number }> = ({ t }) => {
  const inA = lerp(t, [0, 0.45], [-90, 0], Easing.bezier(0.1, 0.9, 0.2, 1));
  const inB = lerp(t, [0, 0.45], [90, 0], Easing.bezier(0.1, 0.9, 0.2, 1));
  const shrink = lerp(t, [1.25, 1.5], [1, 0.72]);
  const y = lerp(t, [1.25, 1.5], [430, 150]);
  const gone = 1 - lerp(t, [T.collapse - 0.1, T.collapse + 0.2], [0, 1]);
  const settingIn = lerp(t, [0.45, 0.7], [0, 1]);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, scale: String(shrink), transformOrigin: "50% 0%", opacity: gone, fontFamily: FONT, textAlign: "center" }}>
      <div style={{ translate: `${inA}px 0px`, fontWeight: 900, fontSize: 92, color: C.sup, letterSpacing: -1, lineHeight: 1, transform: "skewX(-8deg)" }}>{SUPER}</div>
      <div style={{ fontWeight: 800, fontSize: 40, color: C.muted, margin: "14px 0" }}>vs</div>
      <div style={{ translate: `${inB}px 0px`, fontWeight: 900, fontSize: 92, color: C.base, letterSpacing: -1, lineHeight: 1, transform: "skewX(-8deg)" }}>{BASE}</div>
      <div style={{ opacity: settingIn, marginTop: 26, fontWeight: 700, fontSize: 38, color: C.ink }}>Same {V.inputs.cpuName} · 1440p High</div>
      <div style={{ opacity: settingIn, marginTop: 8, fontWeight: 600, fontSize: 34, color: C.muted }}>{V.games} games</div>
    </div>
  );
};

/** The 20-game board: tiles flip to the Super as each modelled lead lands. */
const Board: React.FC<{ t: number }> = ({ t }) => {
  const appear = lerp(t, [1.3, 1.6], [0, 1]);
  const collapse = lerp(t, [T.collapse, T.collapse + 0.4], [0, 1], Easing.bezier(0.7, 0, 0.9, 0.4));
  const stepBack = lerp(t, [T.land, T.land + 0.3], [1, 0.14]);
  const cols = 4, w = 196, h = 104, gap = 18;
  const left = (1080 - (cols * w + (cols - 1) * gap)) / 2;
  const top = 640;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920, opacity: appear * (1 - collapse) * stepBack, translate: `0px ${(1 - stepBack) * 470}px` }}>
      {T.beats.map((beat, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const won = t >= beat;
        const p = lerp(t, [beat, beat + 0.18], [1.35, 1], pop);
        // On collapse every tile flies to the ruler's Super mark.
        const x = left + col * (w + gap), y = top + row * (h + gap);
        const tx = (870 - x) * collapse, ty = (820 - y) * collapse;
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: w, height: h, translate: `${tx}px ${ty}px`, scale: String(won ? p * (1 - 0.8 * collapse) : 1), borderRadius: 14, background: won ? C.sup : "rgba(255,255,255,0.04)", border: `3px solid ${won ? C.sup : C.line}`, boxShadow: won ? `0 0 ${30 * Math.max(0, 1 - (t - beat) * 3)}px ${C.sup}` : "none", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontWeight: 900, fontSize: 34, color: won ? "#1a1203" : "rgba(255,255,255,0.18)", letterSpacing: 1 }}>
            {won ? "SUPER" : i + 1}
          </div>
        );
      })}
    </div>
  );
};

/** The first three leads, named, large enough to read on a phone. */
const NamedBeat: React.FC<{ t: number }> = ({ t }) => {
  const i = T.beats.slice(0, T.namedBeats).findLastIndex((b) => t >= b);
  if (i < 0) return null;
  const start = T.beats[i];
  const end = i + 1 < T.namedBeats ? T.beats[i + 1] : T.beats[T.namedBeats] + 0.05;
  const o = fade(t, start, end, 0.06, 0.1);
  const slide = lerp(t, [start, start + 0.18], [80, 0], Easing.bezier(0.1, 0.9, 0.2, 1));
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top: 1290, opacity: o, translate: `${slide}px 0px`, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontWeight: 900, fontSize: 70, color: C.ink, lineHeight: 1.05 }}>{NAMED[i]}</div>
      <div style={{ marginTop: 12, fontWeight: 800, fontSize: 42, color: C.sup, letterSpacing: 2 }}>SUPER LEADS</div>
    </div>
  );
};

/** The running count, then the 20/20 landing. */
const Counter: React.FC<{ t: number }> = ({ t }) => {
  const n = leadsAt(t);
  const show = t >= T.beats[T.namedBeats] + 0.02 && t < T.collapse + 0.2;
  if (!show) return null;
  const landed = t >= T.land;
  const big = lerp(t, [T.land, T.land + 0.25], [1, 1.55], pop);
  const y = lerp(t, [T.land, T.land + 0.25], [1300, 760]);
  const out = 1 - lerp(t, [T.collapse, T.collapse + 0.2], [0, 1]);
  const lastBeat = T.beats.filter((b) => t >= b).at(-1) ?? 0;
  const bump = lerp(t, [lastBeat, lastBeat + 0.12], [1.12, 1], pop);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, opacity: out, textAlign: "center", fontFamily: FONT, scale: String(landed ? big : bump), transformOrigin: "50% 30%" }}>
      <div style={{ fontWeight: 900, fontSize: 120, lineHeight: 1, color: C.ink }}>
        <span style={{ color: C.sup }}>{n}</span>
        <span style={{ color: C.muted }}> / {V.games}</span>
      </div>
      <div style={{ marginTop: 10, fontWeight: 800, fontSize: landed ? 32 : 36, color: C.ink, letterSpacing: 1 }}>MODELLED GAME LEADS</div>
      {landed ? <div style={{ marginTop: 4, fontWeight: 700, fontSize: 26, color: C.muted, letterSpacing: 1 }}>{V.ties} TIES · {V.leadsB} FOR THE {BASE}</div> : null}
    </div>
  );
};

/** The payoff: two average-FPS marks on a full 0-180 ruler, then a labelled zoom. */
const Payoff: React.FC<{ t: number }> = ({ t }) => {
  if (t < T.collapse + 0.2) return null;
  const rulerIn = lerp(t, [T.ruler - 0.1, T.ruler + 0.3], [0, 1]);
  const markA = lerp(t, [T.marks, T.marks + 0.8], [0, V.avgA], Easing.bezier(0.2, 0.8, 0.2, 1));
  const markB = lerp(t, [T.marks + 0.1, T.marks + 0.9], [0, V.avgB], Easing.bezier(0.2, 0.8, 0.2, 1));
  const MAX = 180, X0 = 90, W = 900;
  const xOf = (fps: number) => X0 + (fps / MAX) * W;
  const zoomIn = lerp(t, [T.zoom, T.zoom + 0.45], [0, 1], Easing.bezier(0.2, 0.9, 0.2, 1));
  const Z0 = 158, Z1 = 166;
  const zx = (fps: number) => X0 + ((fps - Z0) / (Z1 - Z0)) * W;
  const apart = lerp(t, [T.apart, T.apart + 0.3], [0, 1], pop);
  const head = fade(t, T.ruler, T.question - 0.05, 0.25, 0.25);
  const RY = 960; // full ruler baseline
  const ZY = 1390; // zoom ruler baseline
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 60, right: 60, top: 170, opacity: head, textAlign: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 64, lineHeight: 1.05, color: C.sup }}>20 / 20 modelled leads…</div>
        <div style={{ marginTop: 14, opacity: apart, scale: String(0.6 + 0.4 * apart), fontWeight: 900, fontSize: 128, lineHeight: 1, color: C.ink }}>4 FPS apart</div>
        <div style={{ marginTop: 18, fontWeight: 800, fontSize: 38, color: C.muted }}>Estimated average FPS · 1440p High</div>
        <div style={{ marginTop: 6, opacity: apart, fontWeight: 700, fontSize: 30, color: C.muted }}>Averages as shown on SpecSmith Compare</div>
      </div>
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: head }}>
        {/* full scale, from zero: the honest view */}
        <g opacity={rulerIn}>
          <line x1={X0} y1={RY} x2={X0 + W} y2={RY} stroke="#5b6170" strokeWidth={4} />
          {[0, 30, 60, 90, 120, 150, 180].map((v) => (
            <g key={v}>
              <line x1={xOf(v)} y1={RY - 14} x2={xOf(v)} y2={RY + 14} stroke="#5b6170" strokeWidth={3} />
              <text x={xOf(v)} y={RY + 56} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={30} fill={C.muted}>{v}</text>
            </g>
          ))}
          <text x={X0} y={RY + 100} fontFamily={FONT} fontWeight={600} fontSize={28} fill={C.muted}>Full scale, from 0 FPS</text>
        </g>
        {/* bars from zero, almost the same length */}
        <rect x={X0} y={RY - 150} width={(markA / MAX) * W} height={56} rx={8} fill={C.sup} />
        <rect x={X0} y={RY - 82} width={(markB / MAX) * W} height={56} rx={8} fill={C.base} />
        <text x={X0 + 18} y={RY - 110} fontFamily={FONT} fontWeight={900} fontSize={34} fill="#1a1203" opacity={markA > 40 ? 1 : 0}>SUPER {Math.round(markA)}</text>
        <text x={X0 + 18} y={RY - 42} fontFamily={FONT} fontWeight={900} fontSize={34} fill="#0b1630" opacity={markB > 40 ? 1 : 0}>4080 {Math.round(markB)}</text>
        {/* the zoom, labelled as a zoom, joined to the part of the ruler it magnifies */}
        <g opacity={zoomIn}>
          <rect x={xOf(Z0) - 4} y={RY - 170} width={xOf(Z1) - xOf(Z0) + 8} height={190} rx={6} fill="none" stroke={C.ink} strokeWidth={3} strokeDasharray="10 8" />
          <line x1={xOf(Z0)} y1={RY + 20} x2={X0} y2={ZY - 150} stroke="rgba(244,246,250,0.35)" strokeWidth={2} />
          <line x1={xOf(Z1)} y1={RY + 20} x2={X0 + W} y2={ZY - 150} stroke="rgba(244,246,250,0.35)" strokeWidth={2} />
          <rect x={X0 - 20} y={ZY - 150} width={W + 40} height={260} rx={18} fill="rgba(255,255,255,0.03)" stroke="rgba(244,246,250,0.35)" strokeWidth={2} />
          <line x1={X0} y1={ZY} x2={X0 + W} y2={ZY} stroke="#5b6170" strokeWidth={4} />
          {[158, 160, 162, 164, 166].map((v) => (
            <g key={v}>
              <line x1={zx(v)} y1={ZY - 12} x2={zx(v)} y2={ZY + 12} stroke="#5b6170" strokeWidth={3} />
              <text x={zx(v)} y={ZY + 52} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={30} fill={C.muted}>{v}</text>
            </g>
          ))}
          <line x1={zx(V.avgA)} y1={ZY - 110} x2={zx(V.avgA)} y2={ZY} stroke={C.sup} strokeWidth={10} strokeLinecap="round" />
          <line x1={zx(V.avgB)} y1={ZY - 110} x2={zx(V.avgB)} y2={ZY} stroke={C.base} strokeWidth={10} strokeLinecap="round" />
          <text x={zx(V.avgA)} y={ZY - 124} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={40} fill={C.sup}>{V.avgA}</text>
          <text x={zx(V.avgB)} y={ZY - 124} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={40} fill={C.base}>{V.avgB}</text>
          <g opacity={apart}>
            <line x1={zx(V.avgB)} y1={ZY - 60} x2={zx(V.avgA)} y2={ZY - 60} stroke={C.ink} strokeWidth={4} />
            <text x={(zx(V.avgA) + zx(V.avgB)) / 2} y={ZY - 72} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={36} fill={C.ink}>4</text>
          </g>
          <text x={X0} y={ZY + 96} fontFamily={FONT} fontWeight={600} fontSize={28} fill={C.muted}>Zoomed in: {Z0}–{Z1} FPS</text>
        </g>
      </svg>
    </AbsoluteFill>
  );
};

const Ending: React.FC<{ t: number }> = ({ t }) => {
  const per = fade(t, T.perGame, T.question - 0.05, 0.2, 0.15);
  const q = lerp(t, [T.question, T.question + 0.35], [0, 1], pop);
  const sign = lerp(t, [T.signoff, T.signoff + 0.4], [0, 1]);
  return (
    <>
      <div style={{ position: "absolute", left: 60, right: 60, top: 1600, opacity: per, textAlign: "center", fontFamily: FONT, fontWeight: 800, fontSize: 50, color: C.ink }}>
        Each modelled lead: {V.perGameLeadRange[0]}–{V.perGameLeadRange[1]} FPS
      </div>
      {t >= T.question ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
          <div style={{ opacity: q, scale: String(0.85 + 0.15 * q), textAlign: "center", fontWeight: 900, fontSize: 104, lineHeight: 1.05, color: C.ink, padding: "0 70px" }}>
            Would you have guessed <span style={{ color: C.sup }}>four</span>?
          </div>
          <div style={{ position: "absolute", bottom: 160, opacity: sign * 0.8, fontWeight: 800, fontSize: 34, letterSpacing: 4, color: C.muted }}>SPECSMITH</div>
        </AbsoluteFill>
      ) : null}
    </>
  );
};

export const Wins: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Camera: a different move for each stretch, plus a hit on every fifth lead.
  const accents = [4, 9, 14].map((i) => T.beats[i]);
  const hit = accents.reduce((acc, a) => acc + (t >= a && t < a + 0.18 ? Math.sin((t - a) * 80) * 8 * (1 - (t - a) / 0.18) : 0), 0);
  const scale = interpolate(t, [0, 1.3, T.beats[T.namedBeats], T.land - 0.05, T.land + 0.2, T.collapse, T.collapse + 0.4, T.duration], [1.06, 1.0, 1.0, 1.04, 1.07, 1.08, 1.0, 1.02], { ...clamp, easing: ease });
  const tilt = interpolate(t, [T.beats[T.namedBeats], T.land, T.land + 0.3], [0, -1.6, 0], clamp);
  const blowout = fade(t, T.blowout, T.collapse, 0.2, 0.1);
  const flash = t >= T.land && t < T.land + 0.25 ? 0.35 * (1 - (t - T.land) / 0.25) : 0;
  const quiet = lerp(t, [T.collapse, T.collapse + 0.15], [0, 1]) * (1 - lerp(t, [T.ruler, T.ruler + 0.4], [0, 1]));

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Audio src={staticFile("wins-sound.wav")} />
      {/* a hard diagonal split in the two GPUs' colours, fading once the counting starts */}
      <AbsoluteFill style={{ opacity: 1 - lerp(t, [1.3, 1.8], [0, 0.75]), background: `linear-gradient(115deg, rgba(255,178,31,0.16) 0%, rgba(255,178,31,0.05) 49.8%, rgba(127,168,255,0.05) 50.2%, rgba(127,168,255,0.16) 100%)` }} />
      <AbsoluteFill style={{ scale: String(scale), rotate: `${tilt}deg`, translate: `${hit}px 0px` }}>
        <Matchup t={t} />
        <Board t={t} />
        <NamedBeat t={t} />
        <Counter t={t} />
        <Payoff t={t} />
      </AbsoluteFill>
      {/* the question that opens on frame one */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 1240, opacity: interpolate(t, [1.15, 1.35], [1, 0], clamp), textAlign: "center", fontFamily: FONT, fontWeight: 900, fontSize: 84, color: C.ink, scale: String(lerp(t, [0, 1.3], [1.0, 1.06])) }}>
        How big is the gap?
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1180, opacity: blowout, textAlign: "center", fontFamily: FONT, fontWeight: 900, fontSize: 90, color: C.sup }}>A blowout?</div>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
      <AbsoluteFill style={{ background: "#000", opacity: quiet * 0.6 }} />
      <Ending t={t} />
      <Footer />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 90% 75% at 50% 50%, transparent 60%, rgba(0,0,0,0.5) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

// "20 wins. Only 4 FPS apart?": the voiced cut, timed to Liam's real take.
//
// Every time comes from voiceplan.json (voice/plan.mjs, from the provider's
// character timestamps); every figure comes from verified.json (verify.mts,
// recomputed from the Compare model) through `display`, which voice/check.mjs
// compares with the model before a render is accepted. Numbers never count up
// through intermediate values: only verified figures are ever drawn.
//
// Safe area: all text sits between y 230 and 1440 and inside x 90-990, clear of
// the top bar, the bottom description and the right-hand action buttons.

import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export type VoicedProps = {
  plan: {
    duration: number;
    events: { voiceStart: number; spots: number[]; rollTo20: number; land: number; blowout: number; dropStart: number; reveal: number; n164: number; n160: number; apart: number; disclaimer: number; question: number; lastWord: number };
    captions: { show: string; lines: string[]; start: number; end: number; spotlight: number | null }[];
  };
  display: {
    gpuA: string; gpuB: string; cpu: string; setting: string; games: number; leadsA: number; ties: number; leadsB: number;
    avgA: number; avgB: number; gap: number; spotlights: { title: string; rosterPosition: number }[];
  };
  audio: string;
};

const FONT = "Inter, sans-serif";
const C = { bg: "#0A0A0F", surface: "#13131A", ink: "#F0F0FF", muted: "#B7B7D1", sup: "#9B94FF", base: "#00D4FF", line: "#323247" };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);
const snap = Easing.bezier(0.1, 0.9, 0.2, 1);
const pop = Easing.bezier(0.2, 1.45, 0.4, 1);
const lerp = (t: number, [t0, t1]: [number, number], [a, b]: [number, number], e = ease) => interpolate(t, [t0, t1], [a, b], { ...clamp, easing: e });

/** Leads counted on screen at time t: each spotlight is its roster position; then a roll to 20. */
function countAt(t: number, P: VoicedProps["plan"], D: VoicedProps["display"]): number {
  const e = P.events;
  if (t < e.spots[0]) return 0;
  let n = 0;
  D.spotlights.forEach((spot, i) => { if (t >= e.spots[i]) n = spot.rosterPosition; });
  if (t >= e.rollTo20) n = Math.round(lerp(t, [e.rollTo20, e.land], [D.spotlights[D.spotlights.length - 1].rosterPosition, D.games], Easing.linear));
  return n;
}

const EstimateLabel: React.FC<{ t: number; P: VoicedProps["plan"] }> = ({ t, P }) => {
  const emphasis = lerp(t, [P.events.disclaimer, P.events.disclaimer + 0.25], [0, 1]) * (1 - lerp(t, [P.events.question - 0.1, P.events.question + 0.15], [0, 1]));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 1372, display: "flex", justifyContent: "center" }}>
      <div style={{ scale: String(1 + 0.04 * emphasis), padding: "10px 22px", borderRadius: 40, background: emphasis > 0.5 ? "rgba(155,148,255,0.22)" : "rgba(255,255,255,0.08)", border: `2px solid ${emphasis > 0.5 ? C.sup : "rgba(255,255,255,0.16)"}`, fontFamily: FONT, fontWeight: 700, fontSize: 30, color: C.ink, whiteSpace: "nowrap" }}>
        SpecSmith model estimates · not measured benchmarks
      </div>
    </div>
  );
};

/** Every spoken line, except the four game titles (their spotlight card is their caption) and the final question (the end card is). */
const Captions: React.FC<{ t: number; P: VoicedProps["plan"] }> = ({ t, P }) => {
  const cue = P.captions.find((c) => t >= c.start && t < c.end && c.spotlight === null && c.start < P.events.question - 0.01);
  if (!cue) return null;
  const o = interpolate(t, [cue.start, cue.start + 0.06, cue.end - 0.06, cue.end], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: 1196, opacity: o, textAlign: "center", fontFamily: FONT, fontWeight: 900, fontSize: 64, lineHeight: 1.08, color: C.ink, textShadow: "0 4px 18px rgba(0,0,0,0.85)" }}>
      {cue.lines.map((line) => <div key={line}>{line}</div>)}
    </div>
  );
};

const Header: React.FC<{ t: number; D: VoicedProps["display"]; P: VoicedProps["plan"] }> = ({ t, D, P }) => {
  const settle = lerp(t, [0, 0.4], [1, 0], snap);
  const out = 1 - lerp(t, [P.events.reveal - 0.05, P.events.reveal + 0.1], [0, 1]);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 240, opacity: out, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontWeight: 900, fontSize: 82, lineHeight: 1, color: C.sup, translate: `${-70 * settle}px 0px` }}>{D.gpuA.toUpperCase()}</div>
      <div style={{ fontWeight: 800, fontSize: 32, color: C.muted, margin: "8px 0" }}>vs</div>
      <div style={{ fontWeight: 900, fontSize: 82, lineHeight: 1, color: C.base, translate: `${70 * settle}px 0px` }}>{D.gpuB.toUpperCase()}</div>
      <div style={{ marginTop: 16, fontWeight: 700, fontSize: 38, color: C.ink }}>Same {D.cpu} · {D.setting}</div>
    </div>
  );
};

const Counter: React.FC<{ t: number; D: VoicedProps["display"]; P: VoicedProps["plan"] }> = ({ t, D, P }) => {
  const e = P.events;
  const n = countAt(t, P, D);
  const landed = t >= e.land;
  const landPop = lerp(t, [e.land, e.land + 0.28], [1, 1.3], pop);
  const out = 1 - lerp(t, [e.reveal - 0.05, e.reveal + 0.1], [0, 1]);
  const y = lerp(t, [e.land, e.land + 0.28], [590, 640]);
  const changes = [...e.spots, e.land].filter((x) => x <= t);
  const last = changes[changes.length - 1] ?? 0;
  const bump = landed ? 1 : lerp(t, [last, last + 0.14], [1.1, 1], pop);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, opacity: out, textAlign: "center", fontFamily: FONT }}>
      <div style={{ scale: String(landed ? landPop : bump) }}>
        {t < e.spots[0] ? (
          <div style={{ fontWeight: 900, fontSize: 130, lineHeight: 1.06, color: C.ink }}>{D.games} GAMES</div>
        ) : (
          <div style={{ fontWeight: 900, fontSize: 150, lineHeight: 1 }}>
            <span style={{ color: C.sup }}>{n}</span>
            <span style={{ color: C.muted }}> / {D.games}</span>
          </div>
        )}
        <div style={{ marginTop: 8, fontWeight: 800, fontSize: 40, color: C.ink, letterSpacing: 1 }}>{t < e.spots[0] ? "IN SPECSMITH'S MODEL" : "MODELLED GAME LEADS"}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 62px)", gap: 10, justifyContent: "center", marginTop: landed ? 70 : 30 }}>
        {Array.from({ length: D.games }, (_, i) => (
          <div key={i} style={{ height: 22, borderRadius: 5, background: i < n ? C.sup : "rgba(255,255,255,0.08)", border: `2px solid ${i < n ? C.sup : C.line}` }} />
        ))}
      </div>
      {landed ? (
        <div style={{ marginTop: 30, opacity: lerp(t, [e.land + 0.2, e.land + 0.45], [0, 1]), fontWeight: 800, fontSize: 38, color: C.muted, letterSpacing: 1 }}>
          {D.ties} TIES · {D.leadsB} FOR THE {D.gpuB.toUpperCase()}
        </div>
      ) : null}
    </div>
  );
};

const Spotlight: React.FC<{ t: number; D: VoicedProps["display"]; P: VoicedProps["plan"] }> = ({ t, D, P }) => {
  const cues = P.captions.filter((c) => c.spotlight !== null);
  const cue = cues.find((c, k) => t >= c.start && t < (cues[k + 1]?.start ?? P.events.land));
  if (!cue || cue.spotlight === null) return null;
  const i = cue.spotlight;
  const end = cues[cues.indexOf(cue) + 1]?.start ?? P.events.land;
  const o = interpolate(t, [cue.start, cue.start + 0.06, end - 0.08, end], [0, 1, 1, 0], clamp);
  const slide = lerp(t, [cue.start, cue.start + 0.2], [140, 0], snap) * (i % 2 ? -1 : 1);
  return (
    <div style={{ position: "absolute", left: 100, right: 100, top: 1010, opacity: o, translate: `${slide}px 0px`, padding: "30px 24px", borderRadius: 28, background: "rgba(155,148,255,0.12)", border: `3px solid ${C.sup}`, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontWeight: 900, fontSize: 68, lineHeight: 1.05, color: C.ink }}>{D.spotlights[i].title}</div>
      <div style={{ marginTop: 12, fontWeight: 800, fontSize: 36, color: C.sup, letterSpacing: 2 }}>4080 SUPER LEADS</div>
    </div>
  );
};

/** The payoff: final values only, zero-based bars, then ONLY 4 FPS APART. */
const Payoff: React.FC<{ t: number; D: VoicedProps["display"]; P: VoicedProps["plan"] }> = ({ t, D, P }) => {
  const e = P.events;
  if (t < e.reveal - 0.05) return null;
  const inView = lerp(t, [e.reveal - 0.05, e.reveal + 0.2], [0, 1]);
  const a = lerp(t, [e.n164, e.n164 + 0.25], [0, 1], pop);
  const b = lerp(t, [e.n160, e.n160 + 0.25], [0, 1], pop);
  const apart = lerp(t, [e.apart, e.apart + 0.3], [0, 1], pop);
  const out = 1 - lerp(t, [e.question - 0.1, e.question + 0.15], [0, 1]);
  const MAX = 180, X0 = 130, W = 820, BY = 1020;
  const xOf = (v: number) => X0 + (v / MAX) * W;
  const barA = lerp(t, [e.n164, e.n164 + 0.5], [0, D.avgA], snap);
  const barB = lerp(t, [e.n160, e.n160 + 0.5], [0, D.avgB], snap);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, opacity: inView * out }}>
      <div style={{ position: "absolute", left: 90, right: 90, top: 245, textAlign: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 52, color: C.sup }}>{D.leadsA} / {D.games} modelled leads…</div>
        <div style={{ marginTop: 8, opacity: apart, scale: String(0.7 + 0.3 * apart), fontWeight: 900, fontSize: 84, lineHeight: 1.05, color: C.ink, letterSpacing: -1, whiteSpace: "nowrap" }}>ONLY {D.gap} FPS APART</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 450, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 46 }}>
        <div style={{ textAlign: "center", opacity: a, scale: String(0.8 + 0.2 * a) }}>
          <div style={{ fontWeight: 900, fontSize: 200, lineHeight: 0.95, color: C.sup }}>{D.avgA}</div>
          <div style={{ fontWeight: 800, fontSize: 38, color: C.sup, marginTop: 6 }}>4080 SUPER</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 52, color: C.muted, paddingBottom: 70, opacity: b }}>vs</div>
        <div style={{ textAlign: "center", opacity: b, scale: String(0.8 + 0.2 * b) }}>
          <div style={{ fontWeight: 900, fontSize: 200, lineHeight: 0.95, color: C.base }}>{D.avgB}</div>
          <div style={{ fontWeight: 800, fontSize: 38, color: C.base, marginTop: 6 }}>4080</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 760, textAlign: "center", fontWeight: 800, fontSize: 38, color: C.ink, opacity: a }}>
        Estimated average FPS · {D.setting}
      </div>
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: a }}>
        <rect x={X0} y={BY - 170} width={(barA / MAX) * W} height={64} rx={10} fill={C.sup} />
        <rect x={X0} y={BY - 94} width={(barB / MAX) * W} height={64} rx={10} fill={C.base} />
        <line x1={X0} y1={BY} x2={X0 + W} y2={BY} stroke="#6a6a88" strokeWidth={4} />
        {[0, 60, 120, 180].map((v) => (
          <g key={v}>
            <line x1={xOf(v)} y1={BY - 12} x2={xOf(v)} y2={BY + 12} stroke="#6a6a88" strokeWidth={3} />
            <text x={xOf(v)} y={BY + 48} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={30} fill={C.muted}>{v}</text>
          </g>
        ))}
        <text x={540} y={BY + 88} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={28} fill={C.muted}>Full scale from 0 FPS</text>
      </svg>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ t: number; P: VoicedProps["plan"] }> = ({ t, P }) => {
  const e = P.events;
  if (t < e.question - 0.1) return null;
  const q = lerp(t, [e.question, e.question + 0.3], [0, 1], pop);
  const cta = lerp(t, [e.lastWord + 0.1, e.lastWord + 0.45], [0, 1]);
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 90, right: 90, top: 560, opacity: q, scale: String(0.9 + 0.1 * q), textAlign: "center", fontWeight: 900, fontSize: 100, lineHeight: 1.05, color: C.ink }}>
        Would you have guessed <span style={{ color: C.sup }}>four</span>?
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1000, opacity: cta * 0.9, textAlign: "center", fontWeight: 800, fontSize: 36, letterSpacing: 4, color: C.muted }}>
        COMPARE BUILDS ON SPECSMITH
      </div>
    </AbsoluteFill>
  );
};

export const Voiced: React.FC<VoicedProps> = ({ plan: P, display: D, audio }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const e = P.events;
  const push = t < e.land ? lerp(t, [0, e.land], [1.0, 1.035], Easing.linear) : 1.035;
  const shake = t >= e.land && t < e.land + 0.22 ? Math.sin((t - e.land) * 85) * 9 * (1 - (t - e.land) / 0.22) : 0;
  const flash = t >= e.land && t < e.land + 0.18 ? 0.25 * (1 - (t - e.land) / 0.18) : 0;
  // The drop: the 20/20 screen dims in the silence before "But".
  const dim = t >= e.dropStart && t < e.reveal ? lerp(t, [e.dropStart, e.reveal], [0, 0.55]) : 0;
  const apartFlash = t >= e.apart && t < e.apart + 0.15 ? 0.18 * (1 - (t - e.apart) / 0.15) : 0;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Audio src={staticFile(audio)} />
      <AbsoluteFill style={{ opacity: t < e.reveal ? 1 : 0, background: "linear-gradient(115deg, rgba(155,148,255,0.14) 0%, rgba(155,148,255,0.04) 49.8%, rgba(0,212,255,0.04) 50.2%, rgba(0,212,255,0.12) 100%)" }} />
      <AbsoluteFill style={{ scale: String(push), translate: `${shake}px 0px`, opacity: t < e.reveal + 0.1 ? 1 : 0 }}>
        <Header t={t} D={D} P={P} />
        <Counter t={t} D={D} P={P} />
        <Spotlight t={t} D={D} P={P} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#000", opacity: dim }} />
      <Payoff t={t} D={D} P={P} />
      <EndCard t={t} P={P} />
      <Captions t={t} P={P} />
      <EstimateLabel t={t} P={P} />
      <AbsoluteFill style={{ background: "#fff", opacity: flash + apartFlash }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 92% 78% at 50% 50%, transparent 62%, rgba(0,0,0,0.45) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

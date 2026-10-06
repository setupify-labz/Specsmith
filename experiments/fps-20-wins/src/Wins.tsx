// "20 wins. Only 4 FPS apart?": one standalone Short (v3 cut).
//
// Every number and game title on screen comes from verified.json, which
// verify/verify.mts recomputes from SpecSmith's Compare model and checks
// against the catalogue (the four spotlighted titles included). The /compare
// page shows the same 20 vs 0 leads and 164 vs 160 averages. These are model
// estimates, not measured benchmarks; the label says so on every frame.
// Timings come from timeline.json, which the sound uses too. Drawn in code.

import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
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
  muted: "rgba(244,246,250,0.70)",
  sup: "#ffb21f", // RTX 4080 Super
  base: "#7fa8ff", // RTX 4080
  line: "#2a2f3a",
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);
const snap = Easing.bezier(0.1, 0.9, 0.2, 1);
const pop = Easing.bezier(0.2, 1.45, 0.4, 1);
const lerp = (t: number, [t0, t1]: [number, number], [a, b]: [number, number], e = ease) => interpolate(t, [t0, t1], [a, b], { ...clamp, easing: e });
const fade = (t: number, from: number, to: number, inS = 0.12, outS = 0.12) => interpolate(t, [from, from + inS, to - outS, to], [0, 1, 1, 0], clamp);

const SUPER = V.inputs.gpuAName.toUpperCase();
const BASE = V.inputs.gpuBName.toUpperCase();
const ROLL_SECONDS = (to: number) => (to === V.games ? 0.55 : 0.16);

/** Leads counted by time t: each spotlight is its roster position; between them the counter rolls. */
function countAt(t: number): number {
  let n = V.spotlights[0].rosterPosition;
  for (const roll of T.rolls) {
    if (t < roll.at) break;
    const from = n;
    const k = lerp(t, [roll.at, roll.at + ROLL_SECONDS(roll.to)], [0, 1], Easing.linear);
    n = Math.round(from + (roll.to - from) * k);
    if (k < 1) return n;
    n = roll.to;
  }
  return n;
}

/** The estimates label: on every frame, sized to read at 360 px wide. */
const EstimateLabel: React.FC = () => (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center" }}>
    <div style={{ padding: "12px 26px", borderRadius: 40, background: "rgba(255,255,255,0.08)", border: "2px solid rgba(255,255,255,0.14)", fontFamily: FONT, fontWeight: 700, fontSize: 38, color: C.ink }}>
      SpecSmith model estimates · not benchmarks
    </div>
  </div>
);

/** Matchup and setting, compact at the top from frame one. */
const Header: React.FC<{ t: number }> = ({ t }) => {
  const settle = lerp(t, [0, 0.35], [1, 0], snap);
  const out = 1 - lerp(t, [T.cut - 0.05, T.cut + 0.1], [0, 1]);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 150, opacity: out, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontWeight: 900, fontSize: 80, lineHeight: 1, letterSpacing: -1 }}>
        <span style={{ color: C.sup, display: "inline-block", translate: `${-60 * settle}px 0px` }}>{SUPER}</span>
      </div>
      <div style={{ fontWeight: 800, fontSize: 34, color: C.muted, margin: "8px 0" }}>vs</div>
      <div style={{ fontWeight: 900, fontSize: 80, lineHeight: 1, letterSpacing: -1 }}>
        <span style={{ color: C.base, display: "inline-block", translate: `${60 * settle}px 0px` }}>{BASE}</span>
      </div>
      <div style={{ marginTop: 18, fontWeight: 700, fontSize: 38, color: C.ink }}>Same {V.inputs.cpuName} · 1440p High</div>
    </div>
  );
};

/** The counter and a 20-segment roster bar: one segment per catalogue game, filling as leads are counted. */
const Counter: React.FC<{ t: number }> = ({ t }) => {
  const n = countAt(t);
  const landed = t >= T.land;
  const landPop = lerp(t, [T.land, T.land + 0.28], [1, 1.32], pop);
  const out = 1 - lerp(t, [T.cut - 0.05, T.cut + 0.1], [0, 1]);
  const y = lerp(t, [T.land, T.land + 0.28], [560, 660]);
  const lastChange = [...T.rolls.map((r) => r.at), ...T.spots].filter((x) => x <= t).sort((a, b) => b - a)[0] ?? 0;
  const bump = landed ? 1 : lerp(t, [lastChange, lastChange + 0.14], [1.08, 1], pop);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, opacity: out, textAlign: "center", fontFamily: FONT }}>
      <div style={{ scale: String(landed ? landPop : bump), transformOrigin: "50% 50%" }}>
        <div style={{ fontWeight: 900, fontSize: 150, lineHeight: 1 }}>
          <span style={{ color: C.sup }}>{n}</span>
          <span style={{ color: C.muted }}> / {V.games}</span>
        </div>
        <div style={{ marginTop: 8, fontWeight: 800, fontSize: 40, color: C.ink, letterSpacing: 1 }}>MODELLED GAME LEADS</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 64px)", gap: 10, justifyContent: "center", marginTop: landed ? 70 : 34 }}>
        {V.rows.map((row, i) => (
          <div key={row.id} style={{ height: 22, borderRadius: 5, background: i < n ? C.sup : "rgba(255,255,255,0.08)", border: `2px solid ${i < n ? C.sup : C.line}` }} />
        ))}
      </div>
      {landed ? (
        <div style={{ marginTop: 34, opacity: lerp(t, [T.land + 0.2, T.land + 0.45], [0, 1]), fontWeight: 800, fontSize: 40, color: C.muted, letterSpacing: 1 }}>
          {V.ties} TIES · {V.leadsB} FOR THE {BASE}
        </div>
      ) : null}
    </div>
  );
};

/** One spotlighted game: its full title, long enough to read. */
const Spotlight: React.FC<{ t: number }> = ({ t }) => {
  const i = T.spots.findLastIndex((s) => t >= s);
  if (i < 0 || t >= T.spots[i] + T.spotHold) return null;
  const start = T.spots[i];
  const spot = V.spotlights[i];
  // Frame one is already moving: the first card is mid-slide, not fading in.
  const dir = i % 2 === 0 ? 1 : -1;
  const slide = lerp(t, [start, start + 0.22], [i === 0 ? 70 : 160, 0], snap);
  const o = interpolate(t, [start, start + (i === 0 ? 0.001 : 0.08), start + T.spotHold - 0.1, start + T.spotHold], [i === 0 ? 1 : 0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 1030, opacity: o, translate: `${slide * dir}px 0px`, padding: "34px 30px", borderRadius: 28, background: "rgba(255,178,31,0.10)", border: `3px solid ${C.sup}`, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontWeight: 900, fontSize: 74, lineHeight: 1.06, color: C.ink }}>{spot.title}</div>
      <div style={{ marginTop: 14, fontWeight: 800, fontSize: 40, color: C.sup, letterSpacing: 2 }}>4080 SUPER LEADS</div>
    </div>
  );
};

/** The payoff: two big numbers, the difference, and the honest zero-based view under them. */
const Payoff: React.FC<{ t: number }> = ({ t }) => {
  if (t < T.cut) return null;
  const inA = lerp(t, [T.numbers, T.numbers + 0.6], [0, V.avgA], snap);
  const inB = lerp(t, [T.numbers + 0.08, T.numbers + 0.68], [0, V.avgB], snap);
  const numbersIn = lerp(t, [T.numbers - 0.05, T.numbers + 0.15], [0, 1]);
  const apart = lerp(t, [T.apart, T.apart + 0.3], [0, 1], pop);
  const head = lerp(t, [T.cut + 0.15, T.cut + 0.4], [0, 1]);
  const outAll = 1 - lerp(t, [T.question - 0.1, T.question + 0.1], [0, 1]);
  const MAX = 180, X0 = 110, W = 860, BY = 1240;
  const xOf = (fps: number) => X0 + (fps / MAX) * W;
  const per = lerp(t, [T.perGame, T.perGame + 0.25], [0, 1]);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, opacity: outAll }}>
      <div style={{ position: "absolute", left: 60, right: 60, top: 150, opacity: head, textAlign: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 62, color: C.sup }}>20 / 20 modelled leads…</div>
        <div style={{ marginTop: 6, opacity: apart, scale: String(0.7 + 0.3 * apart), fontWeight: 900, fontSize: 140, lineHeight: 1.05, color: C.ink }}>4 FPS apart</div>
      </div>
      {/* the two estimated averages, big enough to grasp at a glance */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 560, opacity: numbersIn, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 50 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 210, lineHeight: 0.95, color: C.sup }}>{Math.round(inA)}</div>
          <div style={{ fontWeight: 800, fontSize: 40, color: C.sup, marginTop: 8 }}>4080 SUPER</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 56, color: C.muted, paddingBottom: 80 }}>vs</div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 210, lineHeight: 0.95, color: C.base }}>{Math.round(inB)}</div>
          <div style={{ fontWeight: 800, fontSize: 40, color: C.base, marginTop: 8 }}>4080</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 920, opacity: numbersIn, textAlign: "center", fontWeight: 800, fontSize: 42, color: C.ink }}>
        Estimated average FPS · 1440p High
      </div>
      {/* zero-based bars: the true proportion, not a truncated axis */}
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: numbersIn }}>
        <rect x={X0} y={BY - 166} width={(inA / MAX) * W} height={70} rx={10} fill={C.sup} />
        <rect x={X0} y={BY - 86} width={(inB / MAX) * W} height={70} rx={10} fill={C.base} />
        <line x1={X0} y1={BY} x2={X0 + W} y2={BY} stroke="#6a7080" strokeWidth={4} />
        {[0, 60, 120, 180].map((v) => (
          <g key={v}>
            <line x1={xOf(v)} y1={BY - 12} x2={xOf(v)} y2={BY + 12} stroke="#6a7080" strokeWidth={3} />
            <text x={xOf(v)} y={BY + 50} textAnchor="middle" fontFamily={FONT} fontWeight={700} fontSize={32} fill={C.muted}>{v}</text>
          </g>
        ))}
        <text x={X0} y={BY + 96} fontFamily={FONT} fontWeight={700} fontSize={30} fill={C.muted}>Full scale from 0 FPS · averages as shown on Compare</text>
      </svg>
      <div style={{ position: "absolute", left: 60, right: 60, top: 1450, opacity: per, translate: `0px ${(1 - per) * 20}px`, textAlign: "center", fontWeight: 900, fontSize: 56, color: C.ink }}>
        Each modelled lead: {V.perGameLeadRange[0]}–{V.perGameLeadRange[1]} FPS
      </div>
    </AbsoluteFill>
  );
};

const Ending: React.FC<{ t: number }> = ({ t }) => {
  if (t < T.question) return null;
  const q = lerp(t, [T.question, T.question + 0.3], [0, 1], pop);
  const sign = lerp(t, [T.signoff, T.signoff + 0.35], [0, 1]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ opacity: q, scale: String(0.88 + 0.12 * q), textAlign: "center", fontWeight: 900, fontSize: 110, lineHeight: 1.05, color: C.ink, padding: "0 70px" }}>
        Would you have guessed <span style={{ color: C.sup }}>four</span>?
      </div>
      <div style={{ position: "absolute", bottom: 190, opacity: sign * 0.85, fontWeight: 800, fontSize: 36, letterSpacing: 5, color: C.muted }}>SPECSMITH</div>
    </AbsoluteFill>
  );
};

export const Wins: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Camera: a different move per stretch. Pushes during the spotlights, a punch at 20/20,
  // then dead still for the reveal so the numbers can be read.
  const spotPush = T.spots.reduce((acc, s, i) => acc + (t >= s && t < s + T.spotHold ? lerp(t, [s, s + T.spotHold], [0, 0.03]) * (i % 2 ? -1 : 1) : 0), 0);
  const scale = interpolate(t, [0, T.land - 0.05, T.land + 0.15, T.cut, T.cut + 0.01], [1.0, 1.02, 1.045, 1.05, 1.0], { ...clamp, easing: ease });
  const shake = t >= T.land && t < T.land + 0.22 ? Math.sin((t - T.land) * 85) * 10 * (1 - (t - T.land) / 0.22) : 0;
  const flash = t >= T.land && t < T.land + 0.2 ? 0.3 * (1 - (t - T.land) / 0.2) : 0;
  const blowout = fade(t, T.blowout, T.cut, 0.18, 0.06);
  // The reversal: a hard cut to black that holds a breath before the numbers.
  const dark = t >= T.cut && t < T.numbers ? 1 - lerp(t, [T.numbers - 0.25, T.numbers], [0, 1]) : 0;
  const bgSplit = t < T.cut ? 1 : 0;

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Audio src={staticFile("wins-sound.wav")} />
      <AbsoluteFill style={{ opacity: bgSplit, background: "linear-gradient(115deg, rgba(255,178,31,0.13) 0%, rgba(255,178,31,0.04) 49.8%, rgba(127,168,255,0.04) 50.2%, rgba(127,168,255,0.13) 100%)" }} />
      <AbsoluteFill style={{ scale: String(scale + spotPush), translate: `${shake}px 0px` }}>
        <Header t={t} />
        <Counter t={t} />
        <Spotlight t={t} />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1240, opacity: blowout, textAlign: "center", fontFamily: FONT, fontWeight: 900, fontSize: 104, color: C.sup }}>A blowout?</div>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
      <Payoff t={t} />
      <AbsoluteFill style={{ background: "#000", opacity: dark * 0.85 }} />
      <Ending t={t} />
      <EstimateLabel />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 92% 78% at 50% 50%, transparent 62%, rgba(0,0,0,0.45) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

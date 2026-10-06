import { Composition, type CalculateMetadataFunction } from "remotion";
import { Wins } from "./Wins";
import { Voiced, type VoicedProps } from "./Voiced";
import T from "./timeline.json";
import plan from "./voiceplan.json";
import V from "./verified.json";

const voicedDefaults: VoicedProps = {
  plan: plan as VoicedProps["plan"],
  display: {
    gpuA: V.inputs.gpuAName, gpuB: V.inputs.gpuBName, cpu: V.inputs.cpuName, setting: "1440p High",
    games: V.games, leadsA: V.leadsA, ties: V.ties, leadsB: V.leadsB, avgA: V.avgA, avgB: V.avgB, gap: V.avgA - V.avgB,
    spotlights: V.spotlights.map((s) => ({ title: s.title, rosterPosition: s.rosterPosition })),
  },
  audio: "voiced-mix.wav",
};
const voicedMetadata: CalculateMetadataFunction<VoicedProps> = ({ props }) => ({ durationInFrames: Math.round(props.plan.duration * 30) });

export const MyComposition = () => {
  return (
    <>
      <Composition id="TwentyWins" component={Wins} durationInFrames={Math.round(T.duration * T.fps)} fps={T.fps} width={1080} height={1920} />
      <Composition id="TwentyWinsVoiced" component={Voiced} defaultProps={voicedDefaults} calculateMetadata={voicedMetadata} durationInFrames={300} fps={30} width={1080} height={1920} />
    </>
  );
};

import { Composition } from "remotion";
import { Wins } from "./Wins";
import T from "./timeline.json";

export const MyComposition = () => {
  return (
    <Composition
      id="TwentyWins"
      component={Wins}
      durationInFrames={Math.round(T.duration * T.fps)}
      fps={T.fps}
      width={1080}
      height={1920}
    />
  );
};

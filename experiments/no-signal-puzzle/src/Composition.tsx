import { Composition } from "remotion";
import { Puzzle } from "./Puzzle";
import T from "./timeline.json";

export const MyComposition = () => {
  return (
    <Composition
      id="NoSignalPuzzle"
      component={Puzzle}
      durationInFrames={Math.round(T.duration * T.fps)}
      fps={T.fps}
      width={1080}
      height={1920}
    />
  );
};

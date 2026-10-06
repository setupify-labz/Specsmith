// Renders the voiced cut, only after the figure gate passes.
//   node voice/render.mjs                    -> out/fps-voiced.mp4
//   node voice/render.mjs --negative-control -> renders a payoff still with a wrong
//                                              average (165), then shows the gate rejecting it
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDisplay, displayFromVerified } from "./check.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const V = JSON.parse(readFileSync(join(root, "src", "verified.json"), "utf8"));
const plan = JSON.parse(readFileSync(join(root, "src", "voiceplan.json"), "utf8"));
const browser = process.env.REMOTION_BROWSER ? ["--browser-executable", process.env.REMOTION_BROWSER] : [];
const negative = process.argv.includes("--negative-control");
const display = displayFromVerified(V);
if (negative) display.avgA = 165;
const props = join(root, "out", negative ? "props-negative.json" : "props.json");
writeFileSync(props, JSON.stringify({ plan, display, audio: "voiced-mix.wav" }));

if (negative) {
  const frame = Math.round((plan.events.apart + 0.8) * 30);
  execFileSync("npx", ["remotion", "still", "TwentyWinsVoiced", join(root, "out", "negative-control.png"), `--frame=${frame}`, `--props=${props}`, ...browser], { cwd: root, stdio: "inherit" });
  const problems = checkDisplay(display, V, plan.captions);
  if (problems.length === 0) { console.error("NEGATIVE CONTROL FAILED: the gate accepted a wrong figure."); process.exit(2); }
  console.log(`negative control rejected as it should be: ${problems.join("; ")}`);
  process.exit(0);
}
const problems = checkDisplay(display, V, plan.captions);
if (problems.length) { console.error(`REJECTED, not rendered: ${problems.join("; ")}`); process.exit(1); }
execFileSync("npx", ["remotion", "render", "TwentyWinsVoiced", join(root, "out", "fps-voiced.mp4"), `--props=${props}`, "--codec=h264", "--crf=18", "--audio-bitrate=192k", ...browser], { cwd: root, stdio: "inherit" });
console.log("rendered out/fps-voiced.mp4");

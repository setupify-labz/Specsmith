// Renders the monitor cut, only after the figure gate passes.
//   node monitor/render.mjs                    -> out/fps-monitor.mp4
//   node monitor/render.mjs --negative-control -> renders a payoff still with a wrong
//                                              average (165), then shows the gate rejecting it
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDisplay, displayFromVerified } from "../voice/check.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const V = JSON.parse(readFileSync(join(root, "src", "verified.json"), "utf8"));
const plan = JSON.parse(readFileSync(join(root, "src", "monitorplan.json"), "utf8"));
const browser = process.env.REMOTION_BROWSER ? ["--browser-executable", process.env.REMOTION_BROWSER] : [];
const negative = process.argv.includes("--negative-control");
const display = displayFromVerified(V);
if (negative) display.avgA = 165;
const props = join(root, "out", negative ? "monitor-props-negative.json" : "monitor-props.json");
writeFileSync(props, JSON.stringify({ plan, display, audio: "monitor-mix.wav" }));
const problems = checkDisplay(display, V, plan.captions);
if (negative) {
  const frame = Math.round((plan.events.apart + 0.6) * 30);
  execFileSync("npx", ["remotion", "still", "MonitorCut", join(root, "out", "monitor-negative-control.png"), `--frame=${frame}`, `--props=${props}`, ...browser], { cwd: root, stdio: "inherit" });
  if (problems.length === 0) { console.error("NEGATIVE CONTROL FAILED: the gate accepted a wrong figure."); process.exit(2); }
  console.log(`negative control rejected as it should be: ${problems.join("; ")}`);
  process.exit(0);
}
if (problems.length) { console.error(`REJECTED, not rendered: ${problems.join("; ")}`); process.exit(1); }
execFileSync("npx", ["remotion", "render", "MonitorCut", join(root, "out", "fps-monitor.mp4"), `--props=${props}`, "--codec=h264", "--crf=18", "--audio-bitrate=192k", ...browser], { cwd: root, stdio: "inherit" });
console.log("rendered out/fps-monitor.mp4");

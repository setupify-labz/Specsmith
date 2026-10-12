// Claims no troubleshooting Short may make in any caption, label or band text: no FPS or percentage figure, no
// performance gain or loss, no bottleneck, no universal outcome ("always", "never", "guarantee"), and no claim that
// SpecSmith inspects a PC. The list is the one first written for the monitor-port Short
// (nextVideoMonitorPort/storyboard.ts on the content-pipeline branches), kept verbatim so the gates behave the same.
export const FORBIDDEN_CLAIMS: readonly { readonly pattern: RegExp; readonly why: string; readonly unlessObserved?: true }[] = [
  { pattern: /\bno signal\b/i, why: "A motherboard port can show a picture; NO SIGNAL is only said when this PC showed it, and never as universal.", unlessObserved: true },
  { pattern: /\b\d+\s*(%|percent|fps|frames)\b/i, why: "No FPS or percentage figure without a same-game, same-settings measurement on this PC." },
  { pattern: /\b(more|extra|higher|boost\w*|gain\w*|double\w*|lose|losing|lost)\b[^.?!]*\b(fps|frames|performance)\b/i, why: "No performance gain or loss is claimed without measurement." },
  { pattern: /\b(fps|performance)\b[^.?!]*\b(boost\w*|gain\w*|jump\w*|drop\w*|tank\w*|loss)\b/i, why: "No performance gain or loss is claimed without measurement." },
  { pattern: /\bbottleneck\w*\b/i, why: "No bottleneck claim." },
  { pattern: /\b(gpu|graphics card|card)\b[^.?!]*\b(wasted|unused|idle|sitting there|doing nothing)\b/i, why: "Windows can render on the graphics card while a motherboard port drives the display." },
  { pattern: /\b(wasting|wasted|not using|isn't using|doesn't use|won't use|unused)\b[^.?!]*\b(gpu|graphics card|card)\b/i, why: "Windows can render on the graphics card while a motherboard port drives the display." },
  { pattern: /\b(always|never|every|guarantee\w*)\b/i, why: "Outcomes vary by CPU, motherboard, firmware and Windows settings." },
  { pattern: /\bspecsmith\b[^.?!]*\b(detect|detects|scan|scans|checks?|reads?)\b/i, why: "SpecSmith does not inspect a PC's connections." },
];

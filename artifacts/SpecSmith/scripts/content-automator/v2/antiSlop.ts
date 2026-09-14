// Anti-slop: the rules that keep SpecSmith copy from converging on generic
// automated-video voice.
//
// WHAT THIS IS FOR
// ----------------
// Short-form automation drifts toward the same handful of moves — fake
// urgency, unsupported superlatives, emoji confetti, a hook that promises what
// the video never delivers. Each is cheap to generate and corrosive to trust,
// and none of them is caught by a factual-accuracy check, because "INSANE
// value!!!" asserts no fact at all.
//
// HOW IT MAKES THE VIDEO BETTER
// ------------------------------
// It runs on the generated storyboard BEFORE anything is rendered, so a beat
// that would have opened with manufactured urgency is caught while it is still
// a line of text and can be rewritten for a few milliseconds instead of a full
// re-render. Its findings feed the creative review's weaknesses and the repair
// pass's change list.
//
// WHAT IT DELIBERATELY DOES NOT DO
// ---------------------------------
// It does not judge whether writing is GOOD. It detects specific, nameable
// failure patterns. Prose quality is a human judgment and is reported as such
// elsewhere rather than scored here.

export type SlopSeverity = "hard-fail" | "warning";

export type SlopCode =
  | "fake-urgency"
  | "unsupported-superlative"
  | "generic-ai-filler"
  | "emoji-spam"
  | "repeated-caption"
  | "clickbait-unsupported"
  | "unsupported-claim-verb"
  | "excessive-exclamation";

export interface SlopFinding {
  readonly code: SlopCode;
  readonly severity: SlopSeverity;
  /** Where it was found: a beat index, or "title"/"cta". */
  readonly location: string;
  /** The exact offending text, so a reviewer can see it rather than trust a label. */
  readonly evidence: string;
  readonly message: string;
}

/**
 * Urgency SpecSmith has not earned.
 *
 * A GPU comparison is not time-limited. "Before it's too late" on evergreen
 * hardware advice is a manufactured deadline, which is the cheapest and most
 * common form of automated-content dishonesty.
 */
const FAKE_URGENCY = [
  /\bbefore it'?s too late\b/i,
  /\bact now\b/i,
  /\bdon'?t wait\b/i,
  /\blast chance\b/i,
  /\bhurry\b/i,
  /\brunning out\b/i,
  /\blimited time\b/i,
  /\bwhile you still can\b/i,
];

/**
 * Superlatives with nothing behind them.
 *
 * SpecSmith may say a card is faster when the estimate supports it. It may not
 * say "the best" or "insane" — those are claims about everything, and nothing
 * in the catalogue evidences a claim about everything.
 */
const UNSUPPORTED_SUPERLATIVE = [
  /\bthe best\b/i,
  /\bbest ever\b/i,
  /\bworst ever\b/i,
  /\binsane\b/i,
  /\bunbelievable\b/i,
  /\bmind[- ]?blowing\b/i,
  /\bgame[- ]?changing\b/i,
  /\bperfect\b/i,
  /\bflawless\b/i,
  /\bultimate\b/i,
];

/** Phrases that fill time without saying anything. */
const GENERIC_FILLER = [
  /\blet'?s dive (?:right )?in\b/i,
  /\bin this video\b/i,
  /\bwithout further ado\b/i,
  /\bbuckle up\b/i,
  /\byou won'?t believe\b/i,
  /\bstay tuned\b/i,
  /\bthat'?s right\b/i,
  /\bthe answer may surprise you\b/i,
];

/** Verbs that assert a measurement SpecSmith did not take. */
const UNSUPPORTED_CLAIM_VERB = [
  /\bwe tested\b/i,
  /\bwe benchmarked\b/i,
  /\bwe measured\b/i,
  /\bour lab\b/i,
  /\bproven to\b/i,
  /\bguaranteed\b/i,
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

function scan(text: string, location: string, findings: SlopFinding[]): void {
  const add = (code: SlopCode, severity: SlopSeverity, evidence: string, message: string) =>
    findings.push({ code, severity, location, evidence, message });

  for (const pattern of FAKE_URGENCY) {
    const hit = pattern.exec(text);
    if (hit) add("fake-urgency", "hard-fail", hit[0], "Manufactured urgency: SpecSmith's hardware advice is not time-limited.");
  }
  for (const pattern of UNSUPPORTED_SUPERLATIVE) {
    const hit = pattern.exec(text);
    if (hit) add("unsupported-superlative", "hard-fail", hit[0], "Superlative with no evidence behind it; state the measured difference instead.");
  }
  for (const pattern of UNSUPPORTED_CLAIM_VERB) {
    const hit = pattern.exec(text);
    if (hit) {
      add("unsupported-claim-verb", "hard-fail", hit[0],
        "Claims a measurement SpecSmith did not perform. Its figures are estimates from a catalogue, not lab benchmarks.");
    }
  }
  for (const pattern of GENERIC_FILLER) {
    const hit = pattern.exec(text);
    if (hit) add("generic-ai-filler", "warning", hit[0], "Generic automated-video filler; says nothing and costs screen time.");
  }

  const emoji = text.match(EMOJI) ?? [];
  if (emoji.length > 2) {
    add("emoji-spam", "warning", emoji.join(""), `${emoji.length} emoji in one line reads as automated content.`);
  }
  const exclamations = (text.match(/!/g) ?? []).length;
  if (exclamations > 1) {
    add("excessive-exclamation", "warning", text.slice(0, 60), `${exclamations} exclamation marks in one line.`);
  }
}

export interface SlopScanInput {
  readonly title: string;
  readonly beats: readonly { readonly onScreenText: string; readonly narration: string }[];
  readonly finalCta: string;
}

export interface SlopReport {
  readonly findings: SlopFinding[];
  readonly hardFailures: SlopFinding[];
  readonly warnings: SlopFinding[];
  /** True when nothing hard-fails. Warnings do not block. */
  readonly passable: boolean;
}

/**
 * Scans every piece of generated copy that will reach a viewer.
 *
 * Narration and on-screen text are scanned separately: a phrase that is
 * tolerable spoken can be shouty burned into a frame, and the location in each
 * finding says which one it was.
 */
export function scanForSlop(input: SlopScanInput): SlopReport {
  const findings: SlopFinding[] = [];
  scan(input.title, "title", findings);
  scan(input.finalCta, "cta", findings);

  const seenCaptions = new Map<string, number>();
  for (const [index, beat] of input.beats.entries()) {
    scan(beat.onScreenText, `beat-${index + 1}.onScreenText`, findings);
    scan(beat.narration, `beat-${index + 1}.narration`, findings);

    // Repeated on-screen text across beats is the visual signature of a
    // template being reused rather than a story being told.
    const normalized = beat.onScreenText.trim().toLowerCase();
    if (normalized) {
      const first = seenCaptions.get(normalized);
      if (first !== undefined) {
        findings.push({
          code: "repeated-caption",
          severity: "warning",
          location: `beat-${index + 1}.onScreenText`,
          evidence: beat.onScreenText,
          message: `Identical on-screen text already used in beat ${first + 1}; repetition reads as a template.`,
        });
      } else {
        seenCaptions.set(normalized, index);
      }
    }
  }

  // Clickbait: the hook promises a reveal the rest of the video never mentions.
  const hook = input.beats[0];
  if (hook) {
    const promisesReveal = /\b(secret|nobody tells you|hidden truth|shocking)\b/i.exec(hook.onScreenText + " " + hook.narration);
    if (promisesReveal) {
      const body = input.beats.slice(1).map((beat) => `${beat.onScreenText} ${beat.narration}`).join(" ").toLowerCase();
      const keyword = promisesReveal[1].toLowerCase();
      if (!body.includes(keyword)) {
        findings.push({
          code: "clickbait-unsupported",
          severity: "hard-fail",
          location: "beat-1",
          evidence: promisesReveal[0],
          message: `The hook promises a "${keyword}" the rest of the video never delivers.`,
        });
      }
    }
  }

  const hardFailures = findings.filter((finding) => finding.severity === "hard-fail");
  return {
    findings,
    hardFailures,
    warnings: findings.filter((finding) => finding.severity === "warning"),
    passable: hardFailures.length === 0,
  };
}

// The SpecSmith Shorts that are already live, as far as they are actually known.
//
// Every value here is either supplied by the user (and says so) or measured
// from a copy of the published video the user uploaded (and names that file's
// SHA-256). Anything not supplied is null with the reason. No URL, time or
// metric is inferred. To add a post, add the facts here under review; to add
// numbers someone read off a dashboard, use recordDashboardEvidence, which keeps
// them labelled EXPLORATORY and unverified.

import type { CreativeChange, CreativeMeasurement, ExternalPostInput, MediaEvidence } from "./externalPosts.ts";

/** The YouTube copy of the RAM-fit Short the user uploaded on 2026-10-06. */
export const RAM_FIT_PUBLISHED_COPY: MediaEvidence = {
  fileName: "2f1bfb2b-DDR4_RAM_Won_t_Fit_a_DDR5_Motherboard___Here_s_the_Fix.mp4",
  sha256: "ea97c1471d4174768b4ba637e121089f4b8982570f475017c47fde688b22c589",
  durationSeconds: 13.746213,
  width: 720,
  height: 1280,
  frames: 412,
  containerCreatedAt: "2026-10-03T23:38:32.000Z",
  encoder: "Google",
};

/** The copy of the FPS Short the user uploaded on 2026-10-06. */
export const FPS_20_WINS_PUBLISHED_COPY: MediaEvidence = {
  fileName: "07d6ae89-20_Game_Leads__Only_4_FPS_Apart_.mp4",
  sha256: "1de92f38b036d5042ad403296e5bfb4c71ede954b773a5639815099ed984f35b",
  durationSeconds: 18.018685,
  width: 720,
  height: 1280,
  frames: 540,
  containerCreatedAt: "2026-10-06T16:16:03.000Z",
  encoder: "Google",
};

/** SHA-256 of the FPS render the published copy matches (ce47598, out/fps-monitor.mp4). */
export const FPS_20_WINS_RENDER_SHA256 = "034880266d456781726815a3ab5d1174f7406a516791a7d8752a2b2af28fdce4";

/**
 * Posts whose URLs were supplied. Add the rest here, one entry per platform URL,
 * as they are supplied; complete unknown facts later with correctExternalPost
 * rather than editing an entry, so the history stays.
 */
export const PUBLISHED_POSTS: readonly ExternalPostInput[] = [
  {
    platform: "youtube-shorts",
    postUrl: "https://www.youtube.com/shorts/cSDhjFC-CI8",
    suppliedBy: "user, 2026-10-03 (\"The RAM-fit Short cSDhjFC-CI8 was auto-published through Metricool\")",
    creativeId: { value: "ram-fit@saved-take-pr172", source: "user-provided", basis: "the user named this post the RAM-fit Short; the version suffix is file-measured (see creativeVersion)" },
    publishedVia: { value: "metricool-auto", source: "user-provided", basis: "user, 2026-10-03" },
    publishedAt: { value: null, basis: "Not supplied. The uploaded copy's container creation_time (2026-10-03T23:38:32Z) is when Google encoded that file, not a confirmed publication time." },
    accountId: { value: null, basis: "Not supplied: the owning channel id has not been given, and no YouTube API call can be made from here to read it." },
    creativeVersion: {
      value: "RAM-fit pilot, saved-Liam-take render (claude/ram-fit-liam-take, PR #172)",
      source: "file-measured",
      basis: "The uploaded copy runs 13.75 s with the saved-take scene order (DDR4 notch -> DDR5 slot -> two fixes -> Builder warning -> specsmithpc.com/builder), matching the 13.73 s saved-take render reported for PR #172. That render's bytes are not in this checkout, so the match is by content, not by hash.",
    },
    sourceMediaSha256: { value: null, basis: "The uploaded render was built in CI for PR #172; its bytes are not in this checkout." },
    media: RAM_FIT_PUBLISHED_COPY,
    notes: [
      "The user reported that SpecSmith's YouTube, TikTok and Instagram accounts are connected in Metricool. No TikTok or Instagram URL for this video has been supplied, so none is recorded.",
    ],
  },
];

/**
 * Access to real analytics, as probed from this environment on 2026-10-06 at
 * 17:14Z. Re-run the probes in METRICS_ACCESS.md rather than trusting these.
 */
export const ACCESS_FINDINGS: readonly string[] = [
  "Metricool, which published the RAM-fit Short and holds the YouTube, TikTok and Instagram connections, cannot be read from here: app.metricool.com is refused by the network policy, no METRICOOL_* credential is configured, and this session has no Metricool connector. The user's Metricool connection lives in another assistant, not in this repository or its CI.",
  "YouTube Data and Analytics APIs are reachable but answer 403/401 without a credential; no channel-owner OAuth credential is configured. www.youtube.com (and so oEmbed) is refused by the network policy.",
  "TikTok (open.tiktokapis.com, www.tiktok.com) and Instagram (graph.facebook.com, www.instagram.com) are refused by the network policy.",
];

/** Published, but no post URL or time has been supplied for any platform. */
export const PUBLISHED_WITHOUT_POSTS = [
  {
    creativeId: "fps-20-wins@ce47598",
    media: FPS_20_WINS_PUBLISHED_COPY,
    sourceMediaSha256: FPS_20_WINS_RENDER_SHA256,
    note: "the user uploaded the published copy on 2026-10-06; its frames match the ce47598 render on claude/fps-liam-voice (SSIM 0.996 at 720x1280, 540 vs 539 frames)",
  },
] as const;

/**
 * Measured from the two uploaded copies at 720x1280 (frame 0 and 2.5 s),
 * by counting rows of text-coloured pixels; reproducible with ffmpeg.
 */
export const OPENING_MEASUREMENTS: readonly CreativeMeasurement[] = [
  {
    creativeId: "ram-fit@saved-take-pr172",
    statement: "Frame one already shows the spoken claim as a caption, \"DDR4 RAM won't fit\", about 40 px tall in a 1280 px frame (3.1% of the height).",
    evidence: `frame 0 of sha256 ${RAM_FIT_PUBLISHED_COPY.sha256.slice(0, 16)}…`,
  },
  {
    creativeId: "fps-20-wins@ce47598",
    statement: "Frame one shows no caption (it fades in from 0.08 s). The largest text is \"20 GAMES\" on the miniature monitor, 23 px tall (1.8%); the GPU names are about 9 px (0.7%). After the push, at 2.5 s, the same GPU name is 39 px.",
    evidence: `frames 0 and 75 of sha256 ${FPS_20_WINS_PUBLISHED_COPY.sha256.slice(0, 16)}…`,
  },
];

/** One change, resting only on the measurements above. A hypothesis until a trusted metric exists. */
export const OPENING_CHANGE: CreativeChange = {
  change: "In the next comparison Short that opens on the desk and monitor, show the spoken hook as a full-size caption from frame one, at least the RAM-fit caption's size (about 40 px of 1280), while keeping the push into the screen.",
  appliesTo: "the opening 1.5 s only; the story, figures, disclosure and payoff stay as reviewed",
  restsOn: [
    "fps-20-wins frame one: no caption; claim text 9–23 px on the miniature monitor (file-measured)",
    "ram-fit frame one: the claim as a 40 px caption (file-measured)",
  ],
  hypothesis: "A claim readable on frame one may hold more viewers through the first second than one that only becomes readable after the 1.3 s push. There is no performance data for either video, so this is a bet, not a finding.",
  testWith: "On YouTube, at the same publication age as fps-20-wins: the share still watching at 1-3 s on the audience-retention curve, and average percentage viewed. Both are owner-only YouTube Analytics metrics, readable once a trusted YouTube source is registered; viewed-versus-swiped-away is not claimed by any adapter. Until then this is untested.",
  status: "Hypothesis to test. Not a rule, not an approved claim, not a schedule.",
};

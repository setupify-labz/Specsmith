// The SpecSmith Shorts that are already live, as far as they are actually known.
//
// Every value here says where it came from:
//   - connector-reported: returned by the authenticated Metricool connector for
//     brand 6769542 to Codex, and relayed here on 2026-10-06. This environment
//     did not fetch it and cannot re-check it (app.metricool.com is refused by
//     the network policy and no Metricool connector is attached here).
//   - user-provided: stated by the user (or relayed through Codex) and says so.
//   - file-measured: measured from a copy of the published video the user
//     uploaded, named by its SHA-256.
// Anything not known is null with the reason. In particular, Metricool's
// timestamps are the times the posts were SCHEDULED for, paired with a
// PUBLISHED status; neither is a confirmed publication time, so publishedAt
// stays unknown and the scheduled time is kept as its own fact. The TikTok and
// Instagram handle is not the API account id those adapters need, so it is kept
// as `handle` and accountId stays unknown. To complete a fact later, use
// correctExternalPost, never an edit here, so the history stays; numbers read
// off a dashboard go through recordDashboardEvidence, labelled EXPLORATORY.

import type { CreativeChange, CreativeMeasurement, DashboardEvidence, ExternalPostInput, MediaEvidence } from "./externalPosts.ts";

const UPLOADED_COPY_ORIGIN = "uploaded by the user to this session on 2026-10-06; Google-encoded; which platform it was downloaded from was not stated";

/** The copy of the RAM-fit Short the user uploaded on 2026-10-06. */
export const RAM_FIT_PUBLISHED_COPY: MediaEvidence = {
  fileName: "2f1bfb2b-DDR4_RAM_Won_t_Fit_a_DDR5_Motherboard___Here_s_the_Fix.mp4",
  sha256: "ea97c1471d4174768b4ba637e121089f4b8982570f475017c47fde688b22c589",
  durationSeconds: 13.746213,
  width: 720,
  height: 1280,
  frames: 412,
  containerCreatedAt: "2026-10-03T23:38:32.000Z",
  encoder: "Google",
  origin: UPLOADED_COPY_ORIGIN,
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
  origin: UPLOADED_COPY_ORIGIN,
};

/** SHA-256 of the FPS render the published copy matches (ce47598, out/fps-monitor.mp4). */
export const FPS_20_WINS_RENDER_SHA256 = "034880266d456781726815a3ab5d1174f7406a516791a7d8752a2b2af28fdce4";

/** How the Metricool facts reached this repository. */
export const METRICOOL_RELAY =
  "Metricool connector (authenticated, brand 6769542) returned this to Codex, which relayed it to this session on 2026-10-06; not fetched or re-checked by this environment";

const SCHEDULE_NOT_PUBLICATION = "Metricool's scheduled time for this post; paired with a PUBLISHED status it shows the post went out, but not exactly when";
const PUBLICATION_TIME_UNKNOWN = {
  value: null,
  basis: "No confirmed publication time. Metricool supplied only the scheduled time (kept as scheduledAt) and a PUBLISHED status; the uploaded copy's container time is an encode time. Not inferred from either.",
} as const;
const HANDLE_ONLY = (platform: string, needs: string) => ({
  value: null,
  basis: `Only the public handle @specsmithpc was supplied for ${platform}. The ${platform} adapter binds observations to ${needs}, which has not been supplied; the handle is not substituted for it.`,
} as const);

const RAM = {
  creativeId: { value: "ram-fit@saved-take-pr172", source: "user-provided", basis: "the user (via Codex, 2026-10-06) listed this URL under the RAM video; the version suffix is file-measured (see creativeVersion)" },
  creativeVersion: {
    value: "RAM-fit pilot, saved-Liam-take render (claude/ram-fit-liam-take, PR #172)",
    source: "file-measured",
    basis: "The uploaded copy runs 13.75 s with the saved-take scene order (DDR4 notch -> DDR5 slot -> two fixes -> Builder warning -> specsmithpc.com/builder), matching the 13.73 s saved-take render reported for PR #172. That render's bytes are not in this checkout, so the match is by content, not by hash.",
  },
  sourceMediaSha256: { value: null, basis: "The uploaded render was built in CI for PR #172; its bytes are not in this checkout." },
  media: RAM_FIT_PUBLISHED_COPY,
} as const;

const FPS = {
  creativeId: { value: "fps-20-wins@ce47598", source: "user-provided", basis: "the user (via Codex, 2026-10-06) listed this URL under the FPS video; the version suffix is file-measured (see creativeVersion)" },
  creativeVersion: {
    value: "FPS 20-wins monitor cut, ce47598 on claude/fps-liam-voice",
    source: "file-measured",
    basis: "The uploaded copy's frames match the ce47598 render (SSIM 0.996 at 720x1280, 540 vs 539 frames).",
  },
  sourceMediaSha256: { value: FPS_20_WINS_RENDER_SHA256, source: "file-measured", basis: "SHA-256 of out/fps-monitor.mp4 rendered at ce47598, which the uploaded copy matches by frame comparison" },
  media: FPS_20_WINS_PUBLISHED_COPY,
} as const;

function metricoolPost(
  creative: typeof RAM | typeof FPS,
  platform: ExternalPostInput["platform"],
  url: string,
  metricoolPostId: string,
  scheduledAt: string,
  account: ExternalPostInput["accountId"],
  handle: ExternalPostInput["handle"],
): ExternalPostInput {
  return {
    platform,
    postUrl: { value: url, source: "connector-reported", basis: `${METRICOOL_RELAY}; provider status PUBLISHED` },
    ...creative,
    publishedVia: { value: "metricool-scheduled", source: "connector-reported", basis: METRICOOL_RELAY },
    aggregatorPostId: { value: metricoolPostId, source: "connector-reported", basis: `Metricool post id; ${METRICOOL_RELAY}` },
    providerStatus: { value: "PUBLISHED", source: "connector-reported", basis: METRICOOL_RELAY },
    scheduledAt: { value: scheduledAt, source: "connector-reported", basis: `${SCHEDULE_NOT_PUBLICATION}; ${METRICOOL_RELAY}` },
    publishedAt: PUBLICATION_TIME_UNKNOWN,
    accountId: account,
    handle,
  };
}

const YOUTUBE_CHANNEL = { value: "UC1DBOCQ4F0y-BP9he39b3Kg", source: "user-provided", basis: "YouTube channel id supplied by the user via Codex, 2026-10-06 (the id the YouTube adapter binds observations to)" } as const;
const NO_YOUTUBE_HANDLE = { value: null, basis: "No YouTube handle was supplied; the channel id is recorded instead." } as const;
const SPECSMITH_HANDLE = { value: "@specsmithpc", source: "user-provided", basis: "handle supplied by the user via Codex, 2026-10-06; a public name, not an API account id" } as const;

/** The six posts: RAM and FPS, each on YouTube, TikTok and Instagram, as returned by Metricool. */
export const PUBLISHED_POSTS: readonly ExternalPostInput[] = [
  metricoolPost(RAM, "youtube-shorts", "https://www.youtube.com/shorts/cSDhjFC-CI8", "387469692", "2026-10-03T16:00:00-04:00", YOUTUBE_CHANNEL, NO_YOUTUBE_HANDLE),
  metricoolPost(RAM, "tiktok", "https://www.tiktok.com/@specsmithpc/video/7693352089078058271", "389042813", "2026-10-05T20:55:00-04:00", HANDLE_ONLY("TikTok", "the TikTok open_id of the authorized user"), SPECSMITH_HANDLE),
  metricoolPost(RAM, "instagram-reels", "https://www.instagram.com/reel/DeIi5pZDWew/", "389042813", "2026-10-05T20:55:00-04:00", HANDLE_ONLY("Instagram", "the Instagram business account id (INSTAGRAM_BUSINESS_ACCOUNT_ID)"), SPECSMITH_HANDLE),
  metricoolPost(FPS, "youtube-shorts", "https://www.youtube.com/shorts/648FsZLefnc", "389611858", "2026-10-06T12:10:00-04:00", YOUTUBE_CHANNEL, NO_YOUTUBE_HANDLE),
  metricoolPost(FPS, "tiktok", "https://www.tiktok.com/@specsmithpc/video/7693587971584429343", "389611858", "2026-10-06T12:10:00-04:00", HANDLE_ONLY("TikTok", "the TikTok open_id of the authorized user"), SPECSMITH_HANDLE),
  metricoolPost(FPS, "instagram-reels", "https://www.instagram.com/reel/DeKLo_0kw7C/", "389611858", "2026-10-06T12:10:00-04:00", HANDLE_ONLY("Instagram", "the Instagram business account id (INSTAGRAM_BUSINESS_ACCOUNT_ID)"), SPECSMITH_HANDLE),
];

const SNAPSHOT_TIME_UNKNOWN =
  "The connector result did not say when Metricool last synced these counts from TikTok, and no read time was relayed. Metricool figures can lag the platform, so treat them as a possibly delayed snapshot.";
const SNAPSHOT_UNAVAILABLE = [
  { label: "Watch time", reason: "not in the relayed connector result; unavailable" },
  { label: "Completion rate", reason: "not in the relayed connector result; unavailable" },
] as const;

/**
 * Counts the Metricool connector returned for the two TikTok posts, relayed
 * through Codex. Kept as EXPLORATORY relayed snapshots: possibly delayed, not
 * fetched by this environment, not trusted observations, never ranked against
 * each other (the posts went out at different times).
 */
export const RELAYED_CONNECTOR_SNAPSHOTS: readonly { readonly suppliedBy: string; readonly evidence: Omit<DashboardEvidence, "kind"> }[] = [
  {
    suppliedBy: "the user, relaying the Metricool connector result from Codex (2026-10-06)",
    evidence: {
      origin: "relayed-connector-snapshot", platform: "tiktok", nativePostId: "7693352089078058271",
      dashboard: "Metricool connector (authenticated, brand 6769542)", readAt: null, readAtBasis: SNAPSHOT_TIME_UNKNOWN,
      sourceReference: "Metricool connector result returned to Codex and relayed to this session on 2026-10-06; not a native fetch by this environment",
      values: [{ label: "Views", value: 1045 }, { label: "Likes", value: 17 }],
      unavailable: SNAPSHOT_UNAVAILABLE,
    },
  },
  {
    suppliedBy: "the user, relaying the Metricool connector result from Codex (2026-10-06)",
    evidence: {
      origin: "relayed-connector-snapshot", platform: "tiktok", nativePostId: "7693587971584429343",
      dashboard: "Metricool connector (authenticated, brand 6769542)", readAt: null, readAtBasis: SNAPSHOT_TIME_UNKNOWN,
      sourceReference: "Metricool connector result returned to Codex and relayed to this session on 2026-10-06; not a native fetch by this environment",
      values: [{ label: "Views", value: 82 }, { label: "Likes", value: 0 }],
      unavailable: SNAPSHOT_UNAVAILABLE,
    },
  },
];

/**
 * Access to real analytics, as probed from this environment on 2026-10-06 at
 * 17:14Z. Re-run the probes in METRICS_ACCESS.md rather than trusting these.
 */
export const ACCESS_FINDINGS: readonly string[] = [
  "Metricool cannot be read from here: app.metricool.com is refused by the network policy, no METRICOOL_* credential is configured, and this session has no Metricool connector. The post records above came from the Metricool connector in Codex, relayed by hand, as were the two TikTok count snapshots (kept as exploratory, not as trusted observations).",
  "YouTube Data and Analytics APIs are reachable but answer 403/401 without a credential; no channel-owner OAuth credential is configured. www.youtube.com (and so oEmbed) is refused by the network policy.",
  "TikTok (open.tiktokapis.com, www.tiktok.com) and Instagram (graph.facebook.com, www.instagram.com) are refused by the network policy.",
];

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
  hypothesis: "A claim readable on frame one may hold more viewers through the first second than one that only becomes readable after the 1.3 s push. There is no trusted performance data for either video, and the relayed TikTok counts are exploratory, at different publication ages, and say nothing about the opening, so this is a bet, not a finding.",
  testWith: "On YouTube, at the same publication age as fps-20-wins: the share still watching at 1-3 s on the audience-retention curve, and average percentage viewed. Both are owner-only YouTube Analytics metrics, readable once a trusted YouTube source is registered; viewed-versus-swiped-away is not claimed by any adapter. Until then this is untested.",
  status: "Hypothesis to test. Not a rule, not an approved claim, not a schedule.",
};

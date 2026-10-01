// Platform cuts the review knows. A cut is a size, frame rate and length
// window; a new encode of the same creative is a new cut and gets a new review.
//
// Safe-area insets are null on purpose: no platform specification for them is
// recorded in this repository, and invented numbers would turn a guess into a
// pass. The review reports the check unavailable and asks a person to look on
// a real phone instead.

import type { PlatformVariant } from "./types.ts";

export const YOUTUBE_SHORTS_1080X1920_30: PlatformVariant = {
  variantId: "youtube-shorts-1080x1920-30",
  platform: "youtube-shorts",
  width: 1080, height: 1920, fps: 30,
  minDurationSeconds: 1, maxDurationSeconds: 60,
  requiresAudio: true,
  safeArea: null,
};

// The SpecSmith motion palette used by every spec-driven Short. Same values as the data motion graphics'
// palette (SPECSMITH_MOTION_COLOURS in v2/creative/dataMotionGraphic.ts on the content-pipeline branches), kept
// here so the daily Short job does not depend on that subsystem. Changing a value changes every rendered frame.
export const SPECSMITH_MOTION_COLOURS = {
  background: "#0A0A0F",
  surface: "#13131A",
  card: "#1C1C26",
  text: "#F0F0FF",
  textSecondary: "#8888AA",
  accent: "#6C63FF",
  accentText: "#9B94FF",
  cyan: "#00D4FF",
  green: "#00E676",
  amber: "#FFB300",
} as const;

export const MIN_PRODUCTION_NARRATION_CHARACTERS = 330;
export const MAX_PRODUCTION_NARRATION_CHARACTERS = 360;

export function normalizeNarrationText(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function assertProductionNarrationLength(text: string): void {
  if (text.length < MIN_PRODUCTION_NARRATION_CHARACTERS || text.length > MAX_PRODUCTION_NARRATION_CHARACTERS) {
    throw new Error(
      `Production narration must contain ${MIN_PRODUCTION_NARRATION_CHARACTERS}-${MAX_PRODUCTION_NARRATION_CHARACTERS} characters; got ${text.length}.`,
    );
  }
}

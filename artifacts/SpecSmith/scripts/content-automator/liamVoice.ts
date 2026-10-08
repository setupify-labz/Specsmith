// The one voice SpecSmith narration may use: ElevenLabs "Liam".
//
// THIS IS REVIEWED CONFIGURATION, NOT A DEFAULT. The TTS adapter used to fall
// back to George (JBFqnCBsd6RMkjVDRZzb, the id from ElevenLabs' quickstart)
// whenever ELEVENLABS_VOICE_ID was unset, so a missing setting silently
// produced the wrong narrator. And the publish gate used to compare narration
// against whatever id the CALLER passed as "Liam", so any id could be
// declared to be Liam.
//
// Now the identity lives here, in source, frozen:
//  - the environment must supply ELEVENLABS_VOICE_ID, and it must equal this
//    id exactly — missing, blank, George or any other id throws BEFORE the
//    adapter makes any provider request;
//  - the publish gate compares adapter-issued evidence against this constant,
//    not against a caller-supplied value.
// Changing the voice is a reviewed source change to this file, never a
// runtime setting.
//
// PROVENANCE. The id is ElevenLabs' public premade "Liam" voice. It was
// confirmed by the repository owner during review of ac74f86 (2026-09-24).
// It has not been re-checked against the ElevenLabs API from this repository,
// because doing so is a provider call. If it is ever wrong, the failure mode is
// a refusal (the operator's real Liam id will not match), not a wrong voice.

export const REVIEWED_LIAM_VOICE = Object.freeze({
  name: "Liam",
  provider: "elevenlabs",
  voiceId: "TX3LPaxmHKxFdv7VOQHJ",
} as const);

/** ElevenLabs' quickstart voice, George: the id the adapter used to fall back to. */
export const GEORGE_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

export class LiamVoiceConfigError extends Error {
  readonly code: "voice-missing" | "voice-blank" | "voice-george" | "voice-not-liam";
  constructor(code: LiamVoiceConfigError["code"], message: string) {
    super(`[${code}] ${message}`);
    this.name = "LiamVoiceConfigError";
    this.code = code;
  }
}

/**
 * Returns the reviewed Liam id when `candidate` is exactly it, and throws
 * otherwise. `source` names where the candidate came from, for the message.
 */
export function requireReviewedLiamVoiceId(candidate: unknown, source: string): string {
  if (candidate === undefined || candidate === null) {
    throw new LiamVoiceConfigError(
      "voice-missing",
      `${source} is not set. SpecSmith narration requires the reviewed Liam voice; there is no default.`,
    );
  }
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new LiamVoiceConfigError("voice-blank", `${source} is blank. SpecSmith narration requires the reviewed Liam voice.`);
  }
  const id = candidate.trim();
  if (id === GEORGE_VOICE_ID) {
    throw new LiamVoiceConfigError(
      "voice-george",
      `${source} is George (${GEORGE_VOICE_ID}), ElevenLabs' quickstart voice. SpecSmith narration is Liam only.`,
    );
  }
  if (id !== REVIEWED_LIAM_VOICE.voiceId) {
    throw new LiamVoiceConfigError(
      "voice-not-liam",
      `${source} is "${id}", not the reviewed Liam voice id. Changing the voice is a reviewed change to liamVoice.ts.`,
    );
  }
  return REVIEWED_LIAM_VOICE.voiceId;
}

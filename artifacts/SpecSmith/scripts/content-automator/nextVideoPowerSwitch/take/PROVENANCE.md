# The power-switch Liam take

The owner approved this take word for word on 2026-10-09.

**Request.** It was generated **once** by `.github/workflows/elevenlabs-voice-sample.yml`:
- run `37992618639`, `script: power-switch`, on commit `c47ae04`;
- before the run, CI passed on that same commit (run `37991581979`).

**Handover.** The secretless share job posted the take to draft PR #177 as four base64 parts. I reassembled them here, and the archive's SHA-256 matched the one the job posted:
- archive: `take.tgz` sha256 `3246306c4a43e147d97abaa5252523729bb47acdb07bc9babab426f583056939`;
- audio: `power-switch-liam.mp3`, 81,128 bytes, sha256 `1aabe1884ccbe2f51aba32b0de310f6eb7ffaad2c8ad94facfc3495e70d20b85`, 5.04 s;
- voice: "Liam - Energetic, Social Media Creator" (`TX3LPaxmHKxFdv7VOQHJ`), `eleven_multilingual_v2`, mp3 44.1 kHz 128 kbps.

**Text.** "PC won't turn on? Check the switch on the back. O is off. I is on." It is 66 characters, SHA-256 `0aa60d73…554c66`.

**Cost.**
- characters sent: 66;
- the provider's reported charge: 26;
- included characters remaining before the run: 66,337.

**Line timings** (from the provider's timestamps):

| Line | Start | End |
|---|---|---|
| hook | 0.000 s | 1.196 s |
| where | 1.800 s | 2.972 s |
| off | 3.123 s | 3.901 s |
| on | 4.110 s | 5.016 s |

This is the only take. If a render fails, the edit reuses it; there is no second generation.

It is not a publish approval.

## Rights (recorded 2026-10-09)

**Status:** cleared for commercial posting on YouTube, TikTok and Instagram, with AI disclosure. No attribution is required.

### Plan: paid (ElevenLabs Starter)

**What the workflow's own subscription read proves.** The take step read the account's subscription before spending (`readSubscription` in `voiceSpendGuards.ts`). It passed only because:
- the account **cannot extend its character limit** (`can_extend_character_limit: false`), so there is no overage billing;
- it had **66,337 included characters remaining** before the request.

The manifest records that remaining figure as `includedCharactersRemainingBefore`.

**What it does not record.** The workflow did not save the plan's *name*: the take script reads `tier` but never wrote or printed it. The job log is also not readable from this environment.

**Why that still means a paid plan.**
- ElevenLabs' free plan grants 10,000 credits a month.
- Rollover of unused credits (up to two months' worth) is a paid-plan feature.
- A balance of 66,337 is therefore not reachable on the free plan.
- It is consistent with Starter: 30,000 a month plus up to two months' rollover, so up to 90,000.

**The plan's name.** The owner stated "Starter" on 2026-10-09.

**Sources.** These were read through search excerpts, because elevenlabs.io is blocked from this environment:
- [Pricing](https://elevenlabs.io/pricing): Starter, 30,000 credits, Commercial License.
- [Billing](https://elevenlabs.io/docs/overview/administration/billing): commercial rights on paid plans; up to two months' rollover.
- [Can I publish the content I generate?](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform): every paid plan includes a commercial licence, outside Beta Services; free-plan output is non-commercial and needs "elevenlabs.io" attribution.

### Commercial use

Paid-plan output carries commercial rights, and the paid plan does not require attribution. The use must still comply with ElevenLabs' Prohibited Use Policy. This video, a PC troubleshooting tip with no impersonation, no deception and no real person's voice, is within it. The model used, `eleven_multilingual_v2`, is a generally available model, not a Beta Service.

### Voice-specific restrictions

**None found.** "Liam" (`TX3LPaxmHKxFdv7VOQHJ`) is ElevenLabs' premade voice (see `liamVoice.ts`), not a Voice Library voice:
- **Owner restrictions:** the per-voice restrictions ElevenLabs describes come from a Voice Library voice's owner, so they don't apply to a premade voice.
- **Credit multiplier:** the take's charge (26) shows none.
- **Pages read:** [Voices](https://elevenlabs.io/docs/overview/capabilities/voices) and [Terms of Service](https://elevenlabs.io/terms-of-use), via search excerpts.

**Watch item, not a blocker for this video.** ElevenLabs says its Default (premade) voices will **expire on 31 December 2026**, and are being replaced with voices usable in perpetuity. That affects generating new Liam takes after that date. Nothing found says it withdraws rights to audio already generated on a paid plan, but this should be re-checked before any Liam take is generated after 2026.

### Disclosure

The voice is AI-generated text-to-speech, and every post discloses it (`POSTING_PACKAGE.md`):
- **TikTok and Instagram:** the platform's AI-content label is turned on.
- **YouTube:** an "AI voiceover" line in the description, and the altered/synthetic label switched on as a transparency choice.

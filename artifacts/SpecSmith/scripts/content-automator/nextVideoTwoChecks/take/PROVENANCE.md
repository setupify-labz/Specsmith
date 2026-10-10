# Provenance: the two-checks Liam take

**Not a publish approval.** This records one generated narration take and how it was made.

## The words
The owner approved this exact text on 2026-10-09 for **one** Liam take:

```text
No power? Check the power supply switch. O is off. I is on. PC on, but no picture? If you have a graphics card, check that your monitor is plugged into its ports.
```

- 162 characters.
- Text SHA-256: `af229825dfd57adffcabf6da0488621510b5f215e3c9cdfd25d38f2131e0e954`, pinned in `liamTake.ts`.

## The generation (one request)
- **Workflow:** `ElevenLabs voice sample (manual)`, run 38007872159, dispatched once on 2026-10-10.
  - Inputs: `script=two-checks`, `confirm=generate`, `review_pr=178`.
  - Commit: `3cf31f0`.
- **Provider and voice:** ElevenLabs text-to-speech with timestamps; model `eleven_multilingual_v2`; output `mp3_44100_128`.
  - Voice: "Liam - Energetic, Social Media Creator", id `TX3LPaxmHKxFdv7VOQHJ`, the pinned id.
- **Guards checked before the request** (the shared `voiceSpendGuards.ts`, unchanged):
  - exact text and hash;
  - the pinned Liam id;
  - the 360-character cap;
  - no overage possible;
  - enough included characters.
- **Credits:**
  - 66,311 included characters remained before the run.
  - 162 characters were sent.
  - The provider's `character-cost` header reported **65**.
  - For comparison, the power-switch take's header reported 26, and the balance fell by exactly 26 between the two runs (66,337 → 66,311).
- **Hand-over:** the secretless share job posted `take.tgz` to #178 in 8 base64 parts.
  - Archive SHA-256: `5d2000e05ef183feedf35c5ecfe99e6aa564ad9f6869d0ff013edf61c810f0be`, matched when reassembled.

## The files
| File | SHA-256 | Notes |
|---|---|---|
| `two-checks-liam.mp3` | `7abf2b58694b3ea1b9c8a7a2d2c576426dd538ab0d31061f924916989ede0826` | 174,333 bytes, 10.87 s, mono 44.1 kHz |
| `two-checks-liam.json` | (manifest) | Provider character timestamps; they spell the approved text exactly |

The raw provider response (`two-checks-liam.response.json`) was kept with the run's archive and is not committed. It contains the same audio, base64-encoded.

The loader pins the audio SHA-256 and the timestamps' SHA-256 (`0aab73b8…7cd4`). Any other rendering is refused.

## Line timings (seconds in the take)
| Line | Start | End |
|---|---|---|
| No power? | 0.000 | 0.697 |
| Check the power supply switch. | 1.138 | 2.624 |
| O is off. | 3.228 | 4.063 |
| I is on. | 4.574 | 5.178 |
| PC on, but no picture? | 5.294 | 7.059 |
| If you have a graphics card, check that your monitor is plugged into its ports. | 7.442 | 10.820 |

## Rights
Generated on the same paid ElevenLabs plan (Starter) as the power-switch take.

That take's record, `nextVideoPowerSwitch/take/PROVENANCE.md` § Rights, covers:
- commercial use;
- no attribution required;
- no voice-specific restriction found;
- the watch item that premade voices retire on 2026-12-31.

The included-character balance before this run (66,311) is again above anything the free plan allows.

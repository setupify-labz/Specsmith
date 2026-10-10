# Provenance: the two-checks v2 Liam take

**Not a publish approval.** This records one generated narration take and how it was made.

## The words
The owner approved this exact text on 2026-10-10 for **one** Liam take. It is the version that keeps "If you have a graphics card", with straight ASCII apostrophes.

```text
PC won't turn on? Check the power supply switch. If it's on O, flip it to I. PC on, but no picture? If you have a graphics card, make sure your monitor is plugged into it.
```

- 171 characters.
- Text SHA-256: `5fd951ad6408b0cb1e1d51e373512f6a2159a704780860ed145d92f7b9b0f7dc`, pinned in `liamTakeV2.ts`.

## The generation (one request)
- **Workflow:** `ElevenLabs voice sample (manual)`, run 38022470641, dispatched once on 2026-10-10.
  - Inputs: `script=two-checks-v2`, `confirm=generate`, `review_pr=178`.
  - Commit: `07ad598`.
- **Provider and voice:** ElevenLabs text-to-speech with timestamps; model `eleven_multilingual_v2`; output `mp3_44100_128`.
  - Voice: "Liam - Energetic, Social Media Creator", id `TX3LPaxmHKxFdv7VOQHJ`, the pinned id.
- **Guards:** the shared `voiceSpendGuards.ts`, unchanged.
  - exact text and hash;
  - the pinned Liam id;
  - the 360-character cap;
  - no overage possible;
  - enough included characters.
- **Credits:**
  - 66,246 included characters remained before the run.
  - 171 characters were sent.
  - The provider's `character-cost` header reported **68**.
  - The balance before this run is exactly the first two-checks take's balance (66,311) minus that take's reported 65, which confirms the header as the actual charge.
- **Hand-over:** the secretless share job posted `take.tgz` to #178 in 10 base64 parts.
  - Archive SHA-256: `ae504cda7a73e7a40da8a3719fa609f0c88c56629f95de587c1e2155608b0fcd`, matched when reassembled.

## The files
| File | SHA-256 | Notes |
|---|---|---|
| `two-checks-v2-liam.mp3` | `9893c21bab90ba2899ded254c1e7fc20453a9ee2a53e5ab944f25ec0d445a796` | 211,949 bytes, 13.22 s |
| `two-checks-v2-liam.json` | (manifest) | Provider character timestamps; they spell the approved text exactly |

The loader pins the audio SHA-256 and the timestamps' SHA-256 (`33e7e5a2…54f1`).

## Line timings (seconds in the take)
| Line | Start | End |
|---|---|---|
| PC won't turn on? | 0.000 | 1.324 |
| Check the power supply switch. | 1.927 | 3.483 |
| If it's on O, flip it to I. | 4.296 | 6.374 |
| PC on, but no picture? | 7.187 | 8.975 |
| If you have a graphics card, make sure your monitor is plugged into it. | 9.578 | 13.189 |

## In the cut
- The take is placed in five stretches, split only in silence. No word is cut, stretched or re-spoken.
- Two of Liam's pauses are shortened to 0.45 s by dropping silence from their middle: 0.81 s → 0.45 s, and 0.60 s → 0.45 s.

## Rights
Same paid ElevenLabs plan (Starter) as the earlier takes. See `nextVideoPowerSwitch/take/PROVENANCE.md` § Rights.

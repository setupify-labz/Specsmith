# The saved Liam take (GPU-upgrade Short)

The ONE paid generation, approved 2026-10-07. Every render uses these bytes;
a failed render is re-run from them and never re-generated.

- **Run:** GitHub Actions run 37624439839 (`elevenlabs-voice-sample.yml`, `script: gpu-upgrade`), on commit `4404702`.
- **Hand-over:** posted to PR #176 by the job that holds no secret, as 17 base64 parts. The archive's SHA-256 was `983948746fd6c1c518661ff2712fea51491a54f5e0f01d49f2f237c601f7bfae`; it was verified before the files were extracted.
- **Voice:** "Liam - Energetic, Social Media Creator", pinned id `TX3LPaxmHKxFdv7VOQHJ`, model `eleven_multilingual_v2`, `mp3_44100_128`.
- **Text:** the approved 314-character script, SHA-256 `fd154a03bcda906e7901b6a97be7d879c9ae4d1e0098ec1777364e692a82d19e`. The provider's timestamps spell it exactly.
- **Characters:** 314 sent. The provider reported a charge of 126; 66,463 included characters remained before the request.
- **Audio:** `gpu-upgrade-liam.mp3`, 372,445 bytes, SHA-256 `714123290712ec494e6c51d51050c67919e63c8298f2baeeb72f6bb2baabf8a3`, 23.25 s.
- **Raw response:** the workflow's `gpu-upgrade-liam.response.json` (509,464 bytes) is not checked in. It repeats the audio as base64 alongside the same timestamps that are in the manifest. It remains in the run's artifact while that is retained.

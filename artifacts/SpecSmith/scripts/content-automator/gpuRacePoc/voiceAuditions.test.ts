// Voice auditions: every guard runs before the first paid request, one request
// per voice, the exact excerpt, no retries and no substitute. Fake provider only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { assertApprovedExcerpt, AUDITION_TEXT, chooseAuditionVoices, generateAuditions, type AccountVoice } from "./voiceAuditions.ts";

const LIAM = REVIEWED_LIAM_VOICE.voiceId;
const A = "AAAAAAAAAAAAAAAAAAAA";
const B = "BBBBBBBBBBBBBBBBBBBB";
const voices = [
  { voice_id: LIAM, name: "Liam - Energetic, Social Media Creator", category: "premade", labels: {} },
  { voice_id: A, name: "Alpha - Upbeat", category: "premade", labels: { use_case: "social_media" } },
  { voice_id: B, name: "Bravo", category: "premade", labels: { use_case: "characters_animation" } },
];
const env = (ids: string) => ({ ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_VOICE_ID: LIAM, AUDITION_VOICE_IDS: ids }) as NodeJS.ProcessEnv;
const mp3 = Buffer.from("ID3-fake-mp3-bytes");

function provider(over: { subscription?: Record<string, unknown>; failOn?: string } = {}) {
  const requests: { url: string; body?: string }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.endsWith("/v1/voices")) return new Response(JSON.stringify({ voices }));
    if (url.endsWith("/v1/user/subscription")) {
      return new Response(JSON.stringify(over.subscription ?? { tier: "starter", character_count: 300, character_limit: 67000, can_extend_character_limit: false }));
    }
    if (over.failOn && url.includes(over.failOn)) return new Response("quota", { status: 401 });
    return new Response(mp3, { headers: { "content-type": "audio/mpeg", "character-cost": "40" } });
  };
  const paid = () => requests.filter((request) => request.url.includes("/v1/text-to-speech/"));
  return { fetchImpl, paid };
}

let work: string;
beforeAll(async () => { work = await mkdtemp(join(tmpdir(), "auditions-")); });
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

describe("before any spend", () => {
  it("quotes the approved race lines exactly, with Compare's figures", async () => {
    await expect(assertApprovedExcerpt()).resolves.toBeUndefined();
    expect(AUDITION_TEXT).toBe("Twenty of twenty modelled leads. Yet on average, one sixty-four to one sixty. Just four FPS apart.");
  });

  it("needs exactly two distinct ids on the account, neither of them Liam", () => {
    const account: AccountVoice[] = voices.map((voice) => ({ voiceId: voice.voice_id, name: voice.name, category: voice.category, labels: voice.labels, description: "" }));
    expect(chooseAuditionVoices(`${A},${B}`, account).map((voice) => voice.voiceId)).toEqual([A, B]);
    expect(() => chooseAuditionVoices(A, account)).toThrow(/Exactly two/);
    expect(() => chooseAuditionVoices(`${A},${A}`, account)).toThrow(/same voice/);
    expect(() => chooseAuditionVoices(`${A},${LIAM}`, account)).toThrow(/Liam/);
    expect(() => chooseAuditionVoices(`${A},CCCCCCCCCCCCCCCCCCCC`, account)).toThrow(/not on this account/);
    expect(() => chooseAuditionVoices(`${A},$(rm -rf)`, account)).toThrow(/not a voice id/);
  });

  it("refuses a top-up account, or one without the characters for both, before the first request", async () => {
    for (const subscription of [
      { tier: "starter", character_count: 0, character_limit: 67000, can_extend_character_limit: true },
      { tier: "starter", character_count: 67000 - AUDITION_TEXT.length - 1, character_limit: 67000, can_extend_character_limit: false },
    ]) {
      const { fetchImpl, paid } = provider({ subscription });
      await expect(generateAuditions({ env: env(`${A},${B}`), fetchImpl, outputDir: join(work, "refused") })).rejects.toThrow();
      expect(paid()).toHaveLength(0);
    }
  });
});

describe("the auditions", () => {
  it("makes one request per voice with the exact excerpt, and names each file by voice name and id", async () => {
    const { fetchImpl, paid } = provider();
    const dir = join(work, "ok");
    const { auditions } = await generateAuditions({ env: env(`${A},${B}`), fetchImpl, outputDir: dir });
    expect(paid().map((request) => request.url.split("/v1/text-to-speech/")[1].split("?")[0])).toEqual([A, B]);
    for (const request of paid()) expect(JSON.parse(request.body!).text).toBe(AUDITION_TEXT);
    expect(auditions.map((audition) => audition.file)).toEqual([`audition-alpha-${A}.mp3`, `audition-bravo-${B}.mp3`]);
    expect(auditions.every((audition) => audition.providerReportedCharacterCost === 40)).toBe(true);
    expect((await readdir(dir)).sort()).toEqual([`audition-alpha-${A}.mp3`, `audition-bravo-${B}.mp3`, "auditions.json"]);
    expect(JSON.parse(await readFile(join(dir, "auditions.json"), "utf8"))).toMatchObject({ text: AUDITION_TEXT, toppedUp: false });
  });

  it("stops on a failure without retrying or substituting a voice", async () => {
    const { fetchImpl, paid } = provider({ failOn: B });
    await expect(generateAuditions({ env: env(`${A},${B}`), fetchImpl, outputDir: join(work, "partial") })).rejects.toThrow(/1 audition\(s\) were kept/);
    expect(paid()).toHaveLength(2);
  });
});

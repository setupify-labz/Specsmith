// TEST SUPPORT ONLY. A fake network installed as `globalThis.fetch`.
//
// IT MUST BE THE FIRST IMPORT of any test file that uses it. elevenLabsTts.ts
// and hostedMaster.ts capture the global fetch when they first load and only
// trust requests made through that captured function; installing this after
// they load leaves them holding the real fetch, and the clean control then
// fails loudly (no ElevenLabs evidence) instead of silently doing something
// else.
//
// This is the documented edge of the trust model, used on purpose: code that
// replaces `globalThis.fetch` before those modules load can impersonate
// ElevenLabs and a storage host. Tests do exactly that so a clean control can
// be constructed without calling a paid provider or uploading anything; the
// bypass tests then show that everything short of that — labels, injected
// transports, caller URLs — is refused.
//
// Nothing here reaches a real network. Any request it does not recognise
// throws, so an accidental call to a real service fails instead of leaking.

import { afterAll } from "vitest";

export const CONTROL_HOST_ORIGIN = "https://media.control.test";
const ELEVENLABS_ORIGIN = "https://api.elevenlabs.io";

export const fakeNetwork = {
  /** The audio the fake ElevenLabs endpoint returns for the next request. */
  ttsAudio: new Uint8Array(0),
  /** Objects the fake storage host serves, by absolute URL. */
  objects: new Map<string, Uint8Array>(),
  /** Every URL requested, for assertions that no unexpected call was made. */
  requests: [] as string[],
};

const original = globalThis.fetch;

const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  fakeNetwork.requests.push(`${init?.method ?? "GET"} ${url.href}`);
  if (url.origin === ELEVENLABS_ORIGIN && (init?.method ?? "GET") === "POST") {
    if (fakeNetwork.ttsAudio.byteLength === 0) return new Response("no audio configured", { status: 500 });
    return new Response(Buffer.from(fakeNetwork.ttsAudio), {
      status: 200,
      headers: { "content-type": "audio/mpeg", "request-id": `fake-${fakeNetwork.requests.length}` },
    });
  }
  if (url.origin === CONTROL_HOST_ORIGIN) {
    const body = fakeNetwork.objects.get(url.href);
    return body ? new Response(Buffer.from(body), { status: 200, headers: { "content-type": "video/mp4" } }) : new Response("", { status: 404 });
  }
  throw new Error(`The fake network refuses an unexpected request to ${url.href}.`);
};

globalThis.fetch = fake as typeof fetch;
afterAll(() => {
  globalThis.fetch = original;
});

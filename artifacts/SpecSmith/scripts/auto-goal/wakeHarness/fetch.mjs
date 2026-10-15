// Test-only: loaded with `node --import`, replaces fetch with the harness so no request leaves the machine.
import { handle } from "./api.mjs";

globalThis.fetch = async (url, init = {}) => {
  const { status, body } = handle(init.method ?? "GET", String(url), init.body ? JSON.parse(init.body) : undefined);
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
};

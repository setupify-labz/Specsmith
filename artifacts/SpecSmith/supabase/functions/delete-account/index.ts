// Permanently deletes the calling user's account (auth.users row, cascading
// to profiles + saved_builds via their `on delete cascade` foreign keys —
// see supabase-schema.sql). This can only run as an Edge Function: deleting
// an auth.users row requires the service-role key, which must never reach
// the browser, so the client (AuthContext.tsx's deleteAccount) calls this
// function instead of touching auth.users directly.
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// injected automatically into every Edge Function's environment by
// Supabase itself — they are never stored in this repo or passed in by us.
//
// Deploy with the Supabase CLI from a machine with an authenticated,
// linked project: `supabase functions deploy delete-account`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const jsonResponse = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Scoped to the caller's own JWT — used only to find out who is asking,
  // never to perform the deletion itself.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  // Service-role client — only ever used server-side, only for this one
  // targeted admin call, scoped to the id we just verified above.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return jsonResponse({ error: deleteError.message }, 500);
  }

  return jsonResponse({ ok: true }, 200);
});

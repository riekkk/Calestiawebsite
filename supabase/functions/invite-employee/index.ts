// ============================================================================
// Calestia Travel & Tours — invite-employee Edge Function
// ============================================================================
// Called from admin-portal.js via supabaseClient.functions.invoke('invite-employee').
// Replaces the old EmailJS-based flow: employee accounts are now created and
// invited entirely through Supabase Auth's own admin API, which sends
// Supabase's built-in "Invite user" email (customizable in Dashboard →
// Authentication → Email Templates) with a secure, single-use link that
// expires automatically. No third-party email service involved.
//
// Security model — read this before changing anything:
//   1. `callerClient` is built from the INCOMING request's Authorization
//      header (the calling admin's own JWT). Every query through it is
//      RLS-checked exactly as if it came from the browser — this is how we
//      know the caller really is who they claim, and really is an active
//      admin, before doing anything privileged.
//   2. `serviceClient` (service_role) is used for EXACTLY ONE thing:
//      auth.admin.inviteUserByEmail(), because creating a brand-new auth
//      user has no anon-key-callable equivalent. It is never used to touch
//      the profiles table.
//   3. The new user's role/status is set via `callerClient` (the admin's
//      own JWT), not service_role — so the existing profiles_update RLS
//      policy and protect_profile_privileges trigger evaluate is_admin()
//      for real. No bypass flags, no new SQL migration needed; this reuses
//      exactly the same authorization path every other admin action in
//      this app already goes through.
//   4. We deliberately do NOT pass the intended role as user_metadata on
//      the invite (`data: {...}`) — user_metadata is client-writable, so a
//      malicious caller could otherwise self-invite with `invited_role:
//      "admin"` via a raw API call. The role only ever gets set by this
//      function's own admin-authenticated update, after admin status has
//      already been verified server-side.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Every response — success or failure — is HTTP 200 with a `success`
// boolean in the body. supabase-js's functions.invoke() routes non-2xx
// responses through `result.error` (a generic FunctionsHttpError) rather
// than `result.data`, which would swallow these specific, actionable
// error messages. Always-200 + a body flag sidesteps that entirely; the
// one exception is a wrong HTTP method, which is a caller bug, not
// something a user-facing message needs to explain.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ success: false, error: 'Missing Authorization header.' })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData?.user) {
      return json({ success: false, error: 'Your session has expired. Please sign in again.' })
    }
    const caller = userData.user

    const { data: callerProfile, error: profileError } = await callerClient
      .from('profiles')
      .select('role, status, full_name, email')
      .eq('id', caller.id)
      .maybeSingle()

    if (profileError || !callerProfile || callerProfile.role !== 'admin' || callerProfile.status !== 'active') {
      return json({ success: false, error: 'Only active administrators can invite employees.' })
    }

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      return json({ success: false, error: 'Invalid request body.' })
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role = body.role === 'admin' ? 'admin' : body.role === 'employee' ? 'employee' : null

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, error: 'Enter a valid email address.' })
    }
    if (!role) {
      return json({ success: false, error: 'Role must be "employee" or "admin".' })
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

    const origin = req.headers.get('origin') || new URL(req.url).origin
    const { data: inviteResult, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/accept-invite.html`,
    })

    if (inviteError || !inviteResult?.user) {
      const message = /already registered|already exists|already been registered/i.test(inviteError?.message || '')
        ? 'This email already has an account. Promote them from the Accounts list instead of inviting them.'
        : inviteError?.message || 'Could not create the invitation.'
      return json({ success: false, error: message })
    }

    const newUserId = inviteResult.user.id

    const { error: roleError } = await callerClient
      .from('profiles')
      .update({ role, status: 'pending' })
      .eq('id', newUserId)

    if (roleError) {
      return json({
        success: false,
        error: `Invitation email sent, but the role couldn't be set automatically (${roleError.message}). ` +
          `Promote ${email} from the Accounts list once they've set their password.`,
      })
    }

    await serviceClient.from('audit_logs').insert({
      actor_id: caller.id,
      actor_name: callerProfile.full_name || callerProfile.email,
      action: 'Invited employee',
      client_id: newUserId,
      field_changed: 'invitation',
      new_value: `${email} as ${role}`,
    })

    return json({ success: true })
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : 'Unexpected error.' })
  }
})

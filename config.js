/* ==========================================================================
   Calestia Travel & Tours — Supabase configuration
   ==========================================================================
   This is the same Supabase project used by the original Next.js site
   (lib/supabaseClient.ts). The anon/publishable key below is safe to expose
   in client-side code by design — it identifies the project, it does not
   grant access. Actual data access is enforced by Supabase Row Level
   Security (RLS) policies on the project itself, the same way a Stripe
   "publishable" key works. Never put a service_role/secret key here.
   ========================================================================== */
window.CALESTIA_SUPABASE_URL = 'https://bhhmlxjrklrjkqxoumfk.supabase.co';
window.CALESTIA_SUPABASE_ANON_KEY = 'sb_publishable_tSAwI-7s5WNHyLBU4bTihA_j8qFxxwC';

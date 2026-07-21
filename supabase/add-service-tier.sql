-- ============================================================================
-- Calestia Travel & Tours — Service tier on visa applicants
-- ============================================================================
-- Run this ONCE in your Supabase project's SQL editor, after
-- supabase/visa-applications-schema.sql has already been applied. Safe to
-- re-run (ADD COLUMN IF NOT EXISTS).
--
-- Purely additive: adds a service_tier column to the existing
-- public.visa_applicants table. Existing RLS policies on visa_applicants
-- are row-level (auth.uid() = client_id / public.is_staff()), so they
-- automatically cover this new column with no policy changes needed.
-- ============================================================================

alter table public.visa_applicants
  add column if not exists service_tier text not null default 'standard'
  check (service_tier in ('standard', 'premium'));

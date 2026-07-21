-- ============================================================================
-- Calestia Travel & Tours — Optional internal staff note on payment_submissions
-- ============================================================================
-- Run this ONCE in your Supabase project's SQL editor, after
-- supabase/visa-applications-schema.sql has already been applied. Safe to
-- re-run (ADD COLUMN IF NOT EXISTS).
--
-- Purely additive: adds a nullable staff_note column. Distinct from the
-- existing `remarks` column — remarks is the client-facing rejection
-- reason (surfaced in the notification the client receives); staff_note is
-- an internal-only annotation, never shown to the client, saved
-- independently of the verify/reject action via its own "Save Note" button.
-- Existing RLS policies on payment_submissions are row-level and already
-- restrict updates to staff (protect_payment_submission_fields()), so no
-- policy changes are needed for a plain staff-editable column.
-- ============================================================================

alter table public.payment_submissions
  add column if not exists staff_note text;

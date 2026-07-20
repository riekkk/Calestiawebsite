-- ============================================================================
-- Calestia Travel & Tours — Profile extensions (Client/Employee/Admin portal redesign)
-- ============================================================================
-- Run this ONCE in your Supabase project's SQL editor, after portal-schema.sql
-- has already been applied. Safe to re-run (uses ADD COLUMN IF NOT EXISTS
-- throughout).
--
-- Purely additive: adds nullable columns to the existing public.profiles
-- table so the redesigned portals can show a real Profile page and real,
-- persisted notification-preference toggles instead of fields with nowhere
-- to save. Nothing here touches role/status, existing RLS policies, or
-- existing triggers — the profiles_select/profiles_update policies in
-- portal-schema.sql are row-level, so they automatically cover these new
-- columns with no policy changes needed. protect_profile_privileges() only
-- guards role/status, so these columns remain self-editable by the owning
-- client exactly like full_name already is.
-- ============================================================================


-- ============================================================================
-- 1. Client profile fields shown on the Client Portal "Profile" tab
-- ============================================================================
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists nationality text;
alter table public.profiles add column if not exists passport_number text;
alter table public.profiles add column if not exists date_of_birth date;


-- ============================================================================
-- 2. Notification preferences — backs the toggles on the Employee/Admin
--    Settings screens. jsonb so new toggle keys can be added later without
--    another migration; defaults to an empty object (client code treats a
--    missing key as "on", matching the Figma mock's defaultChecked toggles).
-- ============================================================================
alter table public.profiles add column if not exists notification_preferences jsonb not null default '{}'::jsonb;

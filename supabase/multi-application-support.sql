-- ============================================================================
-- Calestia Travel & Tours — Multiple concurrent visa applications per client
-- ============================================================================
-- Run this ONCE in your Supabase project's SQL editor, after
-- supabase/visa-applications-schema.sql and supabase/add-service-tier.sql
-- have already been applied. Safe to re-run (every step is idempotent).
--
-- Reverses the earlier "one application per client" simplification.
-- Applicants added together in one Apply-a-Visa modal session now share an
-- application_batch_id, so a client can have several simultaneous
-- applications (e.g. a Japan application and a separate one for someone
-- else) instead of one flat applicant list.
--
-- Existing RLS policies on visa_applicants / payment_submissions are
-- row-level on client_id and are untouched by this migration — they
-- automatically cover the new column with no policy changes needed.
-- ============================================================================

alter table public.visa_applicants
  add column if not exists application_batch_id uuid;

alter table public.payment_submissions
  add column if not exists application_batch_id uuid;

-- Backfill: every client's existing applicants (added back when there was
-- only ever one application per client) become a single batch, and any of
-- that client's existing payment_submissions rows are pointed at the same
-- batch — this is unambiguous under the old model since there was only
-- ever one batch per client to begin with.
do $$
declare
  rec record;
  new_batch uuid;
begin
  for rec in
    select distinct client_id from public.visa_applicants where application_batch_id is null
  loop
    new_batch := gen_random_uuid();
    update public.visa_applicants set application_batch_id = new_batch
      where client_id = rec.client_id and application_batch_id is null;
    update public.payment_submissions set application_batch_id = new_batch
      where client_id = rec.client_id and application_batch_id is null;
  end loop;
end $$;

-- Guard: a payment_submissions row for a client with zero visa_applicants
-- rows (shouldn't happen given the app's flow, but the column is about to
-- become NOT NULL) gets its own standalone batch id rather than being left
-- null or blocking the migration.
update public.payment_submissions
set application_batch_id = gen_random_uuid()
where application_batch_id is null;

alter table public.visa_applicants
  alter column application_batch_id set default gen_random_uuid();
alter table public.visa_applicants
  alter column application_batch_id set not null;

alter table public.payment_submissions
  alter column application_batch_id set not null;

create index if not exists visa_applicants_batch_idx on public.visa_applicants(application_batch_id);
create index if not exists payment_submissions_batch_idx on public.payment_submissions(application_batch_id);
create index if not exists payment_submissions_client_status_idx on public.payment_submissions(client_id, status);

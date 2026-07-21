-- ============================================================================
-- Calestia Travel & Tours — Visa Assistance: self-serve applicants + payments
-- ============================================================================
-- Run this ONCE in your Supabase project's SQL editor, after portal-schema.sql
-- and profile-extensions.sql have already been applied. Safe to re-run (uses
-- IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS throughout).
--
-- Adds the "Apply a Visa" self-serve flow on the Client Portal's new Visa
-- Assistance page:
--   1. visa_applicants     — traveler details a client fills in per applicant
--                             (first name, passport number, travel date, etc).
--                             Fully owned/editable by the client; staff can
--                             view but not edit (they review via Documents,
--                             same as today).
--   2. payment_submissions — a client's claim "I paid via GCash/Maya/Bank",
--                             with an uploaded receipt. Clients may only
--                             INSERT (each resubmission is a new row, so
--                             there's always an audit trail) — only staff can
--                             verify/reject. Mirrors the documents table's
--                             staff-only status protection pattern.
-- ============================================================================


-- ============================================================================
-- 1. visa_applicants — one row per traveler on a client's visa application
-- ============================================================================
create table if not exists public.visa_applicants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  gender text,
  date_of_birth date,
  nationality text,
  passport_number text,
  passport_expiry date,
  travel_date date,
  visa_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_visa_applicant_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists touch_visa_applicant_updated_at_trigger on public.visa_applicants;
create trigger touch_visa_applicant_updated_at_trigger
  before update on public.visa_applicants
  for each row execute function public.touch_visa_applicant_updated_at();

alter table public.visa_applicants enable row level security;

drop policy if exists "visa_applicants_select" on public.visa_applicants;
create policy "visa_applicants_select"
  on public.visa_applicants for select
  using (auth.uid() = client_id or public.is_staff());

drop policy if exists "visa_applicants_insert" on public.visa_applicants;
create policy "visa_applicants_insert"
  on public.visa_applicants for insert
  with check (auth.uid() = client_id);

drop policy if exists "visa_applicants_update" on public.visa_applicants;
create policy "visa_applicants_update"
  on public.visa_applicants for update
  using (auth.uid() = client_id)
  with check (auth.uid() = client_id);

drop policy if exists "visa_applicants_delete" on public.visa_applicants;
create policy "visa_applicants_delete"
  on public.visa_applicants for delete
  using (auth.uid() = client_id);


-- ============================================================================
-- 2. payment_submissions — a client's claim of having paid, pending staff
--    verification. Each attempt is a new row (no client UPDATE policy), so
--    a rejected attempt never silently overwrites the record staff reviewed.
-- ============================================================================
create table if not exists public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  method text not null check (method in ('gcash', 'maya', 'bank')),
  applicant_count integer not null default 1,
  amount numeric(10,2) not null,
  reference_note text,
  receipt_path text,
  receipt_file_name text,
  status text not null default 'pending_verification' check (status in (
    'pending_verification', 'verified', 'rejected'
  )),
  remarks text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Clients may only ever create a fresh submission — never edit status/
-- verification fields on an existing one. Mirrors protect_document_fields().
create or replace function public.protect_payment_submission_fields()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    if not public.is_staff() then
      new.status := 'pending_verification';
      new.verified_by := null;
      new.verified_at := null;
      new.remarks := null;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if not public.is_staff() then
    raise exception 'Only staff can update a payment submission';
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists protect_payment_submission_fields_trigger on public.payment_submissions;
create trigger protect_payment_submission_fields_trigger
  before insert or update on public.payment_submissions
  for each row execute function public.protect_payment_submission_fields();

alter table public.payment_submissions enable row level security;

drop policy if exists "payment_submissions_select" on public.payment_submissions;
create policy "payment_submissions_select"
  on public.payment_submissions for select
  using (auth.uid() = client_id or public.is_staff());

drop policy if exists "payment_submissions_insert" on public.payment_submissions;
create policy "payment_submissions_insert"
  on public.payment_submissions for insert
  with check (auth.uid() = client_id);

drop policy if exists "payment_submissions_update" on public.payment_submissions;
create policy "payment_submissions_update"
  on public.payment_submissions for update
  using (public.is_staff())
  with check (public.is_staff());


-- ============================================================================
-- 3. Notify the client + audit log when staff verify/reject a payment
--    (mirrors on_document_updated() in portal-schema.sql)
-- ============================================================================
create or replace function public.on_payment_submission_updated()
returns trigger as $$
declare
  actor_name text;
begin
  if new.status is distinct from old.status and new.status in ('verified', 'rejected') then
    select full_name into actor_name from public.profiles where id = auth.uid();

    insert into public.notifications (client_id, message, type)
    values (
      new.client_id,
      case when new.status = 'verified'
        then 'Your payment via ' || new.method || ' has been verified.'
        else 'Your payment via ' || new.method || ' could not be verified' || coalesce(' — ' || new.remarks, '.')
      end,
      'payment_status'
    );

    insert into public.audit_logs (actor_id, actor_name, action, client_id, field_changed, old_value, new_value)
    values (auth.uid(), actor_name, 'Updated payment submission status', new.client_id, 'payment status', old.status, new.status);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_payment_submission_updated_trigger on public.payment_submissions;
create trigger on_payment_submission_updated_trigger
  after update on public.payment_submissions
  for each row execute function public.on_payment_submission_updated();


-- ============================================================================
-- 4. Storage — private bucket for uploaded payment receipts
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts', 'payment-receipts', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Files are stored as payment-receipts/{auth.uid()}/{filename} so the first
-- path segment doubles as the ownership check below (same scheme as
-- client-documents in portal-schema.sql).
drop policy if exists "payment_receipts_insert" on storage.objects;
create policy "payment_receipts_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment_receipts_select" on storage.objects;
create policy "payment_receipts_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-receipts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
  );


-- ============================================================================
-- 5. Realtime — let client + staff dashboards subscribe to live changes
-- ============================================================================
do $$
begin
  alter publication supabase_realtime add table public.visa_applicants;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.payment_submissions;
exception when duplicate_object then null;
end $$;

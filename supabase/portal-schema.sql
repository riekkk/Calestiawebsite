-- ============================================================================
-- Calestia Travel & Tours — Client / Employee / Admin Portal schema
-- ============================================================================
-- Run this ONCE in your Supabase project's SQL editor (Dashboard → SQL Editor
-- → New query → paste this whole file → Run). The site only ships with the
-- public anon key, which cannot create tables, so this step can't be done
-- from the browser.
--
-- This migration is safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE /
-- ON CONFLICT DO NOTHING throughout) if you need to reapply it.
--
-- After running this file, scroll to the very bottom and run the one-line
-- statement to make your own account the first Administrator — nothing
-- else in this system can create an admin, by design.
-- ============================================================================


-- ============================================================================
-- 1. profiles — one row per auth user, carries the role (client/employee/admin)
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'client' check (role in ('client', 'employee', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every new signup becomes a 'client' automatically. Employees/admins are
-- never created by signing up — an admin promotes an existing client
-- profile from the Admin Portal instead (see profiles UPDATE policy below).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'first_name', new.email),
    new.email,
    'client'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper functions used throughout RLS policies below. SECURITY DEFINER +
-- a fixed search_path avoids infinite recursion (a plain policy on profiles
-- that queries profiles would recurse into itself).
create or replace function public.current_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public;

create or replace function public.is_staff()
returns boolean as $$
  select coalesce(public.current_role() in ('employee', 'admin'), false);
$$ language sql stable security definer set search_path = public;

create or replace function public.is_admin()
returns boolean as $$
  select coalesce(public.current_role() = 'admin', false);
$$ language sql stable security definer set search_path = public;

-- Only admins may change role/status on any profile (own or someone else's).
-- Everyone (including staff) may still edit their own full_name.
create or replace function public.protect_profile_privileges()
returns trigger as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only administrators can change account roles';
    end if;
    if new.status is distinct from old.status then
      raise exception 'Only administrators can change account status';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists protect_profile_privileges_trigger on public.profiles;
create trigger protect_profile_privileges_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
  on public.profiles for select
  using (auth.uid() = id or public.is_staff());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());


-- ============================================================================
-- 2. applications — one visa-application status record per client
-- ============================================================================
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'documents_incomplete' check (status in (
    'documents_incomplete', 'documents_under_review', 'ready_for_submission',
    'submitted_to_jvac', 'under_embassy_review', 'additional_documents_requested',
    'visa_approved', 'visa_denied', 'passport_ready_for_pickup', 'completed'
  )),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every client profile automatically gets a tracked application row so
-- staff dashboards and status pages never have to handle a "missing" case.
create or replace function public.handle_new_client_application()
returns trigger as $$
begin
  if new.role = 'client' then
    insert into public.applications (client_id, status)
    values (new.id, 'documents_incomplete')
    on conflict (client_id) do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_profile_created_application on public.profiles;
create trigger on_profile_created_application
  after insert on public.profiles
  for each row execute function public.handle_new_client_application();

-- Only staff may change a status; clients are read-only on their own row.
create or replace function public.protect_application_fields()
returns trigger as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff can update an application';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists protect_application_fields_trigger on public.applications;
create trigger protect_application_fields_trigger
  before update on public.applications
  for each row execute function public.protect_application_fields();

alter table public.applications enable row level security;

drop policy if exists "applications_select" on public.applications;
create policy "applications_select"
  on public.applications for select
  using (auth.uid() = client_id or public.is_staff());

drop policy if exists "applications_update" on public.applications;
create policy "applications_update"
  on public.applications for update
  using (public.is_staff())
  with check (public.is_staff());


-- ============================================================================
-- 3. documents — one row per (client, document type) once something is
--    uploaded; re-uploading upserts the same row rather than creating dupes.
-- ============================================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  document_type text not null check (document_type in (
    'passport', 'visa_application_form', 'birth_certificate', 'marriage_certificate',
    'bank_certificate', 'certificate_of_employment', 'business_documents',
    'student_documents', 'additional_documents'
  )),
  file_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  status text not null default 'pending' check (status in (
    'pending', 'under_review', 'verified', 'rejected', 'reupload_requested'
  )),
  remarks text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, document_type)
);

-- Clients may freely re-upload a file (resets status to pending) but can
-- never set verified/rejected/remarks themselves — only staff can.
create or replace function public.protect_document_fields()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    if not public.is_staff() then
      new.status := 'pending';
      new.verified_by := null;
      new.verified_at := null;
      new.remarks := null;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if not public.is_staff() then
    if new.client_id is distinct from old.client_id then
      raise exception 'Cannot change the document owner';
    end if;
    if new.status is distinct from old.status and new.status <> 'pending' then
      raise exception 'Only staff can set that document status';
    end if;
    if new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at then
      raise exception 'Only staff can verify documents';
    end if;
    if new.remarks is distinct from old.remarks then
      raise exception 'Only staff can leave remarks on a document';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists protect_document_fields_trigger on public.documents;
create trigger protect_document_fields_trigger
  before insert or update on public.documents
  for each row execute function public.protect_document_fields();

alter table public.documents enable row level security;

drop policy if exists "documents_select" on public.documents;
create policy "documents_select"
  on public.documents for select
  using (auth.uid() = client_id or public.is_staff());

drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert"
  on public.documents for insert
  with check (auth.uid() = client_id);

drop policy if exists "documents_update" on public.documents;
create policy "documents_update"
  on public.documents for update
  using (auth.uid() = client_id or public.is_staff())
  with check (auth.uid() = client_id or public.is_staff());


-- ============================================================================
-- 4. remarks — general, client-visible notes from staff (not tied to one document)
-- ============================================================================
create table if not exists public.remarks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.remarks enable row level security;

drop policy if exists "remarks_select" on public.remarks;
create policy "remarks_select"
  on public.remarks for select
  using (auth.uid() = client_id or public.is_staff());

drop policy if exists "remarks_insert" on public.remarks;
create policy "remarks_insert"
  on public.remarks for insert
  with check (public.is_staff() and auth.uid() = author_id);


-- ============================================================================
-- 5. internal_notes — staff-only, NEVER visible to clients (no client policy at all)
-- ============================================================================
create table if not exists public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.internal_notes enable row level security;

drop policy if exists "internal_notes_select" on public.internal_notes;
create policy "internal_notes_select"
  on public.internal_notes for select
  using (public.is_staff());

drop policy if exists "internal_notes_insert" on public.internal_notes;
create policy "internal_notes_insert"
  on public.internal_notes for insert
  with check (public.is_staff() and auth.uid() = author_id);


-- ============================================================================
-- 6. notifications — client-facing, populated automatically by triggers below
-- ============================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  type text not null default 'general',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select"
  on public.notifications for select
  using (auth.uid() = client_id or public.is_staff());

drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update"
  on public.notifications for update
  using (auth.uid() = client_id)
  with check (auth.uid() = client_id);
-- No INSERT policy for regular users on purpose: notifications are only
-- ever created by the SECURITY DEFINER trigger functions below.


-- ============================================================================
-- 7. audit_logs — admin-only, populated automatically by triggers below
-- ============================================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_name text,
  action text not null,
  client_id uuid references public.profiles(id),
  field_changed text,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs_select" on public.audit_logs;
create policy "audit_logs_select"
  on public.audit_logs for select
  using (public.is_admin());
-- No INSERT policy for regular users: only the SECURITY DEFINER triggers write here.


-- ============================================================================
-- 8. Automatic notifications + audit log entries
--    (trigger-based so they fire no matter which screen/employee made the
--    change — this is what keeps every employee dashboard consistent)
-- ============================================================================
create or replace function public.on_document_updated()
returns trigger as $$
declare
  actor_name text;
begin
  select full_name into actor_name from public.profiles where id = auth.uid();

  if new.status is distinct from old.status then
    insert into public.notifications (client_id, message, type)
    values (new.client_id, 'Your "' || replace(new.document_type, '_', ' ') || '" document status changed to "' || replace(new.status, '_', ' ') || '".', 'document_status');

    insert into public.audit_logs (actor_id, actor_name, action, client_id, field_changed, old_value, new_value)
    values (auth.uid(), actor_name, 'Updated document status', new.client_id, new.document_type || ' status', old.status, new.status);
  end if;

  if new.remarks is distinct from old.remarks and new.remarks is not null then
    insert into public.notifications (client_id, message, type)
    values (new.client_id, 'New remark on your "' || replace(new.document_type, '_', ' ') || '" document: ' || new.remarks, 'document_remark');

    insert into public.audit_logs (actor_id, actor_name, action, client_id, field_changed, old_value, new_value)
    values (auth.uid(), actor_name, 'Left remark on document', new.client_id, new.document_type || ' remarks', old.remarks, new.remarks);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_document_updated_trigger on public.documents;
create trigger on_document_updated_trigger
  after update on public.documents
  for each row execute function public.on_document_updated();


create or replace function public.on_application_updated()
returns trigger as $$
declare
  actor_name text;
begin
  if new.status is distinct from old.status then
    select full_name into actor_name from public.profiles where id = auth.uid();

    insert into public.notifications (client_id, message, type)
    values (new.client_id, 'Your application status changed to "' || replace(new.status, '_', ' ') || '".', 'application_status');

    insert into public.audit_logs (actor_id, actor_name, action, client_id, field_changed, old_value, new_value)
    values (auth.uid(), actor_name, 'Updated application status', new.client_id, 'application status', old.status, new.status);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_application_updated_trigger on public.applications;
create trigger on_application_updated_trigger
  after update on public.applications
  for each row execute function public.on_application_updated();


create or replace function public.on_remark_added()
returns trigger as $$
begin
  insert into public.notifications (client_id, message, type)
  values (new.client_id, 'New remark: ' || new.message, 'remark');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_remark_added_trigger on public.remarks;
create trigger on_remark_added_trigger
  after insert on public.remarks
  for each row execute function public.on_remark_added();


create or replace function public.on_profile_privilege_changed()
returns trigger as $$
declare
  actor_name text;
begin
  select full_name into actor_name from public.profiles where id = auth.uid();

  if new.role is distinct from old.role then
    insert into public.audit_logs (actor_id, actor_name, action, client_id, field_changed, old_value, new_value)
    values (auth.uid(), actor_name, 'Changed account role', new.id, 'role', old.role, new.role);
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, actor_name, action, client_id, field_changed, old_value, new_value)
    values (auth.uid(), actor_name, 'Changed account status', new.id, 'status', old.status, new.status);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_profile_privilege_changed_trigger on public.profiles;
create trigger on_profile_privilege_changed_trigger
  after update on public.profiles
  for each row execute function public.on_profile_privilege_changed();


-- ============================================================================
-- 9. Storage — private bucket for uploaded documents
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents', 'client-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Files are stored as client-documents/{auth.uid()}/{document_type}/{filename}
-- so the first path segment doubles as the ownership check below.
drop policy if exists "client_documents_insert" on storage.objects;
create policy "client_documents_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "client_documents_select" on storage.objects;
create policy "client_documents_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'client-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
  );

drop policy if exists "client_documents_update" on storage.objects;
create policy "client_documents_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'client-documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'client-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "client_documents_delete" on storage.objects;
create policy "client_documents_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'client-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
  );


-- ============================================================================
-- 10. Realtime — let staff dashboards subscribe to live changes
-- ============================================================================
do $$
begin
  alter publication supabase_realtime add table public.documents;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.applications;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.remarks;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;


-- ============================================================================
-- 11. Bootstrap your first Administrator — RUN THIS LAST
-- ============================================================================
-- Steps:
--   1. Sign up for a normal account on the live site first (this creates
--      your profiles row with role = 'client').
--   2. Come back here, replace the email below with the one you signed up
--      with, and run ONLY this statement.
-- No other part of this system can grant the admin role — this is the only
-- door in, and it requires direct SQL access to your own Supabase project.
--
-- update public.profiles set role = 'admin' where email = 'you@example.com';

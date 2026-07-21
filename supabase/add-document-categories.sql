-- ============================================================================
-- Calestia Travel & Tours — Document categories + multi-file uploads
-- ============================================================================
-- Run this ONCE in your Supabase project's SQL editor, after
-- supabase/portal-schema.sql has already been applied. Safe to re-run
-- (every step is guarded/idempotent).
--
-- Supports the redesigned "My Documents" page: a category-grouped upload
-- dialog that can queue several files at once, including more than one
-- file of the same document_type (e.g. two "Additional Documents"). This
-- requires dropping the old one-row-per-(client,document_type) constraint
-- and adding a category column so the client table/staff review UI can
-- group rows without re-deriving category from document_type every time.
-- ============================================================================

-- 1. Add + backfill `category`, matching the document_type CHECK list in
--    portal-schema.sql exactly.
alter table public.documents add column if not exists category text;

update public.documents set category = case document_type
  when 'passport' then 'identity'
  when 'birth_certificate' then 'identity'
  when 'marriage_certificate' then 'identity'
  when 'bank_certificate' then 'financial'
  when 'certificate_of_employment' then 'financial'
  when 'visa_application_form' then 'application_form'
  when 'business_documents' then 'supporting'
  when 'student_documents' then 'supporting'
  when 'additional_documents' then 'additional'
  else category
end
where category is null;

alter table public.documents drop constraint if exists documents_category_check;
alter table public.documents add constraint documents_category_check
  check (category in ('identity', 'financial', 'application_form', 'supporting', 'additional'));
alter table public.documents alter column category set not null;

-- 2. Drop the old unique(client_id, document_type) constraint so a client
--    can have multiple rows of the same document_type. The constraint was
--    declared inline (unnamed) in portal-schema.sql, so Postgres picked an
--    implicit name — look it up by column pair instead of guessing it, so
--    this migration doesn't silently no-op if the name differs.
do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'documents'
    and c.contype = 'u'
    and c.conkey = (
      select array_agg(a.attnum order by a.attnum)
      from pg_attribute a
      where a.attrelid = t.oid and a.attname in ('client_id', 'document_type')
    );

  if conname is not null then
    execute format('alter table public.documents drop constraint %I', conname);
  end if;
end $$;

-- 3. documents never had a DELETE policy (the old "Remove" flow nulled
--    fields via UPDATE instead of deleting the row). The redesigned page
--    deletes rows outright, so add one — clients may delete their own
--    documents only while not yet verified; staff may always manage any
--    document regardless of status.
drop policy if exists "documents_delete" on public.documents;
create policy "documents_delete"
  on public.documents for delete
  using ((auth.uid() = client_id and status <> 'verified') or public.is_staff());

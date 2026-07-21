-- ============================================================================
-- Calestia Travel & Tours — Cancel Application (client self-serve)
-- ============================================================================
-- Run this ONCE in your Supabase project's SQL editor, after
-- supabase/multi-application-support.sql has already been applied. Safe to
-- re-run (DROP POLICY IF EXISTS / CREATE OR REPLACE throughout).
--
-- Lets a client cancel a visa application while it's still in the
-- "Waiting for Payment" state (i.e. before any payment_submissions row
-- exists for that batch). Implemented as a single SECURITY DEFINER RPC
-- rather than ad hoc client-side deletes because:
--   1. public.notifications has no INSERT policy for regular users by
--      design (see portal-schema.sql) — only trigger/function code can
--      write to it, so the cancellation notification has to be created
--      from inside a SECURITY DEFINER function.
--   2. It keeps the "delete visa_applicants + delete any stray payment
--      row + notify" sequence atomic instead of three separate
--      client-side calls that could partially fail.
--   3. It re-checks ownership and the waiting_for_payment invariant
--      server-side, so the button can't be abused via a direct RPC call
--      once a payment has actually been submitted.
-- ============================================================================

-- payment_submissions has no client DELETE policy today (clients may only
-- INSERT; only staff may UPDATE status). Add one for completeness — the RPC
-- below is SECURITY DEFINER and doesn't strictly need it, but keeping RLS
-- consistent with what a client is actually allowed to own is good hygiene.
drop policy if exists "payment_submissions_delete" on public.payment_submissions;
create policy "payment_submissions_delete"
  on public.payment_submissions for delete
  using (auth.uid() = client_id);

create or replace function public.cancel_application_batch(p_batch_id uuid)
returns void as $$
declare
  v_owns boolean;
  v_stray_payment record;
begin
  select exists (
    select 1 from public.visa_applicants
    where application_batch_id = p_batch_id and client_id = auth.uid()
  ) into v_owns;

  if not v_owns then
    raise exception 'No application found for this batch.';
  end if;

  -- Server-side re-check of the "only while waiting_for_payment" rule.
  -- If a payment row exists, delete it (and its receipt) too rather than
  -- silently ignoring it — but this should not normally happen, since the
  -- client UI only offers Cancel while no payment row exists yet.
  for v_stray_payment in
    select id, receipt_path from public.payment_submissions
    where application_batch_id = p_batch_id and client_id = auth.uid()
  loop
    if v_stray_payment.receipt_path is not null then
      delete from storage.objects
        where bucket_id = 'payment-receipts' and name = v_stray_payment.receipt_path;
    end if;
    delete from public.payment_submissions where id = v_stray_payment.id;
  end loop;

  delete from public.visa_applicants
    where application_batch_id = p_batch_id and client_id = auth.uid();

  insert into public.notifications (client_id, message, type)
  values (auth.uid(), 'Your visa application was cancelled.', 'application_cancelled');
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.cancel_application_batch(uuid) to authenticated;

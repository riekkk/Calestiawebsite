-- Calestia Travel & Tours — Reviews feature schema
-- Run this once in your Supabase project's SQL editor (Dashboard → SQL Editor → New query).
-- This is required for the homepage Testimonials/Reviews section to work —
-- the site only has the public anon key, which cannot create tables itself.

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  service text not null,
  rating smallint not null check (rating between 1 and 5),
  review_text text not null,
  photo_url text,
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

-- Anyone (including signed-out visitors) can read reviews.
create policy "Reviews are publicly readable"
  on public.reviews for select
  using (true);

-- Only signed-in users can submit a review, and only as themselves.
create policy "Authenticated users can insert their own review"
  on public.reviews for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Optional: let users edit/delete their own review later.
create policy "Users can update their own review"
  on public.reviews for update
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can delete their own review"
  on public.reviews for delete
  to authenticated
  using (auth.uid() = user_id);

-- Optional: storage bucket for the "Optional Photo Upload" field on the
-- review form. Skip this if you don't want photo uploads — the review
-- form still works without it (it just submits without a photo).
insert into storage.buckets (id, name, public)
values ('review-photos', 'review-photos', true)
on conflict (id) do nothing;

create policy "Review photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'review-photos');

create policy "Authenticated users can upload review photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'review-photos');

-- ===================================================================
-- Fresh Market — Supabase Storage (zdjęcia, logo, certyfikaty)
-- Wykonaj PO 002_rls_policies.sql
-- ===================================================================

-- ===================================================================
-- BUCKETS
-- ===================================================================
-- offer-photos: zdjęcia ofert (publiczne — widoczne w mailach do kupców)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'offer-photos', 'offer-photos', true, 5242880,  -- 5 MB max
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- company-logos: loga firm (publiczne)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos', 'company-logos', true, 2097152,  -- 2 MB max
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
) on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- certs: certyfikaty (NIE-publiczne — tylko zalogowani widzą)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certs', 'certs', false, 10485760,  -- 10 MB max
  array['application/pdf', 'image/jpeg', 'image/png']
) on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ===================================================================
-- POLITYKI STORAGE
-- ===================================================================
-- Konwencja ścieżek:
--   offer-photos/<company_id>/<offer_id>/<filename>
--   company-logos/<company_id>/<filename>
--   certs/<company_id>/<filename>
-- Pierwszy segment ścieżki = company_id, dzięki czemu polityka może
-- sprawdzić, czy zalogowany supplier może modyfikować plik.

-- ── OFFER-PHOTOS ──────────────────────────────────────────────
-- Read: bucket public — wszyscy widzą (dla maili)
create policy "offer_photos_read_public" on storage.objects
  for select using (bucket_id = 'offer-photos');

-- Insert/update/delete: tylko właściciel firmy (pierwszy segment ścieżki = company_id)
create policy "offer_photos_insert_supplier" on storage.objects
  for insert with check (
    bucket_id = 'offer-photos'
    and (
      is_admin()
      or (storage.foldername(name))[1] = app_company_id()::text
    )
  );

create policy "offer_photos_update_supplier" on storage.objects
  for update using (
    bucket_id = 'offer-photos'
    and (
      is_admin()
      or (storage.foldername(name))[1] = app_company_id()::text
    )
  );

create policy "offer_photos_delete_supplier" on storage.objects
  for delete using (
    bucket_id = 'offer-photos'
    and (
      is_admin()
      or (storage.foldername(name))[1] = app_company_id()::text
    )
  );

-- ── COMPANY-LOGOS ─────────────────────────────────────────────
create policy "company_logos_read_public" on storage.objects
  for select using (bucket_id = 'company-logos');

create policy "company_logos_modify_supplier" on storage.objects
  for all using (
    bucket_id = 'company-logos'
    and (
      is_admin()
      or (storage.foldername(name))[1] = app_company_id()::text
    )
  )
  with check (
    bucket_id = 'company-logos'
    and (
      is_admin()
      or (storage.foldername(name))[1] = app_company_id()::text
    )
  );

-- ── CERTS (prywatne) ──────────────────────────────────────────
-- Read: tylko admin lub właściciel firmy
create policy "certs_read_owner_or_admin" on storage.objects
  for select using (
    bucket_id = 'certs'
    and (
      is_admin()
      or (storage.foldername(name))[1] = app_company_id()::text
    )
  );

create policy "certs_modify_owner_or_admin" on storage.objects
  for all using (
    bucket_id = 'certs'
    and (
      is_admin()
      or (storage.foldername(name))[1] = app_company_id()::text
    )
  )
  with check (
    bucket_id = 'certs'
    and (
      is_admin()
      or (storage.foldername(name))[1] = app_company_id()::text
    )
  );

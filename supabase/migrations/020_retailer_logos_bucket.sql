-- ============================================================================
-- 020 — retailer-logos storage bucket + RLS
-- [B2B Round 5.7]
--
-- Cel:
--   Logo sieci handlowych do tej pory leciało do bucketu `company-logos`
--   z `pathPrefix=retailer-{r.id}` (np. "retailer-100/..."). To powodowało:
--     1. mieszanie plików firm i sieci w jednym buckecie,
--     2. RLS dla company-logos sprawdza pierwszy segment = app_company_id()
--        (UUID firmy supplera) — string "retailer-100" nigdy nie matchował,
--        więc tylko admin (is_admin() bypass) mógł uploadować logo sieci,
--     3. brak konwencji ścieżki: każdy retailer w prefiksie tekstowym,
--        a nie w czystym numerycznym ID.
--
--   Po tej migracji: osobny bucket `retailer-logos` z RLS pozwalającym
--   adminowi pisać, wszystkim zalogowanym czytać (logo sieci jest
--   publicznie widoczne dla suppliers/buyers — to dane biznesowe).
--
-- Konwencja ścieżki: retailer-logos/<retailer_id>/<timestamp>-<name>.<ext>
--   - pierwszy segment = retailer.id (numeric, np. "100" dla Biedronki)
--   - jeden retailer -> jeden folder, brak kolizji
--   - admin uploaduje, supplier i buyer tylko czytają
--
-- Idempotentne: ON CONFLICT DO UPDATE + DROP POLICY IF EXISTS.
-- ============================================================================

begin;

-- ── Bucket ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'retailer-logos', 'retailer-logos', true, 2097152,  -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Read: publiczny (logo sieci jest pokazywane wszędzie — supplier/buyer/admin/unauthenticated potencjalnie)
drop policy if exists "retailer_logos_read_public" on storage.objects;
create policy "retailer_logos_read_public" on storage.objects
  for select using (bucket_id = 'retailer-logos');

-- Write: tylko admin. Suppliers/buyers nie modyfikują logo sieci.
drop policy if exists "retailer_logos_modify_admin" on storage.objects;
create policy "retailer_logos_modify_admin" on storage.objects
  for all using (
    bucket_id = 'retailer-logos' and is_admin()
  ) with check (
    bucket_id = 'retailer-logos' and is_admin()
  );

commit;

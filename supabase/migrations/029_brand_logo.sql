-- ============================================================================
-- 029 — Brand logo (Fresh Market) upload + storage
-- [B2B Round prod-rollout / branding]
--
-- Cel:
--   Admin może podmienić zielone-jabłko-SVG / placeholder "FM" na realne
--   logo Fresh Market (PNG/SVG). Logo używane w:
--     - sidebarze panelu (PreconnectFM)
--     - nagłówku panelu admina (PanelTopBar)
--     - stronach logowania / rejestracji / zakup-ok
--     - FloatingChat header
--
--   1 plik logo per cała aplikacja (nie per-firma — to inna sprawa,
--   companies.logo_url już jest). To brand FRESH MARKET, nie suppliera.
--
-- Co dodajemy:
--   1. Kolumna brand_logo_url w fm_settings (singleton row już istnieje).
--   2. Storage bucket "brand-assets" — public read, tylko admin może upload.
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, ON CONFLICT.
-- ============================================================================

begin;

-- ── 1. fm_settings — kolumna na URL logo ────────────────────────────────
alter table fm_settings
  add column if not exists brand_logo_url text;

-- ── 2. Storage bucket — brand-assets ────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-assets',
  'brand-assets',
  true,                           -- publiczny read (logo musi być widoczne na /login)
  1048576,                         -- 1 MB limit (logo nie powinno być wielkie)
  array['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── 3. RLS policy — public read ─────────────────────────────────────────
-- Każdy (włącznie z niezalogowanym na /login) może odczytać logo.
drop policy if exists "brand_assets_public_read" on storage.objects;
create policy "brand_assets_public_read"
  on storage.objects for select
  using (bucket_id = 'brand-assets');

-- ── 4. RLS policy — admin write (upload/update/delete) ─────────────────
drop policy if exists "brand_assets_admin_insert" on storage.objects;
create policy "brand_assets_admin_insert"
  on storage.objects for insert
  with check (bucket_id = 'brand-assets' and is_admin());

drop policy if exists "brand_assets_admin_update" on storage.objects;
create policy "brand_assets_admin_update"
  on storage.objects for update
  using (bucket_id = 'brand-assets' and is_admin())
  with check (bucket_id = 'brand-assets' and is_admin());

drop policy if exists "brand_assets_admin_delete" on storage.objects;
create policy "brand_assets_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'brand-assets' and is_admin());

-- ── 5. RLS na fm_settings (jeśli jeszcze nie ma) — admin write ─────────
-- fm_settings zwykle ma RLS, ale dodajmy policy dla brand_logo_url update
-- gdyby nie była.
alter table fm_settings enable row level security;

drop policy if exists "fm_settings_public_read" on fm_settings;
create policy "fm_settings_public_read"
  on fm_settings for select
  using (true);  -- każdy może czytać (brand_logo_url musi być dostępny przed loginem)

drop policy if exists "fm_settings_admin_write" on fm_settings;
create policy "fm_settings_admin_write"
  on fm_settings for all
  using (is_admin())
  with check (is_admin());

commit;

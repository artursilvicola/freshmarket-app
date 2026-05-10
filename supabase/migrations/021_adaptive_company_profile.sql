-- ============================================================================
-- 021 — adaptive company profile (description_short + profile_data + materials)
-- [B2B Round adaptive-company-profile-ai]
--
-- Cel:
--   Profil firmy ma się skalować z ilością danych. Mała firma zostaje przy
--   krótkim opisie; większa firma podaje strukturę (zaplecze, rynki eksportu,
--   typ współpracy, materiały) — i AI buduje bogatszy profil.
--
--   Nie chcemy 15 nowych kolumn — większość rozszerzeń idzie w jeden JSONB
--   `profile_data`. Top-level dostają tylko 3 pola, bo są często czytane
--   i indeksowalne:
--     - description_short  -> 2-3 zdania, do podglądu w karcie/dashboardzie
--     - description        -> już istnieje, 4-6 zdań, główny opis
--     - ai_review_status   -> stan moderacji opisu przez admina
--                             ('pending' | 'approved' | 'edited' | 'rejected')
--
-- Konwencja `profile_data`:
--   {
--     "basics":      { "founded_year": int, "employees": "1-10|11-50|..." },
--     "offer":       { "products_year_round": str, "products_seasonal": str,
--                      "private_label": bool, "customer_types": [str] },
--     "trade":       { "export_countries": [str ISO2], "main_markets": str,
--                      "partnership_types": [str], "typical_volumes": str },
--     "operations":  { "capabilities": [str] },
--     "materials":   [ { "url": str, "name": str, "type": "pdf"|"image" } ],
--     "supplier_pitch": str
--   }
--   Każda sekcja jest opcjonalna. UI hide'uje sekcje puste; AI też pomija
--   puste w prompcie.
--
-- Bucket `company-materials`:
--   PDF-y / katalogi / prezentacje / zdjęcia zakładu — supplier wgrywa do
--   własnego folderu, bucket public read (kupiec pobiera bez auth), max 10 MB.
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO UPDATE.
-- ============================================================================

begin;

-- ── Companies — nowe kolumny ────────────────────────────────────────────
alter table companies
  add column if not exists description_short text;

alter table companies
  add column if not exists profile_data jsonb default '{}'::jsonb;

alter table companies
  add column if not exists ai_review_status text default 'pending'
    check (ai_review_status in ('pending', 'approved', 'edited', 'rejected'));

-- Backfill: istniejące rekordy dostają domyślny status pending
update companies
  set ai_review_status = 'pending'
  where ai_review_status is null;

-- GIN index na profile_data — pozwala szybko filtrować po np. capabilities
-- (admin może chcieć "wszystkie firmy z chłodnią"). Tani na zapis, drogi
-- na storage, ale companies to mała tabela (<1000 rekordów).
create index if not exists idx_companies_profile_data on companies using gin (profile_data);

-- ── Storage bucket — company-materials ──────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-materials',
  'company-materials',
  true,                                    -- public read (kupiec pobiera bez auth)
  10485760,                                -- 10 MB (PDF katalogu mieści się w spokoju)
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── RLS dla company-materials ───────────────────────────────────────────
-- Read: publiczny (kupiec pobiera PDF/zdjęcie bez auth).
drop policy if exists "company_materials_read_public" on storage.objects;
create policy "company_materials_read_public" on storage.objects
  for select using (bucket_id = 'company-materials');

-- Write: supplier do własnego folderu (pierwszy segment = jego company_id)
-- LUB admin globalnie. Konwencja: company-materials/<companies.id>/<filename>
drop policy if exists "company_materials_modify_owner_or_admin" on storage.objects;
create policy "company_materials_modify_owner_or_admin" on storage.objects
  for all using (
    bucket_id = 'company-materials' and (
      is_admin() or
      (split_part(name, '/', 1))::uuid = app_company_id()
    )
  ) with check (
    bucket_id = 'company-materials' and (
      is_admin() or
      (split_part(name, '/', 1))::uuid = app_company_id()
    )
  );

commit;

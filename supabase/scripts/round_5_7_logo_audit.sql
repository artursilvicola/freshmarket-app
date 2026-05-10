-- ============================================================================
-- Round 5.7 — audyt istniejących logo_url po stronie companies / retailers
-- ============================================================================
--
-- Po wdrożeniu commit Round 5.7:
--   - upload nowego logo firmy idzie do `company-logos/<company.id>/...`
--   - upload nowego logo sieci idzie do `retailer-logos/<retailer.id>/...`
--   - usunięty fallback "tmp" w 3 miejscach (company logo, retailer logo,
--     offer photo) — niepoprawnie skonfigurowany komponent pokaże błąd
--     zamiast cicho wgrywać do współdzielonego folderu
--
-- Ten audyt pokazuje istniejące rekordy które wymagają uwagi:
--   1. companies.logo_url z "tmp/" w ścieżce (jeśli takie powstały)
--   2. retailers.logo_url leżące w starym buckecie company-logos/retailer-XXX/
--   3. wszystkie publicznie dostępne URL-e (działają dalej, ale nowe
--      uploady idą do nowej, czystej konwencji)
--
-- Skrypt jest READ-ONLY. Nie zmienia plików w storage. Plik w storage
-- pozostaje po starym URL-u nawet gdy logo_url w tabeli zostanie wymienione.
-- ============================================================================


-- ── A. Companies — wszystkie logo_url ───────────────────────────────────
-- "Healthy" wzór: .../storage/v1/object/public/company-logos/<UUID>/...
-- "Suspicious" wzór: zawiera "/tmp/" lub brak UUID po company-logos/
SELECT
  id,
  name,
  legacy_supplier_id,
  logo_url,
  CASE
    WHEN logo_url IS NULL THEN 'no_logo'
    WHEN logo_url LIKE '%/company-logos/tmp/%' THEN 'BAD_tmp_folder'
    WHEN logo_url LIKE '%/company-logos/' || id::text || '/%' THEN 'ok_correct_path'
    WHEN logo_url LIKE '%/company-logos/%' THEN 'check_other_segment'
    ELSE 'external_or_other'
  END AS path_status
FROM companies
ORDER BY path_status, name;


-- ── B. Retailers — wszystkie logo_url ───────────────────────────────────
-- Stary wzór: .../company-logos/retailer-100/... (przed Round 5.7)
-- Nowy wzór: .../retailer-logos/100/... (po Round 5.7)
SELECT
  id,
  name,
  logo_url,
  CASE
    WHEN logo_url IS NULL THEN 'no_logo'
    WHEN logo_url LIKE '%/retailer-logos/' || id::text || '/%' THEN 'ok_new_bucket'
    WHEN logo_url LIKE '%/company-logos/retailer-' || id::text || '/%' THEN 'legacy_in_company_bucket'
    WHEN logo_url LIKE '%/company-logos/%' THEN 'check_company_bucket_other'
    ELSE 'external_or_other'
  END AS path_status
FROM retailers
ORDER BY path_status, name;


-- ── C. Agregat — ile rekordów w każdej kategorii ────────────────────────
SELECT 'companies' AS table_name, path_status, COUNT(*) AS rows
FROM (
  SELECT
    CASE
      WHEN logo_url IS NULL THEN 'no_logo'
      WHEN logo_url LIKE '%/company-logos/tmp/%' THEN 'BAD_tmp_folder'
      WHEN logo_url LIKE '%/company-logos/' || id::text || '/%' THEN 'ok_correct_path'
      WHEN logo_url LIKE '%/company-logos/%' THEN 'check_other_segment'
      ELSE 'external_or_other'
    END AS path_status
  FROM companies
) c
GROUP BY path_status
UNION ALL
SELECT 'retailers' AS table_name, path_status, COUNT(*) AS rows
FROM (
  SELECT
    CASE
      WHEN logo_url IS NULL THEN 'no_logo'
      WHEN logo_url LIKE '%/retailer-logos/' || id::text || '/%' THEN 'ok_new_bucket'
      WHEN logo_url LIKE '%/company-logos/retailer-' || id::text || '/%' THEN 'legacy_in_company_bucket'
      WHEN logo_url LIKE '%/company-logos/%' THEN 'check_company_bucket_other'
      ELSE 'external_or_other'
    END AS path_status
  FROM retailers
) r
GROUP BY path_status
ORDER BY table_name, path_status;


-- ============================================================================
-- INTERPRETACJA WYNIKÓW
-- ============================================================================
--
-- COMPANIES.path_status:
--   ok_correct_path        — logo w companies-logos/<UUID>/, prawidłowo
--   BAD_tmp_folder         — historia pre-Round-5.7, musi być re-uploadowane
--                            przez admina/owner'a firmy (link działa, ale ten
--                            sam folder mógł być nadpisany przez inny rekord)
--   check_other_segment    — pierwszy segment to nie companies.id ani "tmp" —
--                            zbadaj manualnie (możliwe że stary admin upload
--                            albo migracja danych)
--   external_or_other      — URL spoza company-logos (np. zewnętrzny CDN);
--                            zostawić bez zmian
--   no_logo                — brak loga; nic nie naprawiamy
--
-- RETAILERS.path_status:
--   ok_new_bucket             — nowy upload w retailer-logos/<id>/, super
--   legacy_in_company_bucket  — pre-Round-5.7 upload w company-logos/retailer-X/
--                               URL wciąż działa (bucket public read), ale nowy
--                               upload idzie do retailer-logos. Można zostawić
--                               do naturalnej wymiany przez admina (nadpisze
--                               przy pierwszej edycji), albo zlecić ręczny
--                               re-upload jeśli zależy na pełnej higienie
--   check_company_bucket_other — anomalia, zbadaj
--   external_or_other         — URL zewnętrzny, zostaw
--   no_logo                   — brak; nic nie robimy
--
-- ============================================================================
-- BEZPIECZNA NAPRAWA (opcjonalna, wymaga ręcznej weryfikacji)
-- ============================================================================
--
-- 1) Dla companies w stanie BAD_tmp_folder:
--    - skontaktuj się z właścicielem firmy żeby ponownie wgrał logo,
--    - albo admin wchodzi w panel firmy i klika nowy upload — nowa ścieżka
--      będzie zgodna z konwencją.
--
-- 2) Dla retailers w stanie legacy_in_company_bucket:
--    - admin wchodzi w panel sieci → "Kliknij aby zmienić logo sieci" →
--      nowy plik trafia do retailer-logos/<id>/. Stary URL można zostawić
--      jako artefakt historyczny w company-logos lub osobno usunąć przez
--      Supabase Storage UI.
--
-- 3) NIE rób automatycznej migracji plików między bucketami — Supabase
--    Storage nie ma atomic move, a publiczny URL musi być spójny z
--    rekordem w tabeli. Lepiej naturalna wymiana przy edycji.
--
-- ============================================================================

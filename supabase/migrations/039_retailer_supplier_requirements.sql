-- ===================================================================
-- 039 - retailer-supplier-requirements
-- Cel:
--   - dodac pole "uwagi dla dostawcy / wymagania sieci" widoczne DLA DOSTAWCY
--     przed wyslaniem oferty do danej sieci (osobne od wewnetrznej notatki
--     admina `description`, ktora pozostaje admin-only).
--   - dostawca potwierdza zapoznanie sie z uwagami; potwierdzenie zapisywane
--     jest w legacy_sends.data (JSONB) — bez zmiany schematu legacy_sends.
--
-- UWAGA OPERACYJNA: migracje Supabase NIE jada automatycznie z gita. Po deployu
-- frontu nalezy recznie zaaplikowac ten plik w Supabase (SQL editor), inaczej
-- kolumna nie istnieje i zapis uwag bedzie cicho ignorowany przez upsert.
-- ===================================================================

begin;

alter table public.retailers
  add column if not exists supplier_requirements text;

comment on column public.retailers.supplier_requirements is
  'Uwagi / wymagania sieci handlowej WIDOCZNE DLA DOSTAWCY przed wyslaniem oferty (np. brak importu z zagranicy, preferowane kategorie, ograniczenia wolumenu). Rozne od `description`, ktora jest wewnetrzna notatka admina.';

commit;

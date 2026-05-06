-- ===================================================================
-- 012 — Rozdzielenie dwóch identyfikatorów supplier-a:
--   companies.legacy_supplier_id  → PreConnect offers/sends (np. 'sup-s1')
--   companies.legacy_fm_id        → FM 2026 matching      (np. 's1')
--
-- [B2B Round 2.5]
--
-- Dlaczego:
--   legacy_sends.supplier_legacy_id ma format 'sup-s1' / 'sup-codex-silvicola'.
--   FM_SUPPLIERS w PreConnectFM uzywa 's1' / 's5' (krotsze fmId).
--   Probowanie zaspokoic oba przez jedna kolumne wprowadzilo niespojnosc:
--   RLS supplier_legacy_id = app_supplier_legacy_id() nie matchowal
--   bo "sup-s1" != "s1".
--
-- Po tej migracji:
--   - companies.legacy_supplier_id (unique) — PreConnect compatibility
--   - companies.legacy_fm_id (unique)        — FM 2026 algorithm
--   - app_supplier_legacy_id() zwraca legacy_supplier_id (NIE legacy_fm_id)
--   - RLS legacy_offers / legacy_sends matchuje sie poprawnie
--   - FM 2026 matching algorithm dalej uzywa legacy_fm_id (nic nie psuje)
--
-- Idempotent: zaprojektowane do bezpiecznego odpalania wielokrotnie.
-- ===================================================================

begin;

-- ============================================================
-- 1) Dodaj nowa kolumne companies.legacy_supplier_id
-- ============================================================
alter table public.companies
  add column if not exists legacy_supplier_id text unique;
comment on column companies.legacy_supplier_id is
  'PreConnect supplier id (np. "sup-s1"). Match z legacy_sends.supplier_legacy_id, '
  'legacy_offers.supplier_legacy_id, fm_resps.meta.supplier_legacy_id. '
  'Inne niz legacy_fm_id (FM 2026 matching id).';
create index if not exists idx_companies_legacy_supplier on companies(legacy_supplier_id);

-- ============================================================
-- 2) Zmien helper app_supplier_legacy_id() — zwraca legacy_supplier_id
-- ============================================================
create or replace function app_supplier_legacy_id() returns text as $$
  select c.legacy_supplier_id
  from companies c
  join profiles p on p.company_id = c.id
  where p.id = auth.uid()
  limit 1;
$$ language sql security definer stable;

comment on function app_supplier_legacy_id() is
  '[Round 2.5] Zwraca PreConnect legacy supplier id (np. "sup-s1") dla '
  'firmy zalogowanego usera. Uzywane w RLS legacy_offers / legacy_sends.';

-- ============================================================
-- 3) Auto-fill: jesli wczesniej ktos ustawil legacy_fm_id='sup-XX'
--    (przed Round 2.5 niektorzy mogli tak zrobic), przepisz do legacy_supplier_id
--    a w legacy_fm_id zostaw bez "sup-" prefix.
-- ============================================================
update public.companies
  set legacy_supplier_id = legacy_fm_id
  where legacy_fm_id like 'sup-%'
    and legacy_supplier_id is null;

update public.companies
  set legacy_fm_id = substring(legacy_fm_id from 5)  -- "sup-s1" -> "s1"
  where legacy_fm_id like 'sup-%';

-- ============================================================
-- 4) WSKAZOWKA RECZNA (po wgraniu wpisz w SQL Editor):
-- ============================================================
-- Sprawdz aktualne wartosci legacy_supplier_id w danych:
--   SELECT DISTINCT supplier_legacy_id FROM legacy_sends ORDER BY 1;
--   SELECT DISTINCT supplier_legacy_id FROM legacy_offers ORDER BY 1;
--
-- Przyklad mapowania (zaadaptuj do swoich danych):
--   UPDATE companies SET legacy_supplier_id='sup-s1', legacy_fm_id='s1'
--    WHERE name ILIKE '%UNICA%';
--   UPDATE companies SET legacy_supplier_id='sup-s5', legacy_fm_id='s5'
--    WHERE name ILIKE '%Profisad%';
--   UPDATE companies SET legacy_supplier_id='sup-codex-silvicola'
--    WHERE id = (SELECT company_id FROM profiles WHERE email='artur.silvicola@gmail.com');

commit;

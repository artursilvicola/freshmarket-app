-- 045_ui_content.sql
-- [feat/admin-instructions-announcements]
-- Treści sterowane z panelu admina (Branding):
--   • Instrukcje dla dostawcy i kupca (osobno, PL/EN) — link w sidebarze,
--   • Komunikaty (pasek / okno) dla dostawcy i kupca (osobno, PL/EN) — biegnący
--     pasek na górze panelu, opcjonalnie okno przy wejściu dla pilnych.
--
-- Jedna kolumna JSONB na istniejącej single-row tabeli fm_settings.
-- RLS bez zmian — dziedziczy polityki fm_settings (odczyt: public/zalogowany,
-- zapis: tylko admin — migracje 008 + 029).
--
-- Struktura ui_content:
-- {
--   "instructions": {
--     "supplier": { "pl": "<html>", "en": "<html>" },
--     "buyer":    { "pl": "<html>", "en": "<html>" }
--   },
--   "announcements": {
--     "supplier": { "pl":"", "en":"", "enabled":false, "type":"bar", "dateFrom":null, "dateTo":null },
--     "buyer":    { "pl":"", "en":"", "enabled":false, "type":"bar", "dateFrom":null, "dateTo":null }
--   }
-- }

alter table fm_settings
  add column if not exists ui_content jsonb default '{}'::jsonb;

-- 047_fm_b2b_packages.sql
-- [feat/fm-b2b-packages]
-- Liczba pakietów Business (event) wykupionych przez firmę — steruje pulą
-- spotkań B2B FM 2026: limit spotkań i sieci głównych (⭐) = 5 × pakiety.
-- Admin ustawia w panelu Firmy (selektor przy checkboxie "Spotkania B2B").
-- Default 1 = zachowanie identyczne jak dotychczas (bez zmian dla istniejących).
-- Spotkania NIE są równoległe (osoby zwykle chodzą razem) — odstęp numerków
-- w algorytmie pozostaje bez zmian.

alter table companies
  add column if not exists fm_b2b_packages integer not null default 1
  check (fm_b2b_packages between 1 and 5);

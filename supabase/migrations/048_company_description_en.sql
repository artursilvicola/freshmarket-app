-- 048_company_description_en.sql
-- [feat/company-desc-i18n]
-- Angielska wersja opisu firmy (krótki + pełny). Kupiec z interfejsem EN widzi
-- wersję EN (fallback: oryginał), kupiec PL — oryginał (fallback: EN).
-- Wypełniane: (1) generator AI tworzy od razu OBIE wersje, (2) przy
-- zatwierdzaniu ręcznie pisanego opisu admin-approve dotłumacza EN.
-- Puste kolumny = zachowanie jak dotychczas (fallback do oryginału).

alter table companies
  add column if not exists description_en text,
  add column if not exists description_short_en text;

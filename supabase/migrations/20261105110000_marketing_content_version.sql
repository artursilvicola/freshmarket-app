-- ============================================================================
-- [feat/marketing-activation] Wersja treści kampanii + trwałe zamrożenie przed tworzeniem wiadomości
-- (review Codexa 05.11, dwa P1):
--  1) content_version — rośnie przy każdym zapisie treści; zatwierdzenie podaje wersję, którą administrator
--     widział w podglądzie; inna wersja (edycja w drugiej karcie) = 409, nic nie powstaje.
--  2) frozen_content / frozen_content_version / content_frozen_at — zatwierdzenie najpierw JEDNYM warunkowym
--     UPDATE (status in (draft, approved) AND content_version = oczekiwana) zamraża treść w kampanii, a dopiero
--     potem tworzy wiadomości WYŁĄCZNIE z zamrożonej wersji. Awaria w połowie + ponowienie = te same teksty;
--     równoległa edycja albo zamknięcie = 0 wierszy = 409.
-- Addytywne. Uruchamiane TYLKO na bazie testowej do czasu decyzji o produkcji.
-- ============================================================================
begin;

alter table public.marketing_campaigns
  add column if not exists content_version        integer not null default 1,
  add column if not exists frozen_content         jsonb,
  add column if not exists frozen_content_version integer,
  add column if not exists content_frozen_at      timestamptz;

comment on column public.marketing_campaigns.content_version is
  'Wersja treści (rośnie przy update_content). approve wymaga zgodnej wersji — zmiana w innym oknie = 409.';
comment on column public.marketing_campaigns.frozen_content is
  'Treść zamrożona przy pierwszym zatwierdzeniu ({} = domyślna szablonu). Wiadomości renderują się TYLKO z niej; ponowienie po awarii użyje tej samej wersji.';

commit;

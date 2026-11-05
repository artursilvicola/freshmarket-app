-- ============================================================================
-- [feat/marketing-activation] Grupy odbiorców + edytowalna treść kampanii (Artur 5.11)
--
-- Addytywne: kampania = jedna GRUPA odbiorców (template_key rozszerzony o 5 grup; stare
-- 2 klucze zostają dla wcześniejszych kampanii testowych) + treść PL/EN edytowalna w panelu
-- bez HTML (jsonb { pl: {subject, body, cta}, en: {...} }; pusty obiekt = domyślna z kodu).
-- Pola „potrzeb kupców" (target_categories/target_keywords/needs_note) zostają w tabeli,
-- ale nie są już używane (nie znamy bieżących potrzeb kupców — dostawca przedstawia, co ma).
-- Zamrożenie treści nadal następuje w marketing_messages przy zatwierdzeniu.
-- Uruchamiana TYLKO na bazie testowej (scripts/marketing-test-env.mjs) do czasu decyzji o produkcji.
-- ============================================================================
begin;

alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_template_key_check;
alter table public.marketing_campaigns add constraint marketing_campaigns_template_key_check
  check (template_key in (
    'credits_no_proposal', 'credits_proposal_ready', 'used_before_free_credits', 'credits_expiring', 'no_valid_credits',
    'start_with_credits', 'return_active'
  ));

alter table public.marketing_campaigns
  add column if not exists content            jsonb not null default '{}'::jsonb,
  add column if not exists content_updated_at timestamptz,
  add column if not exists content_updated_by uuid references public.profiles(id) on delete set null;

comment on column public.marketing_campaigns.template_key is
  'Grupa odbiorców = szablon treści: credits_no_proposal | credits_proposal_ready | used_before_free_credits | credits_expiring | no_valid_credits (stare: start_with_credits, return_active).';
comment on column public.marketing_campaigns.content is
  'Treść edytowana w panelu bez HTML: { pl: {subject, body, cta}, en: {subject, body, cta} }. Pusty obiekt = domyślna treść szablonu z kodu. Zamrożenie treści per adresat następuje w marketing_messages przy zatwierdzeniu.';

commit;

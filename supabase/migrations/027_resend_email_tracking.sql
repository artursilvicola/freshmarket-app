-- ============================================================================
-- 027 - Resend email open tracking (legacy_sends)
-- [B2B Round prod-rollout / email-open-tracking]
--
-- Cel:
--   Wiedzieć kiedy kupiec OTWIERA mail z propozycją od dostawcy, bez wymogu
--   że kliknie link i wejdzie do aplikacji. Dziś markSendOpened() działa tylko
--   gdy buyer wchodzi w PageBuyerDetail — przegapiamy wszystkich, którzy
--   przeczytali w skrzynce ale nie kliknęli.
--
--   Po dodaniu webhook'a Resend:
--     1. send-retailer-batch zapisuje resend_message_id po wysłaniu maila
--     2. Resend wykrywa otwarcie (jego pixel), woła nasz webhook
--     3. resend-webhook function: find legacy_sends po resend_message_id,
--        jeśli status='sent' → bump do 'opened' (lub 'read' jeśli już opened)
--        + set email_opened_at.
--
--   Supplier widzi to natychmiast w "Wysyłki → Historia" jako "Odczytana"
--   (status_map ma już ten state — używamy istniejącej etykiety).
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS.
-- ============================================================================

begin;

alter table legacy_sends
  add column if not exists resend_message_id text;

alter table legacy_sends
  add column if not exists email_opened_at timestamptz;

-- Jeden mail zbiorczy zawiera wiele ofert, więc kilka legacy_sends może mieć
-- ten sam resend_message_id. To musi być zwykły indeks, nie UNIQUE.
drop index if exists ux_legacy_sends_resend_message_id;
create index if not exists idx_legacy_sends_resend_message_id
  on legacy_sends(resend_message_id) where resend_message_id is not null;

-- Indeks na email_opened_at — do dashboardów statystyk admina (kto otwiera, kto nie)
create index if not exists idx_legacy_sends_email_opened
  on legacy_sends(email_opened_at) where email_opened_at is not null;

commit;

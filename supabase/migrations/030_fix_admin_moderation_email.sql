-- ============================================================================
-- 030 — Fix admin moderation email: pokaż nazwę firmy + tytuł oferty zamiast UUID
-- [B2B Round prod-rollout / admin-notifications]
--
-- Problem zgłoszony przez Oksanę (admin) po teście produkcyjnym:
--   "Dostawca a6365067-785f-4009-a5b7-6e6b24133648 wysłał propozycje
--    'Oferta #1779460712013137' do sieci Biedronka."
--
-- Bug: stary trigger fm_notify_send_email wysyłał do Edge Function `send-email`
--   surowy record z legacy_sends (z UUID supplier_legacy_id i numeric
--   offer_legacy_id). Edge Function wstawiała te wartości bezpośrednio do
--   treści maila, bez joinu do companies (nazwa firmy) i legacy_offers (tytuł).
--
-- Fix: trigger sam buduje gotowy HTML z JOINami do:
--   - companies (nazwa firmy z legacy_supplier_id / legacy_fm_id / id)
--   - legacy_offers (tytuł oferty z data->>'title' z fallbackami)
--   - retailers (nazwa sieci po retailer_id)
--   - profiles (mail admina z role='admin')
--
-- Wysyłka przez istniejący template 'custom' w Edge Function — zero zmian
-- po stronie deployed Edge Function. Można cofnąć przez ponowne CREATE OR
-- REPLACE oryginalnej wersji.
--
-- Po wdrożeniu mail wygląda:
--   "Dostawca KJOW Sp. z o.o. wysłał propozycję 'Marchew mini' do sieci Biedronka."
--
-- Idempotentne: CREATE OR REPLACE FUNCTION.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fm_notify_send_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_supplier_name text;
  v_offer_title   text;
  v_retailer_name text;
  v_admin_email   text;
  v_subject       text;
  v_html          text;
  v_payload       jsonb;
BEGIN
  -- Reaguj tylko na INSERT nowej wysyłki w statusie pending_moderation.
  -- Inne operacje (UPDATE statusu, DELETE) na razie pomijamy.
  IF NOT (TG_OP = 'INSERT' AND NEW.status = 'pending_moderation') THEN
    RETURN NEW;
  END IF;

  -- ── 1. Nazwa firmy dostawcy ───────────────────────────────────────────
  -- 3 możliwe mapowania w companies (legacy_supplier_id / legacy_fm_id / id).
  -- Po reseed'ach historycznie różne kolumny były używane jako klucz.
  SELECT name INTO v_supplier_name
  FROM companies
  WHERE legacy_supplier_id = NEW.supplier_legacy_id
     OR legacy_fm_id       = NEW.supplier_legacy_id
     OR id::text           = NEW.supplier_legacy_id
  LIMIT 1;

  IF v_supplier_name IS NULL OR v_supplier_name = '' THEN
    v_supplier_name := '(dostawca bez nazwy: '
      || COALESCE(NEW.supplier_legacy_id, 'brak ID') || ')';
  END IF;

  -- ── 2. Tytuł oferty ──────────────────────────────────────────────────
  -- W legacy_offers.data (JSONB) tytuł siedzi pod 'title', z fallbackami
  -- na 'product' i 'internalTitle'.
  SELECT COALESCE(
    data->>'title',
    data->>'product',
    data->>'internalTitle',
    'Oferta #' || legacy_id::text
  ) INTO v_offer_title
  FROM legacy_offers
  WHERE legacy_id = NEW.offer_legacy_id
  LIMIT 1;

  IF v_offer_title IS NULL OR v_offer_title = '' THEN
    v_offer_title := 'Oferta #' || COALESCE(NEW.offer_legacy_id::text, '?');
  END IF;

  -- ── 3. Nazwa sieci handlowej ─────────────────────────────────────────
  SELECT name INTO v_retailer_name
  FROM retailers
  WHERE id = NEW.retailer_id
  LIMIT 1;

  IF v_retailer_name IS NULL OR v_retailer_name = '' THEN
    v_retailer_name := 'Sieć #' || COALESCE(NEW.retailer_id::text, '?');
  END IF;

  -- ── 4. Mail admina ───────────────────────────────────────────────────
  -- Bierzemy pierwszego usera z role='admin' (zwykle artur@kjow.pl).
  -- Fallback hardcoded gdyby tabela profiles była pusta / role nie ustawione.
  SELECT email INTO v_admin_email
  FROM profiles
  WHERE role = 'admin'
  ORDER BY created_at
  LIMIT 1;

  IF v_admin_email IS NULL THEN
    v_admin_email := 'artur.stasiak@freshmarket.eu';
  END IF;

  -- ── 5. Treść maila (HTML inline, używamy template 'custom' Edge Function) ──
  v_subject := 'Nowa propozycja do moderacji — ' || v_supplier_name
    || ' → ' || v_retailer_name;

  v_html :=
       '<h2 style="color:#1a5d3a;margin:0 0 16px;">Nowa propozycja czeka na moderację</h2>'
    || '<p>Dostawca <strong>' || replace(v_supplier_name, '<', '&lt;')
    || '</strong> wysłał propozycję <strong>„'
    || replace(v_offer_title, '<', '&lt;')
    || '"</strong> do sieci <strong>'
    || replace(v_retailer_name, '<', '&lt;')
    || '</strong>.</p>'
    || '<p style="margin:24px 0;">'
    || '<a href="https://b2b.freshmarket.eu/admin" '
    || 'style="background:#1a5d3a;color:white;padding:12px 24px;'
    || 'text-decoration:none;border-radius:6px;display:inline-block;'
    || 'font-weight:600;">Przejdź do moderacji</a></p>'
    || '<p style="color:#666;font-size:12px;margin-top:24px;">'
    || 'Identyfikator wysyłki: ' || NEW.id::text || '</p>';

  -- ── 6. Wysyłka przez Edge Function `send-email` z template 'custom' ──
  -- Edge Function ma istniejący tplCustom który akceptuje {subject, html}.
  -- Używamy URL bez ?event=1 (manual API call zamiast DB trigger event)
  -- żeby Edge Function nie szła swoją wbudowaną ścieżką renderowania.
  v_payload := jsonb_build_object(
    'to',       v_admin_email,
    'template', 'custom',
    'data',     jsonb_build_object(
      'subject', v_subject,
      'html',    v_html
    )
  );

  PERFORM net.http_post(
    url := 'https://sklyfuvzjikkqerxtulo.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrbHlmdXZ6amlra3Flcnh0dWxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjQ5OTAsImV4cCI6MjA5MzA0MDk5MH0.W3LMPFO5Hsvo41hdYpxprP2L84NobeYduJ053mkjKk8'
    ),
    body := v_payload
  );

  RETURN NEW;
END;
$function$;

-- Komentarz funkcji dla audit trail
COMMENT ON FUNCTION public.fm_notify_send_email() IS
  'Trigger: po INSERT nowej wysyłki w pending_moderation wysyła maila do admina '
  'z nazwą firmy + tytułem oferty + nazwą sieci (JOIN companies/legacy_offers/retailers). '
  'Migracja 030 — naprawa surowych UUID w treści maila.';

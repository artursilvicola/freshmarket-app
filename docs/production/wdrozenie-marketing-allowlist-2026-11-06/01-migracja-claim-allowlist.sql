-- ============================================================================
-- [feat/marketing-activation] Filtr listy dozwolonych adresów PRZED zajęciem wiersza
-- (review Codexa 10a0c6a, P2, 06.11): dotąd funkcja wysyłki sprawdzała MARKETING_SEND_ALLOWLIST
-- dopiero po `marketing_claim_messages`, więc wiersz spoza listy dostawał attempts+1 i
-- first_claim_at — po 23 h trafiał do needs_review, choć mail nigdy nie wyszedł.
-- Teraz claim przyjmuje opcjonalną listę `p_allowed_emails text[]` (małe litery, bez spacji):
--   * null  → bez ograniczenia (dotychczasowe zachowanie, wywołania 4-argumentowe bez zmian),
--   * lista → zajmowane są TYLKO wiersze z adresem na liście; pozostałe nie są dotykane
--             (zostają pending, attempts i first_claim_at bez zmian → po zdjęciu listy idą normalnie),
--   * '{}'  → nic nie zajmuje (pusta lista to „nikt”, nie „wszyscy”).
-- Historia wierszy już zajętych/wysłanych NIE jest resetowana (okno 23 h liczy się od pierwszego
-- prawdziwego zajęcia, jak dotąd). Stara sygnatura (uuid,int,int,int) jest usuwana, bo z domyślną
-- wartością piątego parametru oba przeciążenia byłyby niejednoznaczne.
-- Addytywna dla danych; uruchamiana na bazie testowej, na prod przed publikacją kodu z 10a0c6a+.
-- ============================================================================
begin;

drop function if exists public.marketing_claim_messages(uuid, integer, integer, integer);

create or replace function public.marketing_claim_messages(
  p_campaign_id uuid,
  p_limit integer default 50,
  p_lease_seconds integer default 900,
  p_window_seconds integer default 82800,
  p_allowed_emails text[] default null
)
returns setof public.marketing_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := clock_timestamp();
  v_lease interval := make_interval(secs => greatest(coalesce(p_lease_seconds, 900), 1));
  v_win   interval := make_interval(secs => greatest(coalesce(p_window_seconds, 82800), 1));
  v_row   public.marketing_messages%rowtype;
  v_out   public.marketing_messages%rowtype;
  v_n     integer := 0;
begin
  if p_campaign_id is null then return; end if;
  for v_row in
    select m.* from public.marketing_messages m
     where m.campaign_id = p_campaign_id
       and m.is_test = false
       and (m.state = 'pending' or (m.state = 'claimed' and (m.lease_until is null or m.lease_until < v_now)))
       -- lista dozwolonych adresów (próba): wiersze spoza listy nie są ani zajmowane, ani zmieniane
       and (p_allowed_emails is null or lower(btrim(m.to_email)) = any(p_allowed_emails))
     order by m.created_at
     for update skip locked
  loop
    exit when v_n >= greatest(coalesce(p_limit, 50), 1);
    if v_row.consent_source is null or btrim(v_row.consent_source) = '' then
      update public.marketing_messages set state = 'blocked_no_consent', last_error = 'consent_source_missing' where id = v_row.id;
      continue;
    end if;
    if exists (select 1 from public.marketing_suppressions s where s.email = lower(btrim(v_row.to_email))) then
      update public.marketing_messages set state = 'suppressed', last_error = 'suppressed_before_send' where id = v_row.id;
      continue;
    end if;
    if v_row.first_claim_at is not null and v_row.first_claim_at < v_now - v_win then
      update public.marketing_messages set state = 'needs_review', last_error = 'idempotency_window_elapsed' where id = v_row.id;
      continue;
    end if;
    update public.marketing_messages
       set state = 'claimed',
           attempts = attempts + 1,
           first_claim_at = coalesce(first_claim_at, v_now),
           claimed_at = v_now,
           lease_until = v_now + v_lease
     where id = v_row.id
     returning * into v_out;
    v_n := v_n + 1;
    return next v_out;
  end loop;
  return;
end;
$$;

comment on function public.marketing_claim_messages(uuid, integer, integer, integer, text[]) is
  'Zajmuje do p_limit wierszy kampanii do wysyłki (dzierżawa p_lease_seconds; po p_window_seconds od pierwszego zajęcia → needs_review). p_allowed_emails: null = bez ograniczenia; lista (małe litery) = tylko te adresy, reszta nietknięta; {} = nic.';

revoke all on function public.marketing_claim_messages(uuid, integer, integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.marketing_claim_messages(uuid, integer, integer, integer, text[]) to service_role;

commit;

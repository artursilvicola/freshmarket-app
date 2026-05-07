-- ===================================================================
-- 013 — Send lifecycle RPCs (read receipt + 14-day expiry)
-- [PreConnect Round 5]
--
-- Cel:
--   1. Buyer otwarcie szczegolow oferty -> status legacy_sends 'sent' przechodzi
--      na 'read'. Buyer nie ma UPDATE w RLS (migracja 011), wiec robimy to
--      przez SECURITY DEFINER RPC ktora sprawdza ze caller jest wlascicielem
--      retailera dla danego send'a.
--
--   2. 14-dniowe wygasanie: legacy_sends ze statusem 'sent' starsze niz
--      14 dni przechodza w 'unread_expired'. Klient wola ten RPC raz na
--      hydracje (idempotentnie). Pierwszy zalogowany usera danego dnia
--      odswiezy stan w bazie. W produkcji docelowo pg_cron, ale na MVP
--      to wystarczy.
--
-- Idempotentne: drop function if exists na poczatku.
-- ===================================================================

begin;

drop function if exists public.mark_legacy_send_read(bigint);
create function public.mark_legacy_send_read(p_legacy_id bigint)
returns table (legacy_id bigint, status text, read_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := app_role();
  v_retailer_id bigint := app_retailer_id();
  v_send_retailer_id bigint;
  v_current_status text;
  v_now timestamptz := now();
  v_now_iso text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if v_role <> 'buyer' or v_retailer_id is null then
    raise exception 'mark_legacy_send_read: only buyer with retailer_id may call (role=%, rid=%)', v_role, v_retailer_id;
  end if;

  select s.retailer_id, s.status into v_send_retailer_id, v_current_status
    from legacy_sends s where s.legacy_id = p_legacy_id;

  if v_send_retailer_id is null then
    raise exception 'mark_legacy_send_read: send % not found', p_legacy_id;
  end if;

  if v_send_retailer_id <> v_retailer_id then
    raise exception 'mark_legacy_send_read: retailer mismatch (send=%, caller=%)', v_send_retailer_id, v_retailer_id;
  end if;

  -- Tylko 'sent' przechodzi na 'read'. Inne statusy (read, read_manual,
  -- unread_expired, refunded, ...) zostawiamy w spokoju zeby nie nadpisywac
  -- historii potwierdzen recznych ani ekspiracji.
  if v_current_status = 'sent' then
    update legacy_sends s
       set status = 'read',
           data = coalesce(s.data, '{}'::jsonb)
                  || jsonb_build_object('status', 'read', 'readAt', v_now_iso, 'readType', 'auto_buyer_open'),
           updated_at = v_now
     where s.legacy_id = p_legacy_id;
  end if;

  return query
    select s.legacy_id,
           s.status,
           (s.data->>'readAt')::timestamptz
      from legacy_sends s where s.legacy_id = p_legacy_id;
end;
$$;

revoke all on function public.mark_legacy_send_read(bigint) from public;
grant execute on function public.mark_legacy_send_read(bigint) to authenticated;

drop function if exists public.expire_legacy_sends_14d();
create function public.expire_legacy_sends_14d()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_now timestamptz := now();
  v_cutoff timestamptz := v_now - interval '14 days';
begin
  if auth.uid() is null then
    raise exception 'expire_legacy_sends_14d: must be authenticated';
  end if;

  -- Wybieramy sendy 'sent' z sentAt starszym niz 14 dni. sentAt jest tekstem
  -- w polu data->>'sentAt' (format YYYY-MM-DD lub ISO). Parsujemy bezpiecznie.
  with stale as (
    select s.legacy_id
      from legacy_sends s
     where s.status = 'sent'
       and (
         -- ISO timestamp w data.sentAt
         (s.data ? 'sentAt' and (s.data->>'sentAt')::timestamptz < v_cutoff)
         -- fallback: brak sentAt, uzyj updated_at
         or (not (s.data ? 'sentAt') and s.updated_at < v_cutoff)
       )
  )
  update legacy_sends s
     set status = 'unread_expired',
         data = coalesce(s.data, '{}'::jsonb)
                || jsonb_build_object('status', 'unread_expired', 'expiredAt', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         updated_at = v_now
   where s.legacy_id in (select legacy_id from stale);

  get diagnostics v_count = row_count;
  return v_count;
exception
  when others then
    -- Sentinel daty zle sformatowane: zwroc 0 zamiast crashowac calej hydracji.
    raise warning 'expire_legacy_sends_14d failed: %', sqlerrm;
    return 0;
end;
$$;

revoke all on function public.expire_legacy_sends_14d() from public;
grant execute on function public.expire_legacy_sends_14d() to authenticated;

commit;

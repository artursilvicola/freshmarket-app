-- ===================================================================
-- 014 — Safe-cast fix for expire_legacy_sends_14d
-- [PreConnect Round 5.1]
--
-- Diagnoza (potwierdzona w SQL editor 2026-05-07):
--   Migracja 013 funkcja expire_legacy_sends_14d() zwracala 0 mimo
--   ze test row mial sentAt 22 dni stary i powinien byc promowany
--   na 'unread_expired'. Debug SELECT na izolowanym wierszu pokazal
--   ze WHERE poprawnie matchuje (is_old_enough=true), ale RPC i tak
--   zwracal 0.
--
-- Powod: 013 zawieral `exception when others then return 0` ktore
--   polykalo blad rzucony przez cast `(data->>'sentAt')::timestamptz`
--   na INNYM wierszu w legacy_sends z malformed sentAt (np. NULL,
--   pusty string, "2026-04" bez dnia, etc.).
--
-- Fix: helper safe_to_timestamptz() ktora zwraca NULL zamiast throw
--   na zlym inpucie. Plus usuniecie silent outer exception handler
--   zeby przyszle bugi byly widoczne, a nie cicho ignorowane.
-- ===================================================================

begin;

-- ============================================================
-- 1) Helper: bezpieczny cast text -> timestamptz, zwraca NULL na bledzie
-- ============================================================
create or replace function public.safe_to_timestamptz(p_text text)
returns timestamptz
language plpgsql
immutable
strict
as $$
begin
  return p_text::timestamptz;
exception when others then
  return null;
end;
$$;

comment on function public.safe_to_timestamptz(text) is
  '[Round 5.1] Bezpieczny cast tekstu na timestamptz. Zwraca NULL gdy '
  'tekst nie jest parsowalny (zamiast throw). Uzywane w expire RPC zeby '
  'jeden zly rekord nie wywalal calego sweep''a.';

-- ============================================================
-- 2) Drop + recreate expire_legacy_sends_14d z bezpiecznym castem
-- ============================================================
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

  -- Dla kazdego sent: jesli sentAt parsuje, uzyj go; inaczej fallback
  -- na updated_at. Promuj wszystko starsze niz 14 dni.
  -- safe_to_timestamptz NIGDY nie rzuca, wiec zaden wiersz nie wywali sweep'a.
  with stale as (
    select s.legacy_id
      from legacy_sends s
     where s.status = 'sent'
       and coalesce(
             public.safe_to_timestamptz(s.data->>'sentAt'),
             s.updated_at
           ) < v_cutoff
  )
  update legacy_sends s
     set status = 'unread_expired',
         data = coalesce(s.data, '{}'::jsonb)
                || jsonb_build_object(
                     'status', 'unread_expired',
                     'expiredAt', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                   ),
         updated_at = v_now
   where s.legacy_id in (select legacy_id from stale);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- UWAGA: usunalem `exception when others then return 0` z koncowki.
-- Jesli funkcja teraz throw'nie -> klient w PreconnectFM ma try/catch
-- ktore loguje warning i kontynuuje hydracje. Wolimy widoczny blad
-- niz cichy 0.

revoke all on function public.expire_legacy_sends_14d() from public;
grant execute on function public.expire_legacy_sends_14d() to authenticated;

commit;

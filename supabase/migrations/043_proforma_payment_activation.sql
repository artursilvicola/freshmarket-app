-- ============================================================================
-- 043 — proforma: oznaczenie opłaty + aktywacja pakietu (workflow admina)
-- [feat/lany-fixes-followups / Poprawki Lany #2 — część adminowa]
--
-- Cel:
--   Admin oznacza proformę (status 'pending') jako opłaconą → aktywuje pakiet
--   kredytów. Idempotentne: ponowne kliknięcie NIE tworzy drugiego pakietu.
--
-- Mechanika:
--   - proformas.package_id — link proforma → aktywowany pakiet (audyt).
--   - RPC mark_proforma_paid(id): wymaga is_admin(); jeśli proforma już 'paid'
--     zwraca istniejący package_id; w przeciwnym razie woła purchase_package
--     z payment_ref = numer proformy (purchase_package jest idempotentne po
--     payment_ref → brak duplikatów pakietów), oznacza proformę 'paid' + link.
--
-- NIE dotyka PayU, payu_orders, payu-notify. Reużywa istniejącego, bezpiecznego
-- purchase_package (ta sama ścieżka co PayU, ale payment_ref to numer proformy).
--
-- Idempotentne: ADD COLUMN IF NOT EXISTS, OR REPLACE.
-- ============================================================================

begin;

alter table proformas
  add column if not exists package_id uuid references packages(id) on delete set null;

comment on column proformas.package_id is
  'Pakiet aktywowany po oznaczeniu proformy jako opłaconej (mark_proforma_paid). NULL = jeszcze nieopłacona.';

-- ── RPC: oznacz proformę opłaconą + aktywuj pakiet (admin) ──────────────────
create or replace function mark_proforma_paid(p_proforma_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pf proformas%rowtype;
  v_package_id uuid;
begin
  if not is_admin() then
    raise exception 'Tylko administrator moze oznaczyc proforme jako oplacona'
      using errcode = 'P0001';
  end if;

  select * into v_pf from proformas where id = p_proforma_id;
  if not found then
    raise exception 'Proforma % nie istnieje', p_proforma_id using errcode = 'P0001';
  end if;

  -- Idempotencja na poziomie proformy: już opłacona → zwróć istniejący pakiet.
  if v_pf.status = 'paid' then
    return v_pf.package_id;
  end if;

  if v_pf.status = 'cancelled' then
    raise exception 'Proforma % jest anulowana', p_proforma_id using errcode = 'P0001';
  end if;

  if v_pf.company_id is null then
    raise exception 'Proforma % nie ma przypisanej firmy', p_proforma_id using errcode = 'P0001';
  end if;

  -- Aktywacja pakietu — idempotentna po payment_ref = numer proformy.
  -- purchase_package: jeśli pakiet z tym payment_ref już istnieje, zwraca jego id.
  v_package_id := purchase_package(
    v_pf.company_id,
    v_pf.plan_id,
    v_pf.net_amount,
    v_pf.currency,
    v_pf.number
  );

  update proformas
    set status = 'paid', paid_at = now(), package_id = v_package_id
    where id = p_proforma_id;

  return v_package_id;
end;
$$;

revoke all on function mark_proforma_paid(uuid) from public;
grant execute on function mark_proforma_paid(uuid) to authenticated;

commit;

-- 038 - Buyer saved submissions for current PreConnect legacy_sends.
--
-- buyer_starred.send_id points at the old sends(id) table. The live
-- PreConnect flow uses legacy_sends.legacy_id, so buyer saved items need a
-- nullable legacy_send_id while keeping the old column for compatibility.

alter table public.buyer_starred
  drop constraint if exists buyer_starred_pkey;

alter table public.buyer_starred
  alter column send_id drop not null;

alter table public.buyer_starred
  add column if not exists legacy_send_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_buyer_starred_legacy_send'
      and conrelid = 'public.buyer_starred'::regclass
  ) then
    alter table public.buyer_starred
      add constraint fk_buyer_starred_legacy_send
      foreign key (legacy_send_id)
      references public.legacy_sends(legacy_id)
      on delete cascade;
  end if;
end $$;

create unique index if not exists ux_buyer_starred_buyer_send
  on public.buyer_starred (buyer_user_id, send_id)
  where send_id is not null;

create unique index if not exists ux_buyer_starred_buyer_legacy_send
  on public.buyer_starred (buyer_user_id, legacy_send_id)
  where legacy_send_id is not null;

create index if not exists idx_buyer_starred_legacy_send_id
  on public.buyer_starred (legacy_send_id)
  where legacy_send_id is not null;

comment on column public.buyer_starred.legacy_send_id is
  'Current PreConnect legacy_sends.legacy_id saved by buyer. send_id is kept for old sends table compatibility.';

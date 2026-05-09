alter table public.fm_messages
  add column if not exists to_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_fm_messages_to_user on public.fm_messages(to_user_id);

update public.fm_messages
set to_user_id = (data->>'to_user_id')::uuid
where to_user_id is null
  and data ? 'to_user_id'
  and (data->>'to_user_id') ~ '^[0-9a-fA-F-]{36}$';

drop policy if exists "fmm_admin_all" on public.fm_messages;
drop policy if exists "fmm_self" on public.fm_messages;
drop policy if exists "fmm_insert_self" on public.fm_messages;
drop policy if exists "fmm_update_recipient" on public.fm_messages;

create policy "fmm_admin_all" on public.fm_messages
  for all using (is_admin()) with check (is_admin());

create policy "fmm_self" on public.fm_messages
  for select using (
    from_user_id = auth.uid()
    or to_user_id = auth.uid()
    or is_admin()
  );

create policy "fmm_insert_self" on public.fm_messages
  for insert with check (
    is_admin()
    or from_user_id = auth.uid()
  );

create policy "fmm_update_recipient" on public.fm_messages
  for update using (
    is_admin()
    or to_user_id = auth.uid()
  ) with check (
    is_admin()
    or to_user_id = auth.uid()
  );

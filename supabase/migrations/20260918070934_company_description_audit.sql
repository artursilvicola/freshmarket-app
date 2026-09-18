-- Serwerowy audyt czterech pól opisu firmy. Normalny zapis profilu odbywa się
-- bezpośrednio na companies, dlatego ślad musi powstawać w bazie, a nie w UI.
create or replace function public.audit_company_description_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.audit_log(user_id, action, entity, entity_id, meta)
  values (
    (select auth.uid()),
    'security_company_description_changed',
    'company',
    new.id::text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'description', old.description,
        'description_short', old.description_short,
        'description_en', old.description_en,
        'description_short_en', old.description_short_en
      ),
      'after', jsonb_build_object(
        'description', new.description,
        'description_short', new.description_short,
        'description_en', new.description_en,
        'description_short_en', new.description_short_en
      ),
      'source', 'companies trigger'
    )
  );
  return new;
end;
$$;

revoke all on function public.audit_company_description_change() from public, anon, authenticated;

drop trigger if exists trg_audit_company_description_change on public.companies;
create trigger trg_audit_company_description_change
after update of description, description_short, description_en, description_short_en
on public.companies
for each row
when (
  old.description is distinct from new.description
  or old.description_short is distinct from new.description_short
  or old.description_en is distinct from new.description_en
  or old.description_short_en is distinct from new.description_short_en
)
execute function public.audit_company_description_change();

-- Meeting logistics are independent of PreConnect purchasing requirements.
-- Deploy this before the frontend. Existing retailer permissions/RLS apply.
-- Rollback: previous frontend; keep columns/data. Do not put meeting notes back
-- into supplier_requirements (that would restore the PreConnect send blocker).
begin;
alter table public.retailers add column if not exists fm_meeting_note text;
alter table public.retailers add column if not exists fm_meeting_note_en text;
comment on column public.retailers.fm_meeting_note is 'Public FM meeting logistics in Polish, not PreConnect purchasing requirements.';
comment on column public.retailers.fm_meeting_note_en is 'English translation of public FM meeting logistics.';

-- Only the four verified legacy entries. Keep all other requirements and any
-- newer/mixed text untouched. Reapplying does not overwrite later note edits.
update public.retailers r
set fm_meeting_note = v.note_pl, fm_meeting_note_en = v.note_en,
    supplier_requirements = null
from (values
  (113, 'ONLINE od godz. 10:00', 'Online meetings from 10:00.'),
  (135, 'ONLINE Spotkania godz. 10:00 - 13:00', 'Online meetings from 10:00 to 13:00.'),
  (120, 'ONLINE Spotkania godz. 10:00 - 13:00', 'Online meetings from 10:00 to 13:00.'),
  (139, 'ONLINE Spotkania godz. 10:00 - 13:00', 'Online meetings from 10:00 to 13:00.')
) as v(id, note_pl, note_en)
where r.id = v.id and r.supplier_requirements = v.note_pl
  and nullif(btrim(r.fm_meeting_note),'') is null
  and nullif(btrim(r.fm_meeting_note_en),'') is null;
commit;

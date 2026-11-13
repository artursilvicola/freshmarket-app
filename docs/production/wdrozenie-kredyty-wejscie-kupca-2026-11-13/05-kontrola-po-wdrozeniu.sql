-- [fix/buyer-entry-seen] KONTROLA PO WDROŻENIU KODU — tylko odczyt, jedno zapytanie.
-- Uruchamiaj po każdym kroku próby na kontach testowych (04-PROBA-PO-WDROZENIU.md).
-- Pokazuje 30 ostatnio zmienionych wysyłek: status, kanał odczytu, rozliczenie, kto odczytał w aplikacji.
select s.legacy_id,
       s.status,
       s.data->>'seenChannel'    as kanal_odczytu,
       s.data->>'readType'       as rodzaj_odczytu,
       s.data->>'billingStatus'  as rozliczenie,
       s.data->>'chargeChannel'  as kredyt_z,
       (s.data->>'supplierNotifiedAt') is not null as dostawca_powiadomiony,
       s.data->>'supplierNotifiedVia' as powiadomienie_kanal,
       (select string_agg(r.reader_role || '/' || r.channel || ' x' || r.read_count, ', ' order by r.channel)
          from public.legacy_send_app_reads r where r.legacy_id = s.legacy_id) as odczyty_aplikacji,
       s.retailer_id,
       s.supplier_legacy_id,
       s.updated_at
from public.legacy_sends s
order by s.updated_at desc
limit 30;

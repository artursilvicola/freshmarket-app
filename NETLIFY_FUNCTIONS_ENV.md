# Netlify functions — wymagane zmienne środowiskowe

Ten projekt używa funkcji Netlify do operacji administracyjnych i wysyłki ofert.  
Po każdej zmianie w konfiguracji zmiennych warto zrobić nowy deploy produkcyjny.

## Minimalny zestaw dla funkcji administracyjnych

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Używane przez:
- `/.netlify/functions/admin-create-user`
- `/.netlify/functions/admin-update-user`
- `/.netlify/functions/admin-reset-password`

## Dodatkowo dla wysyłki maili (Resend)

- `RESEND_API_KEY`

Używane przez:
- `/.netlify/functions/send-retailer-batch` (zbiorczy mailing do sieci)
- `/.netlify/functions/send-supplier-notification` (transactional dostawca)
- `/.netlify/functions/register-supplier-self` (welcome mail)
- `/.netlify/functions/notify-supplier-read` (powiadomienie o odczycie)
- `/.netlify/functions/mark-buyer-preconnect-seen` (idempotent supplier notify)

## Dodatkowo dla funkcji AI

- `OPENAI_API_KEY`

Opcjonalnie:
- `OPENAI_MODEL`

Jeśli `OPENAI_MODEL` nie jest ustawione, funkcje użyją domyślnie:
- `gpt-4.1-mini`

Używane przez:
- `/.netlify/functions/ai-company-description`
- `/.netlify/functions/ai-admin-chat-suggestion`

## Opcjonalne, ale zalecane

- `B2B_APP_URL`

Jeśli nie jest ustawione, funkcje użyją domyślnego adresu:
- `https://freshmarketb2b.netlify.app`

## Dodatkowo dla płatności PayU

Wymagane:
- `PAYU_ENV` (`sandbox` / `production`; `prod` też jest akceptowane)
- `PAYU_POS_ID`
- `PAYU_SECOND_KEY`
- `PAYU_OAUTH_CLIENT_ID`
- `PAYU_OAUTH_CLIENT_SECRET`
- `PAYU_CURRENCY_CODE`

Opcjonalnie:
- `PAYU_VAT_RATE` — domyślnie `23`
- `PAYU_EUR_TO_PAYU_RATE` — wymagane tylko wtedy, gdy `PAYU_CURRENCY_CODE` jest inne niż `EUR`

Ważne:
- `PAYU_CURRENCY_CODE` musi odpowiadać walucie POS skonfigurowanej w PayU.
- Katalog pakietów i rozliczenia w aplikacji są w EUR netto.
- PayU obciąża klienta kwotą brutto, czyli netto z `package_plans.price_eur` + VAT.
- Najbezpieczniejszy wariant produkcyjny: POS PayU w EUR i `PAYU_CURRENCY_CODE=EUR`.

Używane przez:
- `/.netlify/functions/create-payu-order`
- `/.netlify/functions/payu-notify`

## Szybki check po deployu

Możesz otworzyć:

- `/.netlify/functions/admin-env-status`

Zobaczysz:
- czy konfiguracja dla adminowych funkcji jest kompletna,
- czy konfiguracja Resend (mailing) jest kompletna,
- czy konfiguracja dla funkcji AI jest kompletna,
- czy konfiguracja PayU jest kompletna,
- jakich zmiennych brakuje.

## Gdzie to ustawić

Netlify:
- Site configuration
- Environment variables

Po zapisaniu brakujących zmiennych:
1. uruchom nowy deploy,
2. sprawdź `admin-env-status`,
3. dopiero potem testuj tworzenie / edycję kupców i wysyłkę ofert.

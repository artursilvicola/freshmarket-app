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

## Dodatkowo dla wysyłki oferty

- `RESEND_API_KEY`

Używane przez:
- `/.netlify/functions/send-offer`

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

## Szybki check po deployu

Możesz otworzyć:

- `/.netlify/functions/admin-env-status`

Zobaczysz:
- czy konfiguracja dla adminowych funkcji jest kompletna,
- czy konfiguracja dla `send-offer` jest kompletna,
- czy konfiguracja dla funkcji AI jest kompletna,
- jakich zmiennych brakuje.

## Gdzie to ustawić

Netlify:
- Site configuration
- Environment variables

Po zapisaniu brakujących zmiennych:
1. uruchom nowy deploy,
2. sprawdź `admin-env-status`,
3. dopiero potem testuj tworzenie / edycję kupców i wysyłkę ofert.

# Supabase Auth Email Templates — Fresh Market B2B

Domyślne maile Supabase Auth (Reset Password, Confirm Sign Up itd.) są po angielsku, generyczne, bez brandu Fresh Market. Plus wychodzą z `noreply@mail.app.supabase.io` zamiast `hello@freshmarket.eu`.

Ten folder zawiera **gotowe szablony HTML w polskim** + **instrukcję SMTP** żeby naprawić.

---

## Krok 1 — Skonfiguruj custom SMTP (Resend) — zmienia sender

**Cel:** Supabase Auth zaczyna wysyłać maile z `hello@freshmarket.eu` zamiast `noreply@mail.app.supabase.io`.

1. Otwórz: https://supabase.com/dashboard/project/sklyfuvzjikkqerxtulo/auth/templates
2. Kliknij zakładkę **SMTP Settings** na górze
3. Włącz toggle **„Enable Custom SMTP"**
4. Wypełnij pola:

   | Pole | Wartość |
   |---|---|
   | Sender email | `hello@freshmarket.eu` |
   | Sender name | `Fresh Market` |
   | Host | `smtp.resend.com` |
   | Port number | `465` |
   | Username | `resend` |
   | Password | Twój `RESEND_API_KEY` (skopiuj z https://resend.com/api-keys — ten sam co już używasz w Edge Functions) |
   | Minimum interval between emails | `60` (sekund — Free plan Supabase ma rate limit, więcej nie ma sensu) |

5. Kliknij **Save changes**
6. Wyślij test: Authentication → Users → kliknij dowolnego usera → „Send password recovery"

**Po wykonaniu:** wszystkie auth maile wychodzą z `hello@freshmarket.eu` z brandem Fresh Market.

---

## Krok 2 — Wkleić polskie szablony

W tej samej stronie (Authentication → Emails → Templates) jest 14 templates. Edytujesz **3 najważniejsze** + zostawiasz resztę jak jest (rzadko używane).

**Dla każdego template:**

1. Kliknij nazwę template z listy (lewa kolumna)
2. W polu **Subject heading** wklej `subject.txt`
3. W polu **Message body** (HTML editor) wklej `body.html`
4. Kliknij **Save changes**

### Templates do edycji (priorytet od góry)

| Template | Plik | Kiedy używany |
|---|---|---|
| **Reset password** | `reset-password/` | User klika „Zapomniałeś hasła?" na `/login` |
| **Confirm sign up** | `confirm-signup/` | Po rejestracji dostawcy (jeśli włączysz email confirmation w Auth settings) |
| **Magic link** | `magic-link/` | User wybiera „Albo zaloguj przez magic link" na `/login` |

Pozostałe 11 templates (Invite user, Reauthentication, Password changed, MFA itp.) używane rzadko albo wcale — zostaw na domyślne, można edytować później.

---

## Krok 3 — Weryfikacja

Po wgraniu wszystkiego:

1. Wyloguj się z aplikacji
2. Wejdź na `https://b2b.freshmarket.eu/login`
3. Kliknij **„Zapomniałeś hasła?"**
4. Wpisz swój mail → wyślij
5. Sprawdź skrzynkę — powinno przyjść z:
   - Nadawca: **`Fresh Market <hello@freshmarket.eu>`**
   - Subject: **„Fresh Market — zmiana hasła"**
   - Treść: po polsku, z brandem Fresh Market, link do `/reset-hasla`

Jeśli nadawca dalej `noreply@mail.app.supabase.io` — krok 1 (SMTP) nie został zapisany. Wróć i sprawdź.

---

## Co jest w tym folderze

```
auth-email-templates/
├── README.md (ten plik)
├── reset-password/
│   ├── subject.txt
│   └── body.html
├── confirm-signup/
│   ├── subject.txt
│   └── body.html
└── magic-link/
    ├── subject.txt
    └── body.html
```

Każdy `subject.txt` to jeden wiersz tekstu.
Każdy `body.html` to gotowy HTML do wklejenia w Supabase template editor.

Wszystkie używają tych samych zmiennych Supabase:
- `{{ .ConfirmationURL }}` — link do akcji (reset / confirm / magic)
- `{{ .Email }}` — adres mailowy usera
- `{{ .Token }}` — kod OTP (jeśli używasz code zamiast linku)

---

## Co po wgraniu — checklist

- [ ] Custom SMTP w Supabase (Krok 1) — sender = hello@freshmarket.eu
- [ ] Reset password template — subject + body
- [ ] Confirm signup template — subject + body (jeśli email confirmation włączone)
- [ ] Magic link template — subject + body
- [ ] Test: reset hasła na własny mail → przychodzi z polskiej treści + brand
- [ ] Test: rejestracja nowego dostawcy → confirm mail przychodzi (jeśli włączone)
- [ ] Test: magic link login → mail przychodzi

Po wszystkim daj znać Oksanie żeby przetestowała ponownie — mail będzie mówił po polsku że dotyczy zmiany hasła w Fresh Market B2B.

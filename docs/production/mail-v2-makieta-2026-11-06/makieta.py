# -*- coding: utf-8 -*-
# Makieta maila marketingowego PreConnect w układzie v2 (zadanie Codexa 06.11, kierunek Artura):
# jasny nagłówek z zielonym logo + „PreConnect”, zdjęcie z biblioteki, dyskretny dopisek, hasło,
# dwa zdania, data mailingu + przycisk, pomoc, zasady kredytów, zatwierdzona stopka z wypisem.
# TYLKO podgląd statyczny (linki nieaktywne „#”, zdjęcie lokalne). Generuje: pl-kredyty, pl-bez-kredytow,
# en-credits, en-no-credits, pl-kredyty-bez-obrazkow (symulacja zablokowanych obrazków) + index.html.
#   python -I makieta.py
import io, os

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTO = "foto-spotkania-1200.jpg"
LOGO = "logo-green-h96.png"
GREEN = "#15803d"      # zieleń logo (przycisk, akcenty)
TEAL = "#0d9488"       # dotychczasowy akcent PreConnect
INK = "#1a1a1a"
MUTED = "#64748b"

T = {
  "pl": {
    "preconnect": "PreConnect",
    "subline": "Zaprezentuj swoją firmę kupcom online",
    "headline": "Pierwszy krok do nowej sieci handlowej.",
    "greeting": "Dzień dobry, {company},",
    "body_credits": "Chcesz przedstawić swoją firmę kupcom wybranych sieci? Przygotuj propozycję w PreConnect i pokaż swoje produkty oraz możliwości współpracy.",
    "body_nocredits": "Chcesz przedstawić swoją firmę kupcom wybranych sieci? W PreConnect pokazujesz produkty i możliwości współpracy, a my dostarczamy propozycję do wybranych sieci w najbliższym mailingu.",
    "body_manual": "Chcesz przedstawić swoją firmę kupcom wybranych sieci? Przygotuj propozycję w PreConnect i pokaż swoje produkty oraz możliwości współpracy.",
    "mailing": "Najbliższy mailing do kupców:",
    "cta_credits": "Przygotuj propozycję",
    "cta_nocredits": "Zobacz pakiety PreConnect",
    "help": "Nie wiesz, od czego zacząć? <strong>Odpowiedz na tę wiadomość</strong> — pomożemy Ci opisać asortyment i wybrać sieci.",
    "rules_t": "Zasady kredytów PreConnect",
    "rules": "Jedna propozycja do jednej sieci to jeden kredyt. Kredyt rozliczamy dopiero po zarejestrowanym odczycie: otwarciu wiadomości e-mail lub wyświetleniu propozycji na liście w panelu kupca. Ta wiadomość nie pobiera kredytów.",
    "caption": "Zdjęcie archiwalne: rozmowy B2B na Fresh Market",
    "addr": "KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Polska",
    "unsub": "Otrzymujesz tę wiadomość jako operator konta dostawcy w Fresh Market B2B. <a href=\"#\" style=\"color:#475569;\">Wypisz się z informacji o PreConnect</a>.",
    "reply": "Odpowiedz na tę wiadomość albo napisz na <a href=\"#\" style=\"color:#475569;\">preconnect@freshmarket.eu</a>.",
    "subject_credits": "PreConnect: pierwszy krok do nowej sieci handlowej",
    "subject_nocredits": "PreConnect: zaprezentuj swoją firmę kupcom sieci handlowych",
    "date": "1 grudnia 2026",
    "company": "Sad Kowalski",
    "alt": "Rozmowy dostawców z kupcami przy stolikach na Fresh Market",
  },
  "en": {
    "preconnect": "PreConnect",
    "subline": "Present your company to buyers online",
    "headline": "The first step towards a new retail chain.",
    "greeting": "Hello, {company},",
    "body_credits": "Want to introduce your company to buyers of selected chains? Prepare a proposal in PreConnect and show your products and your cooperation capabilities.",
    "body_nocredits": "Want to introduce your company to buyers of selected chains? In PreConnect you show your products and capabilities, and we deliver the proposal to the selected chains in the next mailing.",
    "body_manual": "Want to introduce your company to buyers of selected chains? Prepare a proposal in PreConnect and show your products and your cooperation capabilities.",
    "mailing": "Next buyer mailing:",
    "cta_credits": "Prepare a proposal",
    "cta_nocredits": "See PreConnect packages",
    "help": "Not sure where to start? <strong>Reply to this e-mail</strong> — we will help you describe your range and choose chains.",
    "rules_t": "PreConnect credit rules",
    "rules": "One proposal to one retail chain uses one credit. A credit is settled only after a registered read: the buyer opening the e-mail or viewing the proposal on the list in their panel. This message does not use credits.",
    "caption": "Archive photo: B2B meetings at Fresh Market",
    "addr": "KJOW Sp. z o.o. · ul. Marii 17/25, 05-803 Pruszków, Poland",
    "unsub": "You receive this message as the operator of a supplier account in Fresh Market B2B. <a href=\"#\" style=\"color:#475569;\">Unsubscribe from PreConnect information</a>.",
    "reply": "Reply to this e-mail or write to <a href=\"#\" style=\"color:#475569;\">preconnect@freshmarket.eu</a>.",
    "subject_credits": "PreConnect: the first step towards a new retail chain",
    "subject_nocredits": "PreConnect: present your company to retail chain buyers",
    "date": "1 December 2026",
    "company": "Orchard Kowalski",
    "alt": "Suppliers talking to buyers at tables during Fresh Market",
  },
}

def render(lang, variant, photo=PHOTO):
    t = T[lang]
    body = t["body_" + variant]
    cta = t["cta_credits"] if variant != "nocredits" else t["cta_nocredits"]
    subject = t["subject_credits"] if variant != "nocredits" else t["subject_nocredits"]
    greeting = t["greeting"].format(company=t["company"])
    return f"""<!DOCTYPE html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{subject}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:{INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">

      <!-- 1. jasny nagłówek: logo + PreConnect -->
      <tr><td style="padding:18px 28px;border-bottom:1px solid #e2e8f0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="width:150px;"><img src="{LOGO}" alt="Fresh Market" width="120" height="48" style="display:block;width:120px;height:48px;border:0;"></td>
          <td valign="middle" align="right" style="font-size:16px;font-weight:800;color:{TEAL};letter-spacing:0.3px;">{t["preconnect"]}</td>
        </tr></table>
      </td></tr>

      <!-- 2. zdjęcie z biblioteki (jedno na kampanię, zamrożone przy zatwierdzeniu) -->
      <tr><td style="padding:0;line-height:0;">
        <img src="{photo}" alt="{t["alt"]}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;background:#e2e8f0;color:{MUTED};font-size:13px;line-height:1.5;padding:0;">
      </td></tr>
      <tr><td style="padding:6px 28px 0;font-size:11px;color:#94a3b8;text-align:right;">{t["caption"]}</td></tr>

      <!-- 3. dyskretny dopisek + 4. hasło + 5. dwa zdania -->
      <tr><td style="padding:18px 28px 0;">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:{GREEN};font-weight:700;">{t["subline"]}</div>
        <h1 style="margin:8px 0 14px;font-size:24px;line-height:1.25;font-weight:800;color:{INK};">{t["headline"]}</h1>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.6;">{greeting}</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">{body}</p>
      </td></tr>

      <!-- 6. data mailingu + przycisk (wysoko) -->
      <tr><td style="padding:0 28px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">
          <tr><td style="padding:14px 18px 6px;font-size:14px;line-height:1.5;color:{INK};">{t["mailing"]} <strong>{t["date"]}</strong></td></tr>
          <tr><td style="padding:4px 18px 14px;">
            <a href="#" style="display:inline-block;background:{GREEN};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px;">{cta}</a>
          </td></tr>
        </table>
      </td></tr>

      <!-- 7. pomoc człowieka -->
      <tr><td style="padding:14px 28px 6px;font-size:14px;line-height:1.6;color:#334155;">{t["help"]}</td></tr>

      <!-- 8. zasady kredytów -->
      <tr><td style="padding:14px 28px 26px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:6px;"><tr>
          <td style="padding:12px 16px;font-size:12.5px;line-height:1.55;color:#475569;"><strong style="color:#334155;">{t["rules_t"]}:</strong> {t["rules"]}</td>
        </tr></table>
      </td></tr>

      <!-- stopka zatwierdzona (jasna) -->
      <tr><td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:16px 28px;text-align:center;">
        <img src="{LOGO}" alt="Fresh Market" width="90" height="36" style="display:inline-block;width:90px;height:36px;border:0;opacity:0.85;margin-bottom:6px;">
        <div style="color:#64748b;font-size:11px;line-height:1.7;">{t["addr"]}<br><a href="#" style="color:#475569;text-decoration:none;">b2b.freshmarket.eu</a></div>
        <div style="color:#64748b;font-size:11px;line-height:1.7;margin-top:10px;">{t["reply"]}<br>{t["unsub"]}</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""

VARIANTS = [
  ("pl-kredyty.html", "pl", "credits", PHOTO),
  ("pl-bez-kredytow.html", "pl", "nocredits", PHOTO),
  ("pl-reczna.html", "pl", "manual", PHOTO),
  ("en-credits.html", "en", "credits", PHOTO),
  ("en-no-credits.html", "en", "nocredits", PHOTO),
  ("pl-kredyty-bez-obrazkow.html", "pl", "credits", "brak-obrazka.jpg"),  # symulacja zablokowanych obrazków
]
for fname, lang, variant, photo in VARIANTS:
    io.open(os.path.join(HERE, fname), "w", encoding="utf-8", newline="\n").write(render(lang, variant, photo))
index = "<!DOCTYPE html><meta charset='utf-8'><title>Makieta maila v2</title><body style='font-family:sans-serif;padding:20px'><h1>Makieta maila PreConnect v2 (06.11)</h1><ul>" + "".join(
    f"<li><a href='{f}'>{f}</a> — {lang.upper()} / {v}</li>" for f, lang, v, _ in VARIANTS) + "</ul><p>Linki w makietach są nieaktywne (#). Zdjęcie lokalne 1000×667 JPG 98 KB.</p></body>"
io.open(os.path.join(HERE, "index.html"), "w", encoding="utf-8", newline="\n").write(index)
print("ok", len(VARIANTS), "plików")

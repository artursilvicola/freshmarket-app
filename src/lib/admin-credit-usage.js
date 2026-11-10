// [fix/admin-credits-display] Wykorzystanie kredytów firmy w panelu admina.
// Jedno źródło liczb dla paska „Wykorzystanie kredytów”, licznika w nagłówku karty
// i szczegółów firmy: `lim.used` = qty_used z company_capacity (kredyty finalnie
// zużyte po odczycie przez kupca), `lim.max` = qty_total (wszystkie kredyty: przyznane
// bezpłatnie + kupione). Wcześniej pasek liczył wysyłki (także zwrócone za brak odczytu),
// więc El Roda pokazywała 5/7 (71%) przy 3 zużytych kredytach.
export function adminCreditUsage(lim) {
  const max = Math.max(0, Number(lim?.max) || 0);
  const used = Math.max(0, Number(lim?.used) || 0);
  const pct = max > 0 ? Math.round((used / max) * 100) : 0;
  return { used, max, remaining: Math.max(0, max - used), pct };
}

// [fix/admin-credits-display, review Codexa 10.11] Zbiorczy nagłówek karty firmy: tylko liczba
// kredytów, BEZ daty. `pkg_expiry` z company_capacity to najpóźniejszy termin spośród ważnych
// pakietów — część kredytów może wygasać wcześniej, więc nie wolno go pokazywać jako ważności
// całego salda. Szczegółowe terminy zostają przy pulach (bezpłatne / kupione).
export function adminCreditTotalLabel(t, lim) {
  return t("admin.firmy.list_credits_total_format", { max: Math.max(0, Number(lim?.max) || 0) });
}

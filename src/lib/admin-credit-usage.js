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

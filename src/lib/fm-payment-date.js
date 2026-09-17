export function isPaymentDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Apply a confirmed narrow response without sending a stale whole-company upsert.
export function applyPaymentDate(companies, saved) {
  return companies.map(company => company.id === saved.id
    ? { ...company, fm_payment_date: saved.fm_payment_date, updated_at: saved.updated_at ?? company.updated_at }
    : company);
}

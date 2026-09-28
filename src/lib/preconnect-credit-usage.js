// Expired unread proposals never consumed a package credit. They must not
// reserve another submission slot while their legacy refund marker is pending.
const RELEASED = new Set(["rejected", "refunded", "queued", "unread_expired"]);
export function usesPreconnectCredit(send) {
  return Boolean(send?.status) && !RELEASED.has(send.status);
}
export function countUsedCreditSlots(sends, supplierId) {
  return (sends || []).filter(s => String(s.supplierId) === String(supplierId) && usesPreconnectCredit(s)).length;
}

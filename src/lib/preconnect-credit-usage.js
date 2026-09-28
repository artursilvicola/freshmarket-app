// Expired unread proposals never consumed a package credit. They must not
// reserve another submission slot while their legacy refund marker is pending.
const RELEASED = new Set(["rejected", "refunded", "queued", "unread_expired"]);
export function usesPreconnectCredit(send) {
  return Boolean(send?.status) && !RELEASED.has(send.status);
}
export function countUsedCreditSlots(sends, supplierId) {
  return (sends || []).filter(s => String(s.supplierId) === String(supplierId) && usesPreconnectCredit(s)).length;
}

export function hasCreditCharge(send) {
  const d = send?.data || {};
  return Boolean(send?.chargeAt || send?.chargeTxId || send?.billingStatus === "charged"
    || d.chargeAt || d.chargeTxId || d.billingStatus === "charged");
}

export function isReleasedUnreadReservation(send) {
  return send?.status === "unread_expired" && !hasCreditCharge(send);
}

// The package ledger is authoritative for consumed credits. A read without a
// successful charge must not be displayed as a consumed package credit.
export function describeCreditUsage(sends, supplierId, chargedTotal) {
  const own = (sends || []).filter(s => !s.supplierId || String(s.supplierId) === String(supplierId));
  return {
    used: chargedTotal != null ? Math.max(0, Number(chargedTotal) || 0) : own.filter(hasCreditCharge).length,
    reserved: own.filter(s => usesPreconnectCredit(s) && !hasCreditCharge(s)
      && !["opened", "read", "read_manual"].includes(s.status)).length,
    released: own.filter(isReleasedUnreadReservation).length,
  };
}

import { describe,it,expect } from "vitest";
import { countUsedCreditSlots,usesPreconnectCredit,describeCreditUsage,isReleasedUnreadReservation } from "../src/lib/preconnect-credit-usage.js";
describe("submission slot reservation",()=>{
 it("expired unread releases the slot before a refund marker exists",()=>{expect(usesPreconnectCredit({status:"unread_expired"})).toBe(false)});
 it("keeps moderation, approved and sent reserved; counts read once",()=>{for(const status of ["pending_moderation","approved","sent","opened","read","read_manual"])expect(usesPreconnectCredit({status})).toBe(true)});
 it("does not count another supplier or rejected/refunded/draft queue",()=>{const sends=["rejected","refunded","queued","unread_expired"].map(status=>({supplierId:"a",status})); sends.push({supplierId:"b",status:"sent"},{supplierId:"a",status:"sent"});expect(countUsedCreditSlots(sends,"a")).toBe(1)});
});
describe('actual charges versus reservations',()=>{
 it('does not turn three unread sends into three used credits',()=>{
  expect(describeCreditUsage(Array.from({length:3},()=>({supplierId:'a',status:'sent'})),'a',0)).toEqual({used:0,reserved:3,released:0});
 });
 it('uses the ledger; expired unread is released even without an old refund marker',()=>{
  const sends=[{supplierId:'a',status:'read',billingStatus:'charged'}, {supplierId:'a',status:'pending_moderation'}, {supplierId:'a',status:'approved'}, {supplierId:'a',status:'unread_expired'}, {supplierId:'b',status:'sent'}];
  expect(describeCreditUsage(sends,'a',1)).toEqual({used:1,reserved:2,released:1});
 });
 it('does not call a previously charged expiration a free release',()=>{
  expect(isReleasedUnreadReservation({status:'unread_expired',data:{chargeTxId:'charge'}})).toBe(false);
  expect(describeCreditUsage([{status:'read',billingStatus:'no_package_available'}],'a',0).used).toBe(0);
  expect(isReleasedUnreadReservation({status:'unread_expired',refundTxId:'legacy-refund'})).toBe(false);
 });
});

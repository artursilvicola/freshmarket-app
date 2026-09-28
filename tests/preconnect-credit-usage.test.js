import { describe,it,expect } from "vitest";
import { countUsedCreditSlots,usesPreconnectCredit } from "../src/lib/preconnect-credit-usage.js";
describe("submission slot reservation",()=>{
 it("expired unread releases the slot before a refund marker exists",()=>{expect(usesPreconnectCredit({status:"unread_expired"})).toBe(false)});
 it("keeps moderation, approved and sent reserved; counts read once",()=>{for(const status of ["pending_moderation","approved","sent","opened","read","read_manual"])expect(usesPreconnectCredit({status})).toBe(true)});
 it("does not count another supplier or rejected/refunded/draft queue",()=>{const sends=["rejected","refunded","queued","unread_expired"].map(status=>({supplierId:"a",status})); sends.push({supplierId:"b",status:"sent"},{supplierId:"a",status:"sent"});expect(countUsedCreditSlots(sends,"a")).toBe(1)});
});

import { describe,it,expect,vi } from "vitest";
vi.mock("./supabase", () => ({supabase:{rpc:vi.fn(),from:vi.fn()}}));
vi.mock("../i18n", () => ({default:{t:key=>key}}));
import {supabase} from "./supabase";
import {setCompanyFmPaymentDate,bulkUpsertCompanies} from "./db";
import {isPaymentDate,applyPaymentDate} from "./fm-payment-date";
describe("payment date data boundary", () => {
  it("validates actual calendar dates without local-time conversion", () => {
    for(const date of ["2026-09-17","2024-02-29","0001-01-01"]) expect(isPaymentDate(date)).toBe(true);
    for(const date of [null,"","2026-02-29","2026-02-30","2026-13-01","17.09.2026","0000-01-01"]) expect(isPaymentDate(date)).toBe(false);
  });
  it("merges only the confirmed date into the correct existing record", () => {
    const a={id:"a",name:"Newer company name",fm_b2b_packages:2,description:"Newer description"};
    const b={id:"b",fm_payment_date:"2026-05-01"};
    const result=applyPaymentDate([a,b],{id:"a",fm_payment_date:"2026-06-01",name:"Stale name",fm_b2b_packages:1});
    expect(result[0]).toMatchObject({...a,fm_payment_date:"2026-06-01"});
    expect(result[1]).toBe(b); expect(a.fm_payment_date).toBeUndefined();
  });
  it("uses the narrow RPC and never falls back to direct writes on errors", async () => {
    supabase.rpc.mockResolvedValueOnce({error:{code:"42501"}});
    await expect(setCompanyFmPaymentDate("a","2026-06-01","2026-09-17")).rejects.toMatchObject({code:"42501"});
    expect(supabase.rpc).toHaveBeenLastCalledWith("admin_set_fm_payment_date",{p_company_id:"a",p_payment_date:"2026-06-01",p_expected_date:"2026-09-17"});
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it("rejects an unconfirmed or wrong-record response", async () => {
    for(const data of [null,{id:"b",fm_payment_date:"2026-06-01"},{id:"a",fm_payment_date:"2026-09-17"}]) {
      supabase.rpc.mockResolvedValueOnce({data,error:null});
      await expect(setCompanyFmPaymentDate("a","2026-06-01","2026-09-17")).rejects.toThrow("fm_payment_date_unconfirmed");
    }
  });
  it("ordinary whole-profile saves never resend the payment date", async () => {
    const upsert=vi.fn(() => ({select:async()=>({data:[],error:null})}));
    supabase.from.mockReturnValueOnce({upsert});
    await bulkUpsertCompanies([{id:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",name:"TEST",fm_payment_date:"1900-01-01"}]);
    expect(upsert.mock.calls[0][0][0]).not.toHaveProperty("fm_payment_date");
  });
});

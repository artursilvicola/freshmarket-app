import { describe, expect, it, vi } from "vitest";
vi.mock("./supabase", () => ({ supabase: {} }));
import { correctionMeetingLimit, describeAddition, undoCandidate } from "./fm-corrections";
import pl from "../i18n/pl/legacy.json";
import en from "../i18n/en/legacy.json";
const supplier = { id: "a", name: "Alpha", pkg: "Business", fmPackages: 1, fmB2bEnabled: true };
const chains = ["one", "two", "three", "four", "five", "six"].map(id => ({ id, name: id, capacity: 10 }));
const plan = { cq: { one: ["a"], two: [null,null,"a"], three: [null,null,null,null,"a"], four: [null,null,null,null,null,null,"a"], five: ["b"], six: [] }, res: { a: { m: [] } } };
const describeAdd = (p=plan, target={cid:"five",pos:8}, s=supplier, resp={}) => describeAddition(p,target,s,chains,resp);
describe("adding a missing meeting", () => {
  it("counts actual cells (not stale totals), proposes 4→5 and does not mutate the plan", () => {
    const before=JSON.stringify(plan), a=describeAdd();
    expect(a).toMatchObject({beforeCount:4,afterCount:5,limit:5,issues:[],to:{sid:"a",cid:"five",pos:8}});
    expect(JSON.stringify(plan)).toBe(before);
  });
  it("rejects an occupied cell, repeat retailer, adjacent/same number and full allowance", () => {
    expect(describeAdd(plan,{cid:"five",pos:0}).issues).toContain("fm_correction_occupied");
    expect(describeAdd(plan,{cid:"one",pos:8}).issues).toContain("fm_correction_duplicate");
    for(const pos of [6,7])expect(describeAdd(plan,{cid:"five",pos}).issues).toContain("fm_correction_gap");
    expect(describeAdd({...plan,cq:{...plan.cq,six:["a"]}}).issues).toContain("fm_correction_supplier_limit");
  });
  it("respects current retailer capacity and explicit buyer rejection", () => {
    const a=describeAddition(plan,{cid:"five",pos:8},supplier,chains.map(c=>({...c,capacity:1})),{});
    expect(a.issues).toContain("fm_correction_capacity");
    for(const response of ["remove","rejected"])expect(describeAdd(plan,undefined,undefined,{five:{a:response}}).issues).toContain("fm_correction_buyer_rejected");
  });
  it("allows a new eligible company with zero meetings and no prior preference", () => {
    expect(describeAdd(plan,{cid:"five",pos:8},{...supplier,id:"new"})).toMatchObject({beforeCount:0,afterCount:1,issues:[]});
    expect(describeAdd(plan,undefined,{...supplier,pkg:"Standard"}).issues).toContain("fm_correction_supplier_ineligible");
  });
  it("honours a lower plan allowance, never raises a purchased allowance and rejects malformed limits", () => {
    expect(correctionMeetingLimit({meeting_limits:{a:9}},{...supplier,fmPackages:3})).toBe(9);
    expect(correctionMeetingLimit({meeting_limits:{a:9}},supplier)).toBe(5);
    for(const value of [null,"9",0,-1,26,1.5])expect(describeAdd({...plan,meeting_limits:{a:value}}).issues).toContain("fm_correction_limit_invalid");
    expect(describeAdd({...plan,meeting_limits:{a:4}}).issues).toContain("fm_correction_supplier_limit");
  });
  it("validates coordinates and includes add in reversible history", () => {
    for(const target of [{cid:"missing",pos:8},{cid:"five",pos:-1},{cid:"five",pos:0.5}])expect(describeAdd(plan,target).issues).toContain("fm_correction_invalid_cell");
    expect(undoCandidate([{id:"add",action:"add"}]).id).toBe("add");
    expect(undoCandidate([{action:"undo",details:{undo_of:"add"}},{id:"add",action:"add"}])).toBeNull();
  });
  it("ships translated addition and validation messages in both languages", () => {
    for(const dict of [pl,en])for(const key of ["add_meeting","add_count","confirm_add","explain_add","continue_add","action_add"])expect(dict.fm.board[key]).toBeTruthy();
    for(const dict of [pl,en])for(const code of ["supplier_limit","gap","occupied","buyer_rejected","chain_inactive","limit_invalid"])expect(dict.fm.board.errors[`fm_correction_${code}`]).toBeTruthy();
  });
});

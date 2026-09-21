import { describe,it,expect,vi,beforeEach } from "vitest";
const capture=vi.hoisted(()=>vi.fn());
vi.mock("./supabase",()=>({supabase:{from:()=>({update:row=>{capture(row);return {eq:()=>({select:()=>({single:async()=>({data:row,error:null})})})};}})}}));
vi.mock("../i18n",()=>({default:{t:k=>k}}));
import {updateRetailer} from "./db";
beforeEach(()=>capture.mockClear());
describe("retailer note persistence",()=>{
  it("keeps trading requirements and both meeting translations independent",async()=>{
    await updateRetailer(113,{supplierRequirements:"Trade",fmMeetingNote:"Nowe PL",fm_meeting_note:"Stare PL",fmMeetingNoteEn:"New EN"});
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({supplier_requirements:"Trade",fm_meeting_note:"Nowe PL",fm_meeting_note_en:"New EN"}));
  });
  it("does not clear notes for an older caller but supports explicit empty text",async()=>{
    await updateRetailer(113,{name:"Polomarket"});
    expect(capture.mock.calls[0][0]).not.toHaveProperty("fm_meeting_note");
    await updateRetailer(113,{fmMeetingNote:"",fm_meeting_note:"Old"});
    expect(capture.mock.calls[1][0].fm_meeting_note).toBe("");
  });
});

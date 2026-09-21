import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
const language = vi.hoisted(() => ({ value: "en" }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "en", t: k => k } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: k => k, i18n: { language: language.value } }), Trans: ({ i18nKey }) => i18nKey }));
import { PageWysylki, PageSupplierFM } from "./PreconnectFM.jsx";
import MeetingNote from "../components/fm/MeetingNote.jsx";
const trees=[];
function render(node){let tree;act(()=>{tree=create(node);});trees.push(tree);return tree;}
const text=tree=>JSON.stringify(tree.toJSON());
afterEach(()=>{act(()=>trees.splice(0).forEach(t=>t.unmount()));language.value="en";});
const retailer={id:113,name:"Polomarket",country:"PL",active:true,fm26Active:true,fm26ChainId:"ch40",supplierRequirements:"",fmMeetingNote:"ONLINE od godz. 10:00",fmMeetingNoteEn:"Online meetings from 10:00."};
function wysylki(r=retailer){return render(<PageWysylki sends={[]} offers={[{id:1,status:"active",supplierId:"s1",title:"Flowers"}]} sid={1} accountId="s1" co={{pkg:"std_10"}} pkgMax={15} pkgUsed={14} rem={1} wallet={{balance:0}} retailers={[r]} companies={[]} nav={vi.fn()} sendToChain={vi.fn()}/>);}
function pickRetailer(tree){act(()=>tree.root.findAllByType("select")[1].props.onChange({target:{value:"113"}}));}
function sendButton(tree){return tree.root.findAllByType("button").find(x=>x.children.includes("supplier.wysylki.new.send_button"));}
describe("separate purchasing requirements and FM logistics",()=>{
  it("an FM-only note neither appears in PreConnect nor requires an acknowledgement",()=>{
    const tree=wysylki();pickRetailer(tree);
    expect(text(tree)).not.toContain("ONLINE od");expect(text(tree)).not.toContain("Online meetings");
    expect(tree.root.findAllByProps({type:"checkbox"})).toHaveLength(0);
    expect(sendButton(tree).props.disabled).toBe(false);
    act(()=>sendButton(tree).props.onClick());
    expect(text(tree)).toContain("supplier.wysylki.confirm_modal.title");
    expect(tree.root.findByType(PageWysylki).props.sendToChain).not.toHaveBeenCalled();
  });
  it("a genuine trade requirement still blocks sending until acknowledged",()=>{
    const tree=wysylki({...retailer,supplierRequirements:"Only local distributors"});pickRetailer(tree);
    expect(text(tree)).toContain("Only local distributors");
    expect(text(tree)).not.toContain("Online meetings");
    expect(sendButton(tree).props.disabled).toBe(true);
    act(()=>tree.root.findByProps({type:"checkbox"}).props.onChange({target:{checked:true}}));
    expect(sendButton(tree).props.disabled).toBe(false);
  });
  it.each([["en","Online meetings from 10:00."],["pl","ONLINE od godz. 10:00"]])("FM displays the note in %s",(lang,expected)=>{
    language.value=lang;
    const tree=render(<MeetingNote retailer={retailer}/>);
    expect(text(tree)).toContain(expected);
  });
  it("has a language fallback and never turns purchasing requirements into FM logistics",()=>{
    expect(text(render(<MeetingNote retailer={{fm_meeting_note:"Tylko PL"}}/>))).toContain("Tylko PL");
    expect(render(<MeetingNote retailer={{supplierRequirements:"Only local distributors"}}/>).toJSON()).toBeNull();
  });
  it("supplier FM retailer cards show logistics without a checkbox",()=>{
    const tree=render(<PageSupplierFM fmId="s1" accountId="s1" fmSettings={{currentPhase:2,schedulingOpen:true}} fmPrefs={{s1:{ch40:"star"}}} setFmPrefs={vi.fn()} fmResps={{}} fmSchedule={null} fmAlgo={null} subPage="fm-sched" fmChains={[{...retailer,id:"ch40",cat:"flowers"}]} fmSuppliers={[{id:"s1",name:"Test",pkg:"Business"}]} companies={[{id:"s1",fm_b2b_packages:1}]} offers={[]} retailers={[retailer]} previewFor={{}}/>);
    expect(text(tree)).toContain("Online meetings from 10:00.");
    expect(tree.root.findAllByProps({type:"checkbox"})).toHaveLength(0);
  });
});

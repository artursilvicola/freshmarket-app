import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/fm-corrections", async orig => ({ ...await orig(), loadCorrections:vi.fn(),loadCorrectionHistory:vi.fn(),commitCorrection:vi.fn() }));
vi.mock("../../lib/supabase",()=>({supabase:{}}));
import pl from "../../i18n/pl/legacy.json";
vi.mock("react-i18next",()=>({useTranslation:()=>({t:(key,vars={})=>{
  let value=key.split('.').reduce((p,k)=>p?.[k],pl)||key;
  return value.replace(/{{(\w+)}}/g,(_,k)=>vars[k]??'');
}})}));
import { commitCorrection,loadCorrections,loadCorrectionHistory } from "../../lib/fm-corrections";
import CorrectionBoard from "./CorrectionBoard";
const cq={one:["a"],two:[null,null,"a"],three:[null,null,null,null,"a"],four:[null,null,null,null,null,null,"a"],five:["b"]};
const plan={cq,res:{a:{m:["one","two","three","four"]},b:{m:["five"]}}};
const draft=(schedule=plan,revision=1,approved=false)=>({schedule,revision,approved});
const props=()=>({data:plan,fmChains:Object.keys(cq).map(id=>({id,name:`Retailer ${id}`,capacity:10})),fmSuppliers:[{id:"a",name:"Company Alpha",fmPackages:1},{id:"b",name:"Beta",fmPackages:1}],inputsReady:true,canEdit:true,buildCandidate:()=>plan});
const trees=[];
const button=(t,k)=>t.root.findAllByType("button").find(b=>b.children.includes(pl.fm.board[k]));
const cell=(t,id)=>t.root.findByProps({"data-cell":id});
const click=async b=>{await act(async()=>{await b.props.onClick();});};
const txt=t=>JSON.stringify(t.toJSON());
async function render(extra={}){let t;await act(async()=>{t=create(<CorrectionBoard {...props()} {...extra}/>);});trees.push(t);return t;}
async function pick(t,sid="a"){await act(async()=>t.root.findByProps({"aria-label":pl.fm.board.add_company}).props.onChange({target:{value:sid}}));}
beforeEach(()=>{vi.resetAllMocks();loadCorrections.mockResolvedValue(draft());loadCorrectionHistory.mockResolvedValue([]);vi.stubGlobal("window",{addEventListener:vi.fn(),removeEventListener:vi.fn()});});
afterEach(()=>{act(()=>trees.splice(0).forEach(t=>t.unmount()));vi.unstubAllGlobals();});
describe("new meeting via an empty cell",()=>{
 it("selects a firm, shows 4→5, confirms once, and keeps the four existing cells",async()=>{
  const t=await render();await click(cell(t,"five:8"));await pick(t);
  expect(txt(t)).toContain("Spotkania firmy: 4 → 5. Limit: 5.");
  expect(commitCorrection).not.toHaveBeenCalled();await click(button(t,"add_review"));
  expect(txt(t)).toContain("Dodać nowe spotkanie tej firmy?");expect(txt(t)).toContain("Retailer five · #9");
  expect(commitCorrection).not.toHaveBeenCalled();
  let resolve;const pending=new Promise(r=>resolve=r);commitCorrection.mockReturnValue(pending);
  const confirm=button(t,"confirm");let task;act(()=>{task=confirm.props.onClick();confirm.props.onClick();});
  expect(commitCorrection).toHaveBeenCalledTimes(1);
  expect(commitCorrection.mock.calls[0][0]).toMatchObject({action:"add",revision:1,details:{to:{cid:"five",pos:8,sid:"a"}}});
  expect(cell(t,"five:8").props.title).not.toContain("Company Alpha");
  const saved={...plan,cq:{...cq,five:["b",null,null,null,null,null,null,null,"a"]}};
  loadCorrectionHistory.mockResolvedValue([{id:"added",action:"add",revision:2,details:{to:{cid:"five",pos:8,sid:"a",company:"Company Alpha",chain:"Retailer five"}},actor_name:"Admin",created_at:"2026-09-21T10:00:00Z"}]);
  await act(async()=>{resolve(draft(saved,2));await task;});
  for(const id of ["one:0","two:2","three:4","four:6","five:8"])expect(cell(t,id).props.title).toContain("Company Alpha");
  expect(txt(t)).toContain("Dodanie spotkania");expect(button(t,"undo").props.disabled).toBe(false);
 });
 it("cancel at either step never writes; Escape also closes the picker",async()=>{
  const t=await render();await click(cell(t,"five:8"));await pick(t);await click(button(t,"cancel"));
  await click(cell(t,"five:8"));await pick(t);await click(button(t,"add_review"));await click(button(t,"cancel"));
  await click(cell(t,"five:8"));act(()=>t.root.findByProps({role:"dialog"}).props.onKeyDown({key:"Escape",preventDefault:vi.fn(),stopPropagation:vi.fn()}));
  expect(t.root.findAllByProps({role:"dialog"})).toHaveLength(0);expect(commitCorrection).not.toHaveBeenCalled();
 });
 it("search narrows companies and clears a previous selection",async()=>{
  const t=await render();await click(cell(t,"five:8"));await pick(t);
  act(()=>t.root.findByProps({type:"search"}).props.onChange({target:{value:"missing"}}));
  expect(txt(t)).toContain(pl.fm.board.add_search_empty);expect(button(t,"add_review").props.disabled).toBe(true);
 });
 it.each([['gap',{},{cid:'five',pos:7},'fm_correction_gap'],['rejection',{fmResps:{five:{a:'remove'}}},{cid:'five',pos:8},'fm_correction_buyer_rejected']])("blocks invalid %s with a visible reason",async(_,extra,target,code)=>{
  const t=await render(extra);await click(cell(t,`${target.cid}:${target.pos}`));await pick(t);
  expect(txt(t)).toContain(pl.fm.board.errors[code]);expect(button(t,"add_review").props.disabled).toBe(true);
  await click(button(t,"add_review"));expect(commitCorrection).not.toHaveBeenCalled();
 });
 it("shows server conflict without adding a local cell and requires reload",async()=>{
  const t=await render();await click(cell(t,"five:8"));await pick(t);await click(button(t,"add_review"));commitCorrection.mockRejectedValue(new Error("fm_correction_occupied"));await click(button(t,"confirm"));
  expect(txt(t)).toContain(pl.fm.board.errors.fm_correction_occupied);expect(cell(t,"five:8").props.title).not.toContain("Company Alpha");expect(cell(t,"five:8").props.disabled).toBe(true);
 });
 it.each([['initialize',null],['unlock',draft(plan,1,true)]])("requires %s first, then a separate addition confirmation",async(action,loaded)=>{
  loadCorrections.mockResolvedValue(loaded);const t=await render();await click(cell(t,"five:8"));
  expect(txt(t)).toContain(pl.fm.board[`confirm_${action}`]);commitCorrection.mockResolvedValue(draft(plan,2));await click(button(t,"confirm"));
  expect(commitCorrection.mock.calls[0][0].action).toBe(action);await pick(t);await click(button(t,"add_review"));expect(txt(t)).toContain(pl.fm.board.confirm_add);expect(commitCorrection).toHaveBeenCalledTimes(1);
 });
 it("moving to an empty cell keeps the move workflow, without the add picker",async()=>{
  const t=await render();await click(cell(t,"one:0"));await click(button(t,"start_move"));await click(cell(t,"five:8"));
  expect(txt(t)).toContain(pl.fm.board.confirm_move);expect(t.root.findAllByProps({"aria-label":pl.fm.board.add_company})).toHaveLength(0);
 });
 it("does not offer additions outside editing phase",async()=>{
  const t=await render({canEdit:false});expect(cell(t,"five:8").props.disabled).toBe(true);await click(cell(t,"five:8"));expect(t.root.findAllByProps({role:"dialog"})).toHaveLength(0);
 });
});

import React from "react";
import { create, act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("../../lib/fm-late-selections", () => ({ loadLateSelections: vi.fn(), saveLateSelection: vi.fn(), setLateAccess: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: k => k }) }));
import { loadLateSelections, saveLateSelection, setLateAccess } from "../../lib/fm-late-selections";
import { BuyerLateSelections, AdminLateSelections } from "./LateSelections";
const suppliers=[{id:"co1",name:"Firma 1",country:"PL"},{id:"co2",name:"Firma 2",country:"ES"}];
const retailers=[{id:100,name:"Sieć A",fm26Active:true,fm26ChainId:"a"},{id:101,name:"Sieć B",fm26Active:true,fm26ChainId:"b"}];
const row=(zone="want")=>({id:"row",retailer_id:100,supplier_legacy_id:"co1",zone,responded_at:"2026-09-20T12:00:00Z"});
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}};
const trees=[];
async function render(node){let tree;await act(async()=>{tree=create(node)});trees.push(tree);return tree;}
const text=tree=>JSON.stringify(tree.toJSON());
const button=(tree,key)=>tree.root.findAllByType("button").find(x=>x.children.includes(key));
const choice=(tree,sid,zone)=>tree.root.findByProps({"data-supplier":sid}).findAllByType("button").find(x=>x.children.includes("fm.buyer.btn_"+zone));
beforeEach(()=>{vi.resetAllMocks();loadLateSelections.mockResolvedValue({access:[{retailer_id:100,enabled:true}],rows:[]});});
afterEach(()=>{act(()=>trees.splice(0).forEach(t=>t.unmount()));});

describe("oddzielne zgłoszenia do ręcznych korekt",()=>{
 it("kupiec w świeżej sesji odczytuje dostęp i zapisuje tylko własne zgłoszenie",async()=>{
  const tree=await render(<BuyerLateSelections retailerId={100} suppliers={suppliers}/>);
  expect(loadLateSelections).toHaveBeenCalledWith(100);
  const request=deferred();saveLateSelection.mockReturnValue(request.promise);
  let saving;act(()=>{saving=choice(tree,"co1","want").props.onClick()});
  expect(choice(tree,"co1","chance").props.disabled).toBe(true);
  expect(choice(tree,"co1","want").props["aria-pressed"]).toBe(false);
  await act(async()=>{request.resolve(row());await saving});
  expect(saveLateSelection).toHaveBeenCalledWith(100,"co1","want");
  expect(choice(tree,"co1","want").props["aria-pressed"]).toBe(true);
  expect(text(tree)).toContain("fm.late.saved");
  expect(setLateAccess).not.toHaveBeenCalled();
 });
 it("odrzucona zmiana zachowuje ostatnie potwierdzone zgłoszenie i wymaga odświeżenia",async()=>{
  loadLateSelections.mockResolvedValue({access:[{retailer_id:100,enabled:true}],rows:[row()]});
  const tree=await render(<BuyerLateSelections retailerId={100} suppliers={suppliers}/>);
  saveLateSelection.mockRejectedValue(new Error("closed"));
  await act(async()=>{await choice(tree,"co1","chance").props.onClick()});
  expect(choice(tree,"co1","want").props["aria-pressed"]).toBe(true);
  expect(text(tree)).toContain("fm.late.save_error");
  expect(choice(tree,"co1","chance").props.disabled).toBe(true);
  loadLateSelections.mockResolvedValue({access:[{retailer_id:100,enabled:false}],rows:[row()]});
  await act(async()=>{await button(tree,"fm.late.refresh").props.onClick()});
  expect(text(tree)).toContain("fm.late.closed");
  expect(text(tree)).not.toContain("Firma 2");
  expect(choice(tree,"co1","want").props.disabled).toBe(true);
 });
 it("ponowne kliknięcie usuwa tylko zgłoszenie; odmowa usunięcia nie ukrywa wiersza",async()=>{
  loadLateSelections.mockResolvedValue({access:[{retailer_id:100,enabled:true}],rows:[row()]});
  const tree=await render(<BuyerLateSelections retailerId={100} suppliers={suppliers}/>);
  saveLateSelection.mockRejectedValue(new Error("zero rows"));
  await act(async()=>{await choice(tree,"co1","want").props.onClick()});
  expect(saveLateSelection).toHaveBeenCalledWith(100,"co1",null);
  expect(choice(tree,"co1","want").props["aria-pressed"]).toBe(true);
 });
 it("błąd odczytu nie wygląda jak pusta skrzynka; brak dostępu nie tworzy wyborów",async()=>{
  loadLateSelections.mockRejectedValue(new Error("network"));
  const tree=await render(<BuyerLateSelections retailerId={100} suppliers={suppliers}/>);
  expect(text(tree)).toContain("fm.late.load_error");
  expect(text(tree)).not.toContain("Firma 1");
  expect(saveLateSelection).not.toHaveBeenCalled();
  loadLateSelections.mockResolvedValue({access:[],rows:[]});
  await act(async()=>{await button(tree,"fm.late.refresh").props.onClick()});
  expect(tree.toJSON()).toBe(null);
 });
 it("administrator zapisuje otwarcie, odświeża zgłoszenia i filtruje sieć",async()=>{
  loadLateSelections.mockResolvedValue({access:[],rows:[]});
  const tree=await render(<AdminLateSelections retailers={retailers} suppliers={suppliers} canOpen/>);
  setLateAccess.mockResolvedValue({retailer_id:100,enabled:true});
  await act(async()=>{await tree.root.findAllByType("input")[0].props.onChange()});
  expect(setLateAccess).toHaveBeenCalledWith(100,true);
  expect(tree.root.findAllByType("input")[0].props.checked).toBe(true);
  loadLateSelections.mockResolvedValue({access:[{retailer_id:100,enabled:true}],rows:[row(),{...row("chance"),id:"other",retailer_id:101,supplier_legacy_id:"co2"}]});
  await act(async()=>{await button(tree,"fm.late.refresh").props.onClick()});
  expect(text(tree)).toContain("Firma 1");expect(text(tree)).toContain("Firma 2");
  act(()=>tree.root.findByType("select").props.onChange({target:{value:"100"}}));
  expect(text(tree)).toContain("Firma 1");expect(text(tree)).not.toContain("Firma 2");
  expect(saveLateSelection).not.toHaveBeenCalled();
 });
 it("błąd otwarcia nie pokazuje fałszywie włączonego dostępu",async()=>{
  loadLateSelections.mockResolvedValue({access:[],rows:[]});
  const tree=await render(<AdminLateSelections retailers={retailers} suppliers={suppliers} canOpen/>);
  setLateAccess.mockRejectedValue(new Error("denied"));
  await act(async()=>{await tree.root.findAllByType("input")[0].props.onChange()});
  expect(tree.root.findAllByType("input")[0].props.checked).toBe(false);
  expect(text(tree)).toContain("fm.late.save_error");
 });
 it("spóźniony odczyt po przejściu do innej sieci nie przechodzi do nowego panelu",async()=>{
  const pending=deferred();loadLateSelections.mockReturnValueOnce(pending.promise);
  const tree=await render(<BuyerLateSelections key="100" retailerId={100} suppliers={suppliers}/>);
  loadLateSelections.mockResolvedValue({access:[],rows:[]});
  await act(async()=>{tree.update(<BuyerLateSelections key="101" retailerId={101} suppliers={suppliers}/>)});
  await act(async()=>{pending.resolve({access:[{retailer_id:100,enabled:true}],rows:[row()]})});
  expect(tree.toJSON()).toBe(null);
 });
});

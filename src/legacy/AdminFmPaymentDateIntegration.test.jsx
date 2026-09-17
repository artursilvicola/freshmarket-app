import React,{useState} from "react";
import {act,create} from "react-test-renderer";
import {it,expect,vi} from "vitest";
vi.mock("../lib/supabase",()=>({supabase:{}}));
vi.mock("../i18n",()=>({default:{language:"pl",t:k=>k}}));
vi.mock("react-i18next",()=>({useTranslation:()=>({t:k=>k,i18n:{language:"pl"}}),Trans:({i18nKey})=>i18nKey}));
vi.mock("../lib/db",async original=>({...await original(),getPendingProformas:async()=>[],setCompanyFmPaymentDate:vi.fn()}));
import {setCompanyFmPaymentDate} from "../lib/db";
import {applyPaymentDate} from "../lib/fm-payment-date";
import {PageAdminFirmy} from "./PreconnectFM";

it("B2B enables the date beside packages; confirmed date uses the raw state callback, not whole-profile persistence",async()=>{
  const ordinarySave=vi.fn(); const confirmedSave=vi.fn();
  const co={id:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",name:"LOCAL TEST",country:"PL",account_status:"active",fm_b2b_enabled:false,fm_b2b_packages:2,fm_payment_date:"2026-09-17",contacts:[],certs:[]};
  function Harness(){
    const [companies,set]=useState([co]);
    return <PageAdminFirmy companies={companies} setCompanies={value=>{ordinarySave();set(value);}}
      onPaymentDateSaved={saved=>{confirmedSave(saved);set(prev=>applyPaymentDate(prev,saved));}}
      dbCapacity={companies} limits={[]} sends={[]} offers={[]} orders={[]} retailers={[]} fl={()=>{}}/>;
  }
  let tree;
  try {
    await act(async()=>{tree=create(<Harness/>);});
    act(()=>tree.root.findByProps({"aria-label":"▼"}).props.onClick());
    expect(tree.root.findAllByProps({type:"date"})).toHaveLength(0);
    const checkbox=tree.root.findAllByProps({type:"checkbox"})[1];
    act(()=>checkbox.props.onChange({target:{checked:true}}));
    const input=()=>tree.root.findByProps({type:"date"});
    expect(input().props.value).toBe("2026-09-17");
    const dateBlock=tree.root.findByProps({"data-testid":"admin-fm-payment-date"});
    const ancestors=[];for(let p=dateBlock.parent;p;p=p.parent) ancestors.push(p.type);
    expect(ancestors).not.toContain("label");
    setCompanyFmPaymentDate.mockResolvedValue({id:co.id,fm_payment_date:"2026-05-19"});
    act(()=>input().props.onChange({target:{value:"2026-05-19"}}));
    await act(async()=>tree.root.findByProps({"aria-label":"admin.firmy.payment_date_save"}).props.onClick());
    expect(confirmedSave).toHaveBeenCalledTimes(1);
    expect(ordinarySave).toHaveBeenCalledTimes(1); // Participation toggle only.
    expect(input().props.value).toBe("2026-05-19");
    expect(tree.root.findAllByProps({type:"checkbox"})[1].props.checked).toBe(true);
  } finally {if(tree) act(()=>tree.unmount());}
});

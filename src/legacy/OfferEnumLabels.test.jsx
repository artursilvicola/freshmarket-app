import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe,it,expect,vi } from 'vitest';
import { createInstance } from 'i18next';
import en from '../i18n/en/legacy.json';
import pl from '../i18n/pl/legacy.json';
const lang=vi.hoisted(()=>({t:null}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:lang.t,i18n:{language:'en'}}),Trans:()=>null}));
vi.mock('../i18n',()=>({default:{language:'en',t:k=>k}}));
vi.mock('../lib/supabase',()=>({supabase:{}}));
import { OfferPreviewModal, PageBuyerDetail, PageOfferForm, OfferFilters, applyFilters } from './PreconnectFM.jsx';
import { OFFER_ENUM_KEYS } from '../lib/offer-enums';
const i18n=createInstance();
await i18n.init({lng:'en',fallbackLng:false,defaultNS:'legacy',resources:{en:{legacy:en},pl:{legacy:pl}}});
const offer={id:'o1',supplierId:'s1',title:'Avocado',product:'Avocado',category:'owoce',packaging:['Luz','Karton','Siatka'],customPackaging:'Wooden crate',srp:'Do uzgodnienia',volume:'10',volumeUnit:'palety',offerType:'Propozycja sezonowa',positioning:'Bio / ekologiczne',coldChain:'Po stronie kupca',deliveryDays:['Pon','Śr'],traceability:'Tak',currentTests:'Nie',samplesAvail:'Po uzgodnieniu'};
function render(component,lng='en') {lang.t=i18n.getFixedT(lng,'legacy');let tree;act(()=>{tree=create(component)});return tree;}
function text(tree){return JSON.stringify(tree.toJSON());}
describe('offer views language regressions',()=>{
 it('form categories match the dictionary and translate labels while retaining stored values',()=>{
  const tree=render(<PageOfferForm co={{}} saveOffer={()=>{}} nav={()=>{}}/>);
  const herbs=tree.root.findAllByType('option').find(n=>n.props.value==='zioła');
  expect(herbs.children.join('')).toContain('Herbs');
  const select=herbs.parent;
  expect(select.findAllByType('option').map(n=>n.props.value).filter(Boolean)).toEqual(Object.keys(OFFER_ENUM_KEYS.category));
  act(()=>select.props.onChange({target:{value:'zioła'}}));
  expect(select.props.value).toBe('zioła');
  act(()=>tree.unmount());
 });
 for(const full of [false,true]) it(`preview ${full?'full':'compact'} uses EN labels and preserves input`,()=>{
  const before=JSON.stringify(offer);const tree=render(<OfferPreviewModal offer={offer} co={{}} onClose={()=>{}} adminFull={full}/>);
  const out=text(tree);for(const label of ['Bulk','Carton','Net','Wooden crate']) expect(out).toContain(label);
  for(const raw of ['Luz','Karton','Siatka']) expect(out).not.toContain(raw);
  if(full){expect(out).toContain('To be agreed');expect(out).not.toContain('Po stronie kupca');}
  expect(JSON.stringify(offer)).toBe(before);act(()=>tree.unmount());
 });
 it('PL preview retains Polish labels',()=>{const tree=render(<OfferPreviewModal offer={offer} co={{}} onClose={()=>{}} adminFull/>, 'pl');expect(text(tree)).toContain('Do uzgodnienia');expect(text(tree)).toContain('Karton');act(()=>tree.unmount());});
 it('buyer detail translates identification and expanded packaging',()=>{
  const tree=render(<PageBuyerDetail send={{id:'s',offerId:'o1',supplierId:'s1',status:'read'}} offers={[offer]} co={{}} buyer={{starred:[]}} companies={[]} sends={[]} nav={()=>{}} toggleStar={()=>{}}/>);
  // Expand all collapsed sections, so the test cannot pass on an unopened panel.
  for(const sec of tree.root.findAll(n=>typeof n.type==='function'&&n.type.name==='Sec')) {
   if(sec.props.defaultOpen===false) act(()=>sec.findAllByType('div').find(n=>typeof n.props.onClick==='function').props.onClick());
  }
  const out=text(tree);expect(out).toContain('Bulk');expect(out).toContain('To be agreed');expect(out).not.toContain('Propozycja sezonowa');expect(out).not.toContain('Bio / ekologiczne');act(()=>tree.unmount());
 });
 it('Bulk filter emits stored Luz value and actually matches the offer',()=>{
  let chosen;const tree=render(<OfferFilters filters={{}} setFilters={fn=>{chosen=fn({})}}/>);
  // Filters start collapsed.
  const toggle=tree.root.findAllByType('button').find(n=>typeof n.props.onClick==='function');act(()=>toggle.props.onClick());
  const bulk=tree.root.findAllByType('option').find(n=>n.children.includes('Bulk'));
  expect(bulk.props.value).toBe('Luz');act(()=>bulk.parent.props.onChange({target:{value:bulk.props.value}}));
  expect(applyFilters([offer,{id:'other',packaging:['IFCO']}],chosen,[]).map(o=>o.id)).toEqual(['o1']);act(()=>tree.unmount());
 });
});

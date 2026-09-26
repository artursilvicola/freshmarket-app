import { describe, it, expect } from 'vitest';
import { createInstance } from 'i18next';
import pl from '../i18n/pl/legacy.json';
import en from '../i18n/en/legacy.json';
import { OFFER_ENUM_KEYS, offerEnumLabel, offerEnumOptions } from './offer-enums';
const i18n=createInstance();
await i18n.init({lng:'en',fallbackLng:false,resources:{en:{legacy:en},pl:{legacy:pl}},defaultNS:'legacy'});
const enT=i18n.getFixedT('en','legacy'), plT=i18n.getFixedT('pl','legacy');
describe('offer enum labels',()=>{
 it('every persisted option has real PL and EN labels',()=>{
  for(const [field,map] of Object.entries(OFFER_ENUM_KEYS)) for(const [value,key] of Object.entries(map)) {
   for(const lng of ['pl','en']) expect(i18n.exists(key,{lng,ns:'legacy'}),`${field}/${value}/${lng}`).toBe(true);
  }
 });
 it('localizes known values without mutating persisted choices',()=>{
  expect(offerEnumLabel('packaging','Luz',enT)).toBe('Bulk');
  expect(offerEnumLabel('packaging','Luz',plT)).toBe('Luz');
  expect(offerEnumLabel('category','zioła',enT)).toBe('Herbs');
  expect(offerEnumLabel('category','ziola',enT)).toBe('Herbs');
  expect(offerEnumLabel('srp','Do uzgodnienia',enT)).toBe('To be agreed');
  expect(offerEnumOptions('packaging',enT)).toContainEqual(['Karton','Carton']);
  expect(offerEnumOptions('packaging',enT).map(([v])=>v)).toEqual(offerEnumOptions('packaging',plT).map(([v])=>v));
 });
 it('retains unknown values and empty values and handles legacy booleans/days',()=>{
  expect(offerEnumLabel('packaging','Skrzynka drewniana',enT)).toBe('Skrzynka drewniana');
  expect(offerEnumLabel('packaging',null,enT)).toBeNull();
  expect(offerEnumLabel('srp',false,enT)).toBe('No');
  expect(offerEnumLabel('traceability',true,enT)).toBe('Yes');
  expect(offerEnumLabel('deliveryDays','Pn',enT)).toBe('Mon');
  expect(offerEnumLabel('deliveryDays','Pon',enT)).toBe('Mon');
  expect(offerEnumLabel('packaging','constructor',enT)).toBe('constructor');
 });
});

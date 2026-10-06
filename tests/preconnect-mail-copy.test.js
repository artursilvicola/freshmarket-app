import { describe, expect, it } from 'vitest';
import { renderRetailerEmail } from '../netlify/functions/_shared/render-retailer-email.js';
import { pickTemplate } from '../netlify/functions/_shared/supplier-email-templates.js';

describe('buyer mailing terminology', () => {
  it.each([
    [1, 'propozycję'], [2, 'propozycje'], [4, 'propozycje'],
    [5, 'propozycji'], [12, 'propozycji'], [14, 'propozycji'],
    [21, 'propozycji'], [22, 'propozycje'], [24, 'propozycje'],
    [25, 'propozycji'], [112, 'propozycji'], [122, 'propozycje'],
  ])('uses the correct form for %i proposals', (count, noun) => {
    const {html, subject} = renderRetailerEmail({
      retailer:{name:'Test'},
      sends:Array.from({length:count}, (_,i) => ({legacy_id:i+1,data:{offerId:1}})),
      offers:new Map([[1,{title:'Jablka'}]]),companies:new Map(),
      buyerCount:1,month:'Test month',appUrl:'https://example.invalid',locale:'pl',
    });
    expect(html).toContain(`<strong>${count} ${noun}</strong>`);
    expect(html).not.toMatch(/\bofert(?:a|y|ę)?\b/);
    expect(subject).toContain('propozycje dostawców');
  });
});

describe('supplier notification templates', () => {
  it.each([
    ['pl', 'Status propozycji i jej odczytu przez kupca sprawdzisz w panelu dostawcy.', 'Otrzymasz potwierdzenie'],
    ['en', "You can check the submission's status and whether the buyer has viewed it in your supplier panel.", "You'll get a confirmation"],
  ])('approval no longer promises a mailing confirmation in %s', (locale, statusText, retiredPromise) => {
    const {html} = pickTemplate('offer_approved', {
      locale,retailerName:'Test',offerTitle:'Product',appUrl:'https://example.invalid',
    });
    expect(html).toContain(statusText);
    expect(html).not.toContain(retiredPromise);
  });

  it.each(['pl','en'])('retires both sent-notice names in %s', (locale) => {
    const payload = {locale,retailerName:'Test',offerTitle:'Product',appUrl:'https://example.invalid'};
    expect(pickTemplate('offer_sent_to_retailer',payload)).toBeNull();
    expect(pickTemplate('offers_sent_to_retailer',payload)).toBeNull();
  });
});

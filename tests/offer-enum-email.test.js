import {it,expect} from 'vitest';
import {renderRetailerEmail} from '../netlify/functions/_shared/render-retailer-email';
for(const locale of ['en','pl']) it(`email uses ${locale} packaging/units and escapes custom data`,()=>{
 const args={retailer:{name:'Retailer'},sends:[{data:{offerId:'o1',supplierId:'s1'}}],offers:new Map([['o1',{title:'Avocado',volume:'10',volumeUnit:'kartony',packaging:['Luz']}]]),companies:new Map(),buyerCount:1,month:'September',appUrl:'https://example.com',locale};
 const {html}=renderRetailerEmail(args);
 expect(html).toContain(locale==='en'?'Bulk':'Luz');expect(html).toContain(locale==='en'?'cartons':'kartony');
 args.offers.get('o1').packaging=[];args.offers.get('o1').customPackaging='<script>bad</script>';
 const custom=renderRetailerEmail(args).html;expect(custom).toContain('&lt;script&gt;');expect(custom).not.toContain('<script>');
});

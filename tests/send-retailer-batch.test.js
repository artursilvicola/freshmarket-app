import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: (_url, key) => key === 'anon' ? state.user : state.service }));
vi.mock('../netlify/functions/_shared/function-env.js', () => ({
  resolveEnvConfig: () => ({supabaseUrl:'https://fake.test',supabaseAnonKey:'anon',supabaseServiceRoleKey:'svc',resendApiKey:'fake',b2bAppUrl:'https://fake.test'}),
  missingEnvNames: () => [], envErrorPayload: () => ({}),
}));
import handler from '../netlify/functions/send-retailer-batch.js';
import { handler as supplierNotificationHandler } from '../netlify/functions/send-supplier-notification.js';

function query(table) {
  const tableRows = {
    legacy_sends: state.rows,
    companies: state.companies,
    legacy_offers: state.offers,
    profiles: state.owners,
  };
  let result = {data: structuredClone(tableRows[table] || [])};
  const q = {};
  for (const k of ['select','eq','in','order','limit']) q[k] = vi.fn(() => q);
  q.maybeSingle = async () => ({data: table === 'profiles' ? state.admin : table === 'retailers' ? state.retailer : null});
  q.then = (a,b) => Promise.resolve(result).then(a,b);
  q.update = () => { throw new Error('Whole-row writes are forbidden'); };
  return q;
}
const request = (body={retailer_id:1,send_ids:[7]}) => new Request('https://fake.test/send-retailer-batch',{method:'POST',headers:{Authorization:'Bearer fake','Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(() => {
  state.admin = {role:'admin',active:true,locale:'pl'};
  state.retailer = {id:1,name:'Test',buyers:[{email:'buyer@example.test',active:true,locale:'en'}]};
  state.rows = [{legacy_id:7,retailer_id:1,status:'sent',data:{offerId:1,supplierId:'supplier-1'}}];
  state.companies = [{id:'company-1',legacy_supplier_id:'supplier-1',name:'Test supplier'}];
  state.offers = [{legacy_id:1,data:{title:'Jablka',i18n_en:{title:'Apples'}}}];
  state.owners = [{company_id:'company-1',role:'supplier',active:true,email:'supplier@example.test',locale:'pl'}];
  state.user = {auth:{getUser:async () => ({data:{user:{id:'admin'}}})}};
  state.service = {from:vi.fn(query),auth:{admin:{generateLink:vi.fn(async () => ({data:{}}))}},rpc:vi.fn(async () => ({data:[7]}))};
  vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({id:'resend-1'}),{status:200})));
});
afterEach(() => vi.unstubAllGlobals());
describe('retailer delivery persistence', () => {
  it('uses only a narrow RPC after mail, never replays stale read/billing fields',async () => {
    fetch.mockImplementation(async () => { state.rows[0].status='read'; state.rows[0].data.billingStatus='charged'; return new Response('{"id":"m1"}'); });
    const r=await handler(request()); const body=await r.json();
    expect(r.status).toBe(200);expect(body.ok).toBe(true);
    expect(state.service.rpc).toHaveBeenCalledWith('mark_legacy_sends_retailer_emailed',{
      p_send_ids:[7],p_retailer_id:1,p_message_ids:['m1'],p_buyer_count:1,p_sent_at:expect.any(String),
    });
    expect(state.rows[0].data.billingStatus).toBe('charged');expect(body.send_ids_marked).toEqual([7]);
  });
  it('unconfirmed database acknowledgement is not success and sends no supplier notice',async () => {
    state.service.rpc.mockResolvedValue({error:{message:'network'}});
    const r=await handler(request());const body=await r.json();
    expect(r.status).toBe(502);expect(body.delivery_uncertain).toBe(true);expect(body.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);expect(body.send_ids_marked).toEqual([]);
  });
  it('a truncated RPC result is also uncertain',async () => {
    state.service.rpc.mockResolvedValue({data:[]});expect((await handler(request())).status).toBe(502);
  });
  it('inactive admin is denied before mail or RPC',async () => {
    state.admin.active=false;expect((await handler(request())).status).toBe(403);expect(fetch).not.toHaveBeenCalled();expect(state.service.rpc).not.toHaveBeenCalled();
  });
  it('dry run sends nothing and creates no magic links',async () => {
    expect((await handler(request({retailer_id:1,send_ids:[7],dry_run:true}))).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();expect(state.service.rpc).not.toHaveBeenCalled();expect(state.service.auth.admin.generateLink).not.toHaveBeenCalled();
  });
  it('rejected mail does not persist a sent marker',async () => {
    fetch.mockResolvedValue(new Response('{}',{status:500}));const body=await (await handler(request())).json();
    expect(body.ok).toBe(false);expect(body.sent_count).toBe(0);expect(state.service.rpc).not.toHaveBeenCalled();
  });
  it('advanced/already-emailed or another retailer rows are not sent',async () => {
    state.rows=[{legacy_id:7,retailer_id:1,status:'read',data:{}},{legacy_id:8,retailer_id:2,status:'sent',data:{}},{legacy_id:9,retailer_id:1,status:'sent',data:{emailSentAt:'2026-09-01'}}];
    expect((await handler(request({retailer_id:1,send_ids:[7,8,9]}))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
  });

  it('successful mailing sends only to buyers even when an active supplier has email',async () => {
    const body = await (await handler(request())).json();
    expect(body.ok).toBe(true);
    expect(body.send_ids_marked).toEqual([7]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).to).toEqual(['buyer@example.test']);
    expect(state.service.from.mock.calls.filter(([table]) => table === 'profiles')).toHaveLength(1);
    expect(state.service.rpc).toHaveBeenCalledTimes(1);
  });

  it('renders mixed buyers in their own saved languages, not the admin language',async () => {
    state.admin.locale = 'en';
    state.retailer.buyers = [
      {email:'pl@example.test',active:true,locale:'pl'},
      {email:'en@example.test',active:true,locale:'en'},
    ];
    const body = await (await handler(request({retailer_id:1,send_ids:[7],locale:'en'}))).json();
    const mails = fetch.mock.calls.map(([,init]) => JSON.parse(init.body));
    expect(body.buyers_succeeded).toEqual(['pl@example.test','en@example.test']);
    expect(mails).toHaveLength(2);
    expect(mails[0].html).toContain('<html lang="pl">');
    expect(mails[0].html).toContain('1 propozycję');
    expect(mails[0].html).toContain('Jablka');
    expect(mails[0].subject).toContain('propozycje dostawców');
    expect(mails[1].html).toContain('<html lang="en">');
    expect(mails[1].html).toContain('1 supplier submission');
    expect(mails[1].html).toContain('Apples');
    expect(mails[1].subject).toContain('supplier submission');
  });

  it('missing buyer language defaults to Polish even for an English-speaking admin',async () => {
    state.admin.locale = 'en';
    state.retailer.buyers[0].locale = null;
    await handler(request({retailer_id:1,send_ids:[7],locale:'en'}));
    expect(JSON.parse(fetch.mock.calls[0][1].body).html).toContain('<html lang="pl">');
  });

  it.each(['offer_sent_to_retailer','offers_sent_to_retailer'])(
    'generic notification endpoint cannot send retired %s template',async (template) => {
      const result = await supplierNotificationHandler({
        httpMethod:'POST',headers:{'x-internal-token':'svc'},
        body:JSON.stringify({template,payload:{recipientEmail:'supplier@example.test',locale:'en'}}),
      });
      expect(result.statusCode).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runInvoiceAutomation} from '../../lib/moneybird/automation-worker.mjs';
import {InvoiceWriteError,invoiceSummary,createMoneybirdInvoices} from '../../lib/moneybird/invoices.mjs';
export async function automaticInvoiceChecks({db,addOrder,admin,buyer,contact,options,administration,migrate,rawInvoice}){
 await db.exec('reset role');await migrate('022_automatic_invoices');
 const root=()=>db.exec('reset role');
 const auto=async(action,{actor=null,order=null,owner=null,data={}}={})=>{
  await db.exec('reset role;set role service_role');
  return (await db.query('select public.server_invoice_automation($1,$2,$3,$4,$5) r',[action,actor,order,owner,data])).rows[0].r;
 };
 const row=async id=>{await root();return (await db.query('select * from private.order_invoice_jobs where order_id=$1',[id])).rows[0]};
 const add=async(test=false)=>{await root();return addOrder(test)};
 const due=async id=>{await root();await db.query("update private.order_invoice_jobs set auto_next_at=now()-interval '1 second',auto_until=null,lease_until=null where order_id=$1",[id])};
 assert.equal(await auto('claim',{owner:randomUUID()}),null,'off by default');
 await assert.rejects(auto('configure',{actor:buyer,data:{enabled:true}}),/ADMIN_REQUIRED/);
 await db.exec('reset role;set role authenticated');
 await assert.rejects(db.query("select public.server_invoice_automation('settings',$1)",[buyer]),/permission denied/);
 await root();assert.equal((await db.query('select count(*)::int n from private.order_invoice_jobs where auto_eligible')).rows[0].n,0,'no historical backfill');
 const preActivation=await add();await auto('configure',{actor:admin,data:{enabled:true}});
 assert.equal(await auto('claim',{owner:randomUUID()}),null,'orders before first activation are excluded');
 await assert.rejects(auto('retry',{actor:admin,order:preActivation}),/NOT_ELIGIBLE/);
 await add(true);
 const stored=[],alerts=[];let creates=0,sends=0,mode='ok',changeEmail=false;
 const billing={contacts:{contact:async()=>({...contact,invoice_workflow_id:'55555555555555555',invoice_email:changeEmail?'changed@example.test':contact.invoice_email})},client:{
  options:async()=>options,
  findForPlan:async p=>stored.find(i=>i.reference===p.reference&&i.details.some(d=>d.description.startsWith(p.order_marker)))?.id||null,
  create:async p=>{
   creates++;if(mode==='create_no_accept')throw new InvoiceWriteError('INVOICE_WRITE_UNCERTAIN',true);
   const raw=rawInvoice(p,String(88000000000000000n+BigInt(creates)));raw.workflow_id=p.workflow_id;raw.due_date='2026-12-28';
   stored.push(invoiceSummary(raw));
   if(mode==='pause_after_create')await auto('configure',{actor:admin,data:{enabled:false}});
   if(mode==='changed_recipient')changeEmail=true;
   if(mode==='create_timeout')throw new InvoiceWriteError('INVOICE_WRITE_UNCERTAIN',true);
   return raw.id;
  },
  get:async id=>{const value=stored.find(i=>i.id===id);if(!value)throw Error('INVOICE_MISSING');return {...value}},
  sendRegular:async(id,email)=>{
   sends++;assert.equal(email,'facturen@example.test');
   const idJob=(await row(current)).delivery_state;assert.equal(idJob,'sending','send fence committed BEFORE provider PATCH');
   if(mode==='send_rejected')throw new InvoiceWriteError('MONEYBIRD_RATE_LIMIT',false);
   if(mode==='send_no_accept')throw new InvoiceWriteError('INVOICE_WRITE_UNCERTAIN',true);
   Object.assign(stored.find(i=>i.id===id),{state:'open',sent_at:'2026-11-28T10:00:00Z',invoice_number:'2026-TEST'});
   if(mode==='send_timeout')throw new InvoiceWriteError('INVOICE_WRITE_UNCERTAIN',true);
  }
 }};
 const tick=()=>runInvoiceAutomation({rpc:auto,billing,sendAlert:async message=>{assert.equal(message.to,'info@rechtbanktekeningen.nl');assert.ok(!message.text.includes('voorbeeld.jpg'));alerts.push(message);return true}});
 let current=await add();
 const owner=randomUUID(),claimed=await auto('claim',{owner});assert.equal(claimed.order_id,current);
 assert.equal(await auto('claim',{owner:randomUUID()}),null,'exclusive worker claim');
 await assert.rejects(auto('sending',{order:current,owner:randomUUID()}),/BUSY/);
 await auto('release',{order:current,owner});await due(current);
 assert.equal((await tick()).sent,1);assert.equal((await row(current)).delivery_state,'sent');
 assert.equal(stored[0].workflow_id,'55555555555555555');assert.equal(stored[0].due_date,'2026-12-28');
 const firstCreates=creates,firstSends=sends;await tick();assert.equal(creates,firstCreates);assert.equal(sends,firstSends,'finished jobs never re-send');

 mode='create_timeout';current=await add();assert.equal((await tick()).failed,1);const createCount=creates;
 assert.equal((await row(current)).status,'create_uncertain');await due(current);mode='ok';assert.equal((await tick()).sent,1);assert.equal(creates,createCount,'lost POST response is recovered without another POST');

 mode='send_timeout';current=await add();assert.equal((await tick()).failed,1);const sendCount=sends;
 assert.equal((await row(current)).delivery_state,'uncertain');await due(current);mode='ok';assert.equal((await tick()).sent,1);assert.equal(sends,sendCount,'lost PATCH response is recovered by GET, without another PATCH');

 mode='send_no_accept';current=await add();await tick();const uncertainSendCount=sends;await due(current);mode='ok';await tick();assert.equal(sends,uncertainSendCount,'unknown send with draft readback must not be repeated');
 assert.equal((await row(current)).delivery_state,'uncertain');
 // Park this intentionally uncertain job to isolate later scenarios.
 await root();await db.query('update private.order_invoice_jobs set auto_attempts=20 where order_id=$1',[current]);

 mode='create_no_accept';current=await add();await tick();const unknownCreates=creates;await due(current);mode='ok';await tick();assert.equal(creates,unknownCreates,'unknown creation with no match must not be repeated');
 await root();await db.query('update private.order_invoice_jobs set auto_attempts=20 where order_id=$1',[current]);

 mode='send_rejected';current=await add();await tick();assert.equal((await row(current)).delivery_state,'rejected');const beforeRetry=sends;await due(current);mode='ok';assert.equal((await tick()).sent,1);assert.equal(sends,beforeRetry+1,'definite rejection can retry after backoff');

 mode='pause_after_create';current=await add();const beforePause=sends;await tick();assert.equal(sends,beforePause,'pause checked before sending');assert.equal((await row(current)).delivery_state,'pending');
 await auto('configure',{actor:admin,data:{enabled:true}});await due(current);mode='ok';assert.equal((await tick()).sent,1);

 mode='changed_recipient';current=await add();const beforeChange=sends;await tick();assert.equal(sends,beforeChange,'billing recipient is re-read immediately before sending');assert.equal((await row(current)).auto_last_error,'INVOICE_DELIVERY_SETTINGS_CHANGED');changeEmail=false;await due(current);mode='ok';assert.equal((await tick()).sent,1);

 // Source/contact failure is recoverable; an email outage remains visible rather than marked sent.
 current=await add();const broken={...billing,contacts:{contact:async()=>{throw Error('MONEYBIRD_CONTACT_MISSING')}}};
 await runInvoiceAutomation({rpc:auto,billing:broken,sendAlert:async()=>false});assert.equal((await row(current)).alert_state,'failed');
 assert.equal((await row(current)).auto_last_error,'MONEYBIRD_CONTACT_MISSING');await auto('retry',{actor:admin,order:current});assert.equal((await tick()).sent,1);
 assert.ok(alerts.length>=5);

 // The regular provider operation uses the normal Moneybird template, never the credited trial text.
 const requests=[];const api=createMoneybirdInvoices({token:'fake',administrationId:administration},async(url,request)=>{requests.push({url:String(url),...request});return request.method==='POST'?Response.json({id:'123456789'}):new Response(null,{status:204})});
 await api.sendRegular('123456789','facturen@example.test');const send=JSON.parse(requests[0].body).sales_invoice_sending;
 assert.equal(requests[0].method,'PATCH');assert.equal(send.sending_scheduled,false);assert.equal(send.mergeable,false);assert.equal(send.delivery_method,'Email');assert.ok(!('email_message' in send));
 assert.ok(!JSON.stringify(send).includes('gecrediteerd'));
 const creationPlan=(await row(current)).request_snapshot;await api.create(creationPlan);
 const created=JSON.parse(requests.find(r=>r.method==='POST').body).sales_invoice;
 assert.equal(created.workflow_id,'55555555555555555');
 for(const field of ['due_date','invoice_date','payment_conditions'])assert.ok(!(field in created),'no hardcoded payment term or invoice date');

 await assert.rejects(api.sendRegular('123456789','a@example.test\r\nBcc:other@example.test'),/INVOICE_PLAN/);

 // Revoked worker authority is reported instead of silently leaving eligible orders stuck.
 current=await add();await root();await db.query("update public.profiles set status='suspended' where id=$1",[admin]);
 const beforeRevoke=sends;await tick();assert.equal(sends,beforeRevoke);assert.equal((await row(current)).auto_last_error,'AUTOMATION_ADMIN_REQUIRED');
 await root();await db.query("update public.profiles set status='approved' where id=$1",[admin]);await auto('retry',{actor:admin,order:current});await tick();
 // A persisted sending fence survives an abandoned worker lease and is never reset by expiry.
 current=await add();mode='send_no_accept';await tick();await root();await db.query("update private.order_invoice_jobs set delivery_state='sending',auto_until=now()-interval '1 second',lease_until=now()-interval '1 second',auto_next_at=now()-interval '1 second' where order_id=$1",[current]);
 const abandonedSends=sends;mode='ok';await tick();assert.equal(sends,abandonedSends);assert.equal((await row(current)).delivery_state,'sending');
 await auto('configure',{actor:admin,data:{enabled:false}});
 assert.equal(await auto('claim',{owner:randomUUID()}),null);
 await root();
 console.log('Automatic invoice checks: prospective enrollment, permissions, double-worker exclusion, direct sending, contact workflow, uncertain POST/PATCH recovery, rejection retry, pause, changed recipient and alert failures passed.');
}

import test from 'node:test';import assert from 'node:assert/strict';
import {ComposioHub} from '../server/nexo/composio.mjs';
function fixture(){
 const records=new Map(),requests=[];let version='v1',failExecution=false,badLink=false,clock=1000,wrongUser=false,failSave=false,searchSchemas={GMAIL_SEND_EMAIL:{tool_slug:'GMAIL_SEND_EMAIL',toolkit:'gmail',description:'send'}};
 const vault={load:async b=>structuredClone(records.get(b.profile)||null),save:async(b,c)=>{if(failSave)throw Error('disk failure');records.set(b.profile,structuredClone(c));}};
 const fetcher=async(url,o)=>{requests.push({url,o});const p=new URL(url),body=o.body?JSON.parse(o.body):null;let d={};
  if(p.pathname.endsWith('/toolkits'))d={items:[{slug:'gmail',name:'Gmail',meta:{description:'Mail'},composio_managed_auth_schemes:['OAUTH2']}]};
  else if(p.pathname.endsWith('/tool_router/session')){assert.equal(body.instant,false);assert.equal(body.workbench.enable,false);assert.equal(body.execute.enable_multi_execute,false);d={session_id:'session_'+body.user_id,config:{instant:false,workbench:{enable:false},multi_account:{enable:true,require_explicit_selection:true}}};}
  else if(p.pathname.endsWith('/connected_accounts')){assert.equal(p.searchParams.get('user_ids'),records.get('p1')?.userId);d={items:[{id:'account1',user_id:records.get('p1').userId,toolkit:{slug:'gmail'},status:'ACTIVE'},{id:'foreign',user_id:'someoneelse',toolkit:{slug:'gmail'}}]};}
  else if(p.pathname.endsWith('/connected_accounts/account1'))d={id:'account1',user_id:wrongUser?'foreign':records.get('p1').userId,toolkit:{slug:'gmail'},status:'ACTIVE'};
  else if(p.pathname.includes('/connected_accounts/cal'))d={id:p.pathname.split('/').at(-1),user_id:records.get('p1').userId,toolkit:{slug:'googlecalendar'},status:'ACTIVE'};
  else if(p.pathname.includes('/tools/')){const id=p.pathname.split('/').at(-1);d={slug:id,name:'Send email',toolkit:{slug:id.startsWith('COMPOSIO_')?'composio':id.startsWith('GOOGLECALENDAR_')?'googlecalendar':'gmail'},version,input_parameters:{type:'object',properties:{body:{type:'string'}}}};}
  else if(p.pathname.endsWith('/execute')){if(failExecution)throw Error('timeout with secret');assert.ok(records.get('p1').receipts.some(r=>r.status==='uncertain'));d={data:{successful:true,text:'áéí',access_token:'must-not-leak'},log_id:'log1'};}
  else if(p.pathname.endsWith('/link'))d={redirect_url:badLink?'https://app.composio.dev.evil.test/link':'https://connect.composio.dev/link/abc'};
  else if(p.pathname.endsWith('/search'))d={tool_schemas:searchSchemas,toolkit_connection_statuses:[]};
  return new Response(JSON.stringify(d));
 };
 const hub=new ComposioHub({vault,fetcher,now:()=>clock});const call=(op,args={},profile='p1')=>hub.dispatch(profile,op,args);
 const configure=()=>call('configure',{key:'ak_test_fixture_only_12345'});
 const prepare=()=>call('prepare',{tool:'GMAIL_SEND_EMAIL',account:'account1',arguments_json:'{"body":"Hola"}',scope:'task1'});
 return {hub,records,requests,call,configure,prepare,vault,fetcher,setVersion:v=>version=v,fail:()=>failExecution=true,badLink:()=>badLink=true,expire:()=>clock+=130000,wrongUser:()=>wrongUser=true,failSave:()=>failSave=true,schemas:v=>searchSchemas=v};
}
test('key validated and held in vault, not public status; stable user across rotation',async()=>{const f=fixture();await f.configure();const old=f.records.get('p1').userId;await f.call('configure',{key:'ak_rotated_fixture_12345'});assert.equal(f.records.get('p1').userId,old);assert.deepEqual(await f.call('status'),{configured:true,provider:'Composio',receipts:[]});assert.equal((await f.call('status',{},'p2')).configured,false);});
test('session persists and is reused after host restart; instant/workbench off',async()=>{const f=fixture();await f.configure();await f.call('catalogue');const next=new ComposioHub({vault:f.vault,fetcher:f.fetcher});await next.dispatch('p1','catalogue',{});assert.equal(f.requests.filter(x=>x.url.endsWith('/tool_router/session')).length,1);});
test('account list excludes other users and raw account state',async()=>{const f=fixture();await f.configure();const d=await f.call('accounts');assert.deepEqual(d.items,[{id:'account1',toolkit:'gmail',alias:'gmail',status:'ACTIVE',logo:''}]);});
test('prepare has zero external effects, commit needs opaque proposal and is single use',async()=>{const f=fixture();await f.configure();const p=await f.prepare();assert.equal(f.requests.filter(x=>x.url.endsWith('/execute')).length,0);await assert.rejects(f.call('commit',{proposal:'guessed'}));const d=await f.call('commit',{proposal:p.proposal});assert.equal(d.ok,true);assert.equal(d.data.access_token,undefined);await assert.rejects(f.call('commit',{proposal:p.proposal}));assert.equal(f.requests.filter(x=>x.url.endsWith('/execute')).length,1);});
test('cancelled proposal is never executed',async()=>{const f=fixture();await f.configure();const p=await f.prepare();await f.call('discard',{proposal:p.proposal});await assert.rejects(f.call('commit',{proposal:p.proposal}));});
test('profile boundary cannot commit another profile proposal',async()=>{const f=fixture();await f.configure();const p=await f.prepare();await f.call('configure',{key:'ak_other_fixture_12345'},'p2');await assert.rejects(f.call('commit',{proposal:p.proposal},'p2'));assert.equal(f.requests.filter(x=>x.url.endsWith('/execute')).length,0);});
test('foreign account rejected before review and again before commit',async()=>{const f=fixture();await f.configure();const p=await f.prepare();f.wrongUser();await assert.rejects(f.call('commit',{proposal:p.proposal}),/perfil/);await assert.rejects(f.prepare(),/perfil/);});
test('schema change invalidates approval',async()=>{const f=fixture();await f.configure();const p=await f.prepare();f.setVersion('v2');await assert.rejects(f.call('commit',{proposal:p.proposal}),/cambió/);});
test('expired proposal and key rotation invalidate approval',async()=>{const f=fixture();await f.configure();const p=await f.prepare();f.expire();await assert.rejects(f.call('commit',{proposal:p.proposal}),/caducó/);const p2=await f.prepare();await f.configure();await assert.rejects(f.call('commit',{proposal:p2.proposal}));});
test('uncertain effect is durable, never retried even after restart/new task; explicit human review releases it',async()=>{const f=fixture();await f.configure();const p=await f.prepare();f.fail();const uncertain=await f.call('commit',{proposal:p.proposal});assert.equal(uncertain.ok,false);assert.equal(uncertain.receipt.status,'uncertain');assert.equal(uncertain.recovery.effect,'uncertain');const restored=new ComposioHub({vault:f.vault,fetcher:f.fetcher});await assert.rejects(restored.dispatch('p1','prepare',{tool:'GMAIL_SEND_EMAIL',account:'account1',arguments_json:'{"body":"Hola"}',scope:'another'}),/ya se intentó/);assert.equal(f.requests.filter(x=>x.url.endsWith('/execute')).length,1);const receipt=f.records.get('p1').receipts[0];await f.call('review',{id:receipt.id});await f.prepare();});
test('failed durable save prevents execution',async()=>{const f=fixture();await f.configure();const p=await f.prepare();f.failSave();await assert.rejects(f.call('commit',{proposal:p.proposal}));assert.equal(f.requests.filter(x=>x.url.endsWith('/execute')).length,0);});
test('same successful action in a task deduplicates; deliberate new task can request it again',async()=>{const f=fixture();await f.configure();const p=await f.prepare();await f.call('commit',{proposal:p.proposal});await assert.rejects(f.prepare());await f.call('prepare',{tool:'GMAIL_SEND_EMAIL',account:'account1',arguments_json:'{"body":"Hola"}',scope:'newTask'});});
test('no raw proxy, sandbox or management metatools; no credentials in tool args',async()=>{const f=fixture();await f.configure();await assert.rejects(f.call('describe',{tool:'COMPOSIO_EXECUTE_TOOL'}));await assert.rejects(f.call('prepare',{tool:'GMAIL_SEND_EMAIL',account:'account1',arguments_json:'{"api_key":"secret"}'}),/credenciales/);await assert.rejects(f.call('describe',{tool:'../../key'}));});
test('OAuth URL is restricted to exact HTTPS Composio hosts',async()=>{const f=fixture();await f.configure();assert.match((await f.call('link',{toolkit:'gmail'})).url,/https:\/\/connect.composio.dev/);f.badLink();await assert.rejects(f.call('link',{toolkit:'gmail'}),/autorización/);});
test('transport errors never expose headers or secrets and never retry',async()=>{const hub=new ComposioHub({vault:{load:async()=>({apiKey:'ak_secret_test',userId:'u'})},fetcher:async()=>{throw Error('ak_secret_test');}});await assert.rejects(hub.dispatch('p','accounts',{}),e=>!e.message.includes('ak_secret_test')&&e.message.includes('No se reintenta'));});


test('account name is local, profile-bound and survives host restart',async()=>{const f=fixture();await f.configure();const count=f.requests.length;await f.call('rename',{account:'account1',alias:'Trabajo'});assert.equal((await f.call('accounts')).items[0].alias,'Trabajo');assert.equal((await f.call('account',{account:'account1'})).alias,'Trabajo');const next=new ComposioHub({vault:f.vault,fetcher:f.fetcher});assert.equal((await next.dispatch('p1','accounts',{})).items[0].alias,'Trabajo');assert.ok(f.requests.slice(count).every(x=>!x.o.body));f.wrongUser();await assert.rejects(f.call('rename',{account:'account1',alias:'Otra'}),/perfil/);});

test('read grant binds exact account, arguments, schema and key',async()=>{const f=fixture();await f.configure();const a={tool:'GMAIL_GET_PROFILE',account:'account1',arguments_json:'{"user_id":"me"}'};const one=await f.call('prepare',a);assert.equal(typeof one.read_grant,'string');assert.equal(one.read_grant,(await f.call('prepare',a)).read_grant);assert.notEqual(one.read_grant,(await f.call('prepare',{...a,arguments_json:'{"user_id":"someoneelse"}'})).read_grant);f.setVersion('v2');assert.notEqual(one.read_grant,(await f.call('prepare',a)).read_grant);});


test('search provides complete schemas and owned accounts together; incomplete schemas need describe',async()=>{
 const f=fixture();await f.configure();const schema={type:'object',properties:{body:{type:'string'}}};
 f.schemas({GMAIL_SEND_EMAIL:{toolkit:'gmail',hasFullSchema:true,input_schema:schema},GMAIL_GET_PROFILE:{toolkit:'gmail',hasFullSchema:false,input_schema:schema},COMPOSIO_EXECUTE_TOOL:{toolkit:'composio',hasFullSchema:true,input_schema:schema}});
 const d=await f.call('search',{query:'send email'});assert.equal(d.tools.length,2);assert.deepEqual(d.tools[0].input_schema,schema);assert.equal(d.tools[0].schema_complete,true);assert.equal(d.tools[1].input_schema,undefined);assert.deepEqual(d.accounts.map(a=>a.id),['account1']);assert.equal(d.accounts_next_cursor,null);
 assert.equal(f.requests.filter(x=>new URL(x.url).pathname.includes('/tools/')).length,0);
});
test('oversized search schemas stay discoverable without claiming completeness',async()=>{
 const f=fixture();await f.configure();f.schemas({GMAIL_X:{toolkit:'gmail',hasFullSchema:true,input_schema:{type:'object',description:'x'.repeat(37000)}}});
 const d=await f.call('search',{query:'email'});assert.equal(d.tools[0].tool,'GMAIL_X');assert.equal(d.tools[0].schema_complete,undefined);assert.equal(d.tools[0].input_schema,undefined);
});
test('calendar read grants share one account scope but never cover writes, other accounts or key rotation',async()=>{
 const f=fixture();await f.configure();const prepare=(tool,account='cal1')=>f.call('prepare',{tool,account,arguments_json:'{}'});
 const first=await prepare('GOOGLECALENDAR_EVENTS_LIST');assert.equal(first.read_scope,'calendar-read-v1');
 assert.equal(first.read_grant,(await prepare('GOOGLECALENDAR_FIND_FREE_SLOTS')).read_grant);
 assert.notEqual(first.read_grant,(await prepare('GOOGLECALENDAR_EVENTS_LIST','cal2')).read_grant);
 for(const tool of ['GOOGLECALENDAR_CREATE_EVENT','GOOGLECALENDAR_UPDATE_EVENT','GOOGLECALENDAR_DELETE_EVENT','GOOGLECALENDAR_EVENTS_WATCH'])assert.equal((await prepare(tool)).read_scope,null);
 await f.call('configure',{key:'ak_new_rotation_fixture_12345'});assert.notEqual(first.read_grant,(await prepare('GOOGLECALENDAR_EVENTS_LIST')).read_grant);
});
test('calendar grant does not bypass schema recheck on commit',async()=>{
 const f=fixture();await f.configure();const p=await f.call('prepare',{tool:'GOOGLECALENDAR_EVENTS_LIST',account:'cal1',arguments_json:'{}'});f.setVersion('v2');await assert.rejects(f.call('commit',{proposal:p.proposal}),/cambió/);
});

test('mail content read grants share an account scope without inheriting profile-only grants',async()=>{
 const f=fixture();await f.configure();const prepare=(tool,args={user_id:'me'})=>f.call('prepare',{tool,account:'account1',arguments_json:JSON.stringify(args)});
 const first=await prepare('GMAIL_FETCH_EMAILS');assert.equal(first.read_scope,'gmail-read-v1');
 for(const tool of ['GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID','GMAIL_FETCH_MESSAGE_BY_THREAD_ID','GMAIL_LIST_THREADS','GMAIL_LIST_LABELS'])assert.equal(first.read_grant,(await prepare(tool)).read_grant);
 assert.notEqual(first.read_grant,(await prepare('GMAIL_GET_PROFILE')).read_grant);
 assert.equal((await prepare('GMAIL_FETCH_EMAILS',{user_id:'another-user'})).read_scope,null);
 for(const tool of ['GMAIL_SEND_EMAIL','GMAIL_CREATE_EMAIL_DRAFT','GMAIL_ADD_LABEL_TO_EMAIL','GMAIL_DELETE_MESSAGE','GMAIL_MODIFY_THREAD_LABELS'])assert.equal((await prepare(tool)).read_scope,null);
 await f.call('configure',{key:'ak_rotation_fixture_new_12345'});assert.notEqual(first.read_grant,(await prepare('GMAIL_FETCH_EMAILS')).read_grant);
});

test('successful reads can refresh in the same conversation but writes and uncertain reads stay guarded',async()=>{
 const f=fixture();await f.configure();
 for(const [tool,account] of [['GMAIL_FETCH_EMAILS','account1'],['GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS','cal1']]){
  const a={tool,account,arguments_json:'{}',scope:'same-chat'};
  for(let i=0;i<2;i++){const p=await f.call('prepare',a);assert.ok(p.read_scope);assert.equal((await f.call('commit',{proposal:p.proposal})).ok,true);}
 }
 const a={tool:'GMAIL_FETCH_EMAILS',account:'account1',arguments_json:'{"query":"new"}',scope:'same-chat'};
 const p=await f.call('prepare',a);f.fail();await f.call('commit',{proposal:p.proposal});await assert.rejects(f.call('prepare',a),/ya se intentó/);
});

test('mail read grant still revalidates the reviewed schema before execution',async()=>{
 const f=fixture();await f.configure();const p=await f.call('prepare',{tool:'GMAIL_FETCH_EMAILS',account:'account1',arguments_json:'{}'});f.setVersion('v2');await assert.rejects(f.call('commit',{proposal:p.proposal}),/cambió/);
});


test('discovery schema cache is bounded in time and never used for prepare/commit validation',async()=>{
 const f=fixture();await f.configure();const calls=()=>f.requests.filter(x=>x.url.includes('/tools/')).length;
 await f.call('describe',{tool:'GMAIL_SEND_EMAIL'});await f.call('describe',{tool:'GMAIL_SEND_EMAIL'});assert.equal(calls(),1);
 f.expire();await f.call('describe',{tool:'GMAIL_SEND_EMAIL'});assert.equal(calls(),2);
 const p=await f.prepare();assert.equal(calls(),3);f.setVersion('v2');await assert.rejects(f.call('commit',{proposal:p.proposal}),/cambió/);assert.equal(calls(),4);
 await f.call('configure',{key:'ak_rotated_fixture_987654'});await f.call('describe',{tool:'GMAIL_SEND_EMAIL'});assert.equal(calls(),5);
});

test('reads run side by side and both receipts are kept; the same change twice at once runs once',async()=>{
 const f=fixture();await f.configure();
 let active=0,most=0;
 const slow=async(url,o)=>{const exec=String(url).endsWith('/execute');if(exec){active++;most=Math.max(most,active);await new Promise(r=>setTimeout(r,40));}try{return await f.fetcher(url,o);}finally{if(exec)active--;}};
 const hub=new ComposioHub({vault:f.vault,fetcher:slow,now:()=>1000});
 const read=()=>hub.dispatch('p1','prepare',{tool:'GMAIL_FETCH_EMAILS',account:'account1',arguments_json:'{"query":"x"}',scope:'t'});
 const [a,b]=await Promise.all([read(),read()]);
 const done=await Promise.all([hub.dispatch('p1','commit',{proposal:a.proposal}),hub.dispatch('p1','commit',{proposal:b.proposal})]);
 assert.equal(most,2);
 assert.deepEqual(done.map(d=>d.ok),[true,true]);
 assert.equal(f.records.get('p1').receipts.filter(r=>r.status==='received').length,2);
 const send=()=>hub.dispatch('p1','prepare',{tool:'GMAIL_SEND_EMAIL',account:'account1',arguments_json:'{"body":"Hola"}',scope:'t2'});
 const [x,y]=await Promise.all([send(),send()]);
 const before=f.requests.filter(r=>r.url.endsWith('/execute')).length;
 const both=await Promise.allSettled([hub.dispatch('p1','commit',{proposal:x.proposal}),hub.dispatch('p1','commit',{proposal:y.proposal})]);
 assert.equal(f.requests.filter(r=>r.url.endsWith('/execute')).length-before,1);
 assert.equal(both.filter(s=>s.status==='rejected').length,1);
});

import {randomUUID,createHash} from 'node:crypto';
import calendarReads from './calendar-reads.json' with {type:'json'};
import gmailReads from './gmail-reads.json' with {type:'json'};

const BASE='https://backend.composio.dev/api/v3.1/';
const slug=value=>{if(typeof value!=='string'||!(/^[a-zA-Z0-9_-]{1,180}$/).test(value))throw Error('Identificador de aplicación no válido.');return value;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readScopeFor=(schema,args)=>schema.toolkit==='googlecalendar'&&calendarReads.includes(schema.tool)?'calendar-read-v1':schema.toolkit==='gmail'&&gmailReads.includes(schema.tool)&&(args.user_id??'me')==='me'?'gmail-read-v1':null;
const binding=profile=>({profile:slug(profile),hostId:'colmena-composio-v1',clientId:'composio',subject:'profile:'+profile});
function redact(value,secret){
 if(typeof value==='string')return value.split(secret).join('[credencial]');
 if(Array.isArray(value))return value.map(v=>redact(v,secret));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(?:access_token|refresh_token|api_key|apikey|client_secret|authorization|password|oauth_token)/i.test(k)).map(([k,v])=>[k,redact(v,secret)]));
 return value;
}
function argumentsObject(raw){
 if(typeof raw!=='string'||raw.length>24000)throw Error('Argumentos demasiado grandes o no válidos.');
 let value;try{value=JSON.parse(raw);}catch{throw Error('Los argumentos deben ser JSON válido.');}
 if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Los argumentos deben ser un objeto.');
 const check=v=>{if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(/^(?:__proto__|constructor|prototype|api_key|apikey|access_token|refresh_token|authorization|password|client_secret)$/i.test(k))throw Error('Las credenciales se introducen al conectar la app, nunca en una herramienta.');check(x);}};check(value);return value;
}
/** Private host only. UI/model never receives credentials, user identity, or commit capability. */
// Ops that only read the saved connection: they run in parallel (see dispatch).
const PARALLEL_OPS=new Set(['status','accounts','account','describe','discard','catalogue','search','prepare','commit']);
export class ComposioHub {
 constructor({vault=null,fetcher=fetch,now=Date.now}={}){this.vault=vault;this.fetcher=fetcher;this.now=now;this.queues=new Map();this.proposals=new Map();this.logos=new Map();this.schemas=new Map();}
 async logo(value){
  let url;try{url=new URL(value);}catch{return '';}
  if(url.protocol!=='https:'||!['assets.composio.dev','logos.composio.dev'].includes(url.hostname)||url.username||url.password||url.port)return '';
  if(this.logos.has(url.href))return this.logos.get(url.href);
  const job=(async()=>{try{
   const r=await this.fetcher(url.href,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(1800),headers:{Accept:'image/*'}});
   const mime=r.headers.get('content-type')?.split(';')[0];if(!r.ok||!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(mime))return '';
   const reader=r.body.getReader(),parts=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>64000){await reader.cancel();return '';}parts.push(value);}}finally{reader.releaseLock();}
   return `data:${mime};base64,${Buffer.concat(parts).toString('base64')}`;
  }catch{return '';}})();
  if(this.logos.size>=256)this.logos.delete(this.logos.keys().next().value);this.logos.set(url.href,job);return job;
 }
 // Lookups and app calls run side by side (80 emails no longer wait for each other); what
 // rewrites the saved connection (configuration, aliases, receipts) still goes one at a time.
 async dispatch(profile,op,args={}){
  binding(profile);
  if(PARALLEL_OPS.has(op))return this.handle(profile,op,args,false);
  return this.locked(profile,()=>this.handle(profile,op,args,true));
 }
 async locked(profile,fn){
  const previous=this.queues.get(profile)||Promise.resolve();
  const job=previous.catch(()=>{}).then(fn);this.queues.set(profile,job);
  try{return await job;}finally{if(this.queues.get(profile)===job)this.queues.delete(profile);}
 }
 async load(profile){if(!this.vault)throw Error('El almacén cifrado de Windows no está disponible.');return await this.vault.load(binding(profile));}
 async save(profile,c){await this.vault.save(binding(profile),c);}
 async request(c,endpoint,body,method=body?'POST':'GET'){
  let response;try{response=await this.fetcher(BASE+endpoint,{method,redirect:'error',signal:AbortSignal.timeout(45000),headers:{'x-api-key':c.apiKey,'Content-Type':'application/json',Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{})});}catch{throw Error('Composio no respondió. No se reintenta la acción automáticamente.');}
  if(!response.ok)throw Error(response.status===401?'La clave de Composio no es válida. Configúrala en Conexiones.':`Composio rechazó la petición (${response.status}). No se reintentó.`);
  let text='';const decoder=new TextDecoder();const reader=response.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});if(text.length>750000){await reader.cancel();throw Error('Respuesta de Composio demasiado grande. Acota la consulta.');}}}finally{reader.releaseLock();}
  try{return redact(text?JSON.parse(text):{},c.apiKey);}catch{throw Error('Respuesta de Composio no válida.');}
 }
 async session(profile,c,inLock=true){
  if((!c.sessionId||c.sessionPolicy!==1)&&!inLock){
   // Outside the queue: one creation per profile, saved on a fresh copy of the connection.
   this.sessionJobs??=new Map();let job=this.sessionJobs.get(profile);
   if(!job){job=this.locked(profile,async()=>{const f=(await this.load(profile))||c;await this.session(profile,f,true);return f;}).finally(()=>this.sessionJobs.delete(profile));this.sessionJobs.set(profile,job);}
   const f=await job;c.sessionId=f.sessionId;c.sessionPolicy=f.sessionPolicy;
  }
  if(!c.sessionId||c.sessionPolicy!==1){const d=await this.request(c,'tool_router/session',{user_id:c.userId,instant:false,multi_account:{enable:true,require_explicit_selection:true},workbench:{enable:false,enable_proxy_execution:false},execute:{enable_multi_execute:false},manage_connections:{enable:true,enable_wait_for_connections:false,enable_connection_removal:false}});if(d.config?.instant!==false||d.config?.workbench?.enable!==false||d.config?.multi_account?.enable!==true||d.config?.multi_account?.require_explicit_selection!==true)throw Error('Composio no confirmó la política de esta sesión.');c.sessionId=slug(d.session_id);c.sessionPolicy=1;await this.save(profile,c);}
  return 'tool_router/session/'+slug(c.sessionId);
 }
 async accounts(c,cursor='',includeLogos=true){
  const q=new URLSearchParams({user_ids:c.userId,limit:'50',...(cursor?{cursor}: {})});const d=await this.request(c,'connected_accounts?'+q);
  return {items:await Promise.all((d.items||[]).filter(x=>x.user_id===c.userId).map(async x=>({id:x.id,toolkit:x.toolkit?.slug,alias:c.aliases?.[x.id]||x.alias||x.toolkit?.slug,status:x.status,logo:includeLogos?await this.logo(x.toolkit?.logo||x.toolkit?.meta?.logo):''}))),next_cursor:d.next_cursor||null};
 }
 async ownedAccount(c,id,toolkit){
  const d=await this.request(c,'connected_accounts/'+slug(id));
  if(d.user_id!==c.userId||toolkit&&d.toolkit?.slug!==toolkit)throw Error('Esta cuenta no pertenece a la app y al perfil actuales.');
  return {id:d.id,toolkit:d.toolkit?.slug,alias:c.aliases?.[d.id]||d.alias||d.toolkit?.slug,status:d.status};
 }
 async describe(c,id,cached=false){
  const key=digest([c.userId,digest(c.apiKey),slug(id)]),entry=this.schemas.get(key);
  if(cached&&entry&&this.now()-entry.at<60000)return structuredClone(entry.value);
  const d=await this.request(c,'tools/'+slug(id));
  if(d.slug!==id||!d.toolkit?.slug||/^composio(?:_|$)/i.test(d.toolkit.slug)||/^COMPOSIO_/i.test(id)||d.is_deprecated||d.deprecated===true)throw Error('Herramienta no disponible para este agente.');
  if(JSON.stringify(d.input_parameters).length>36000)throw Error('Esquema demasiado grande. Elige una herramienta más concreta.');
  const value={tool:d.slug,name:d.name,toolkit:d.toolkit.slug,description:String(d.description||'').slice(0,4000),input_schema:d.input_parameters,version:d.version,no_auth:d.no_auth===true};
  if(this.schemas.size>=128)this.schemas.delete(this.schemas.keys().next().value);this.schemas.set(key,{at:this.now(),value:structuredClone(value)});return value;
 }
 async handle(profile,op,a,inLock=true){
  let c=await this.load(profile);
  if(op==='status')return {configured:!!c?.apiKey,provider:'Composio',receipts:[...(c?.receipts||[]).filter(r=>r.status==='uncertain').reverse(),...(c?.receipts||[]).filter(r=>r.status!=='uncertain').slice(-12).reverse()].map(({fingerprint,scope,...r})=>r)};
  if(op==='configure'){
   if(typeof a.key!=='string'||!/^ak_[A-Za-z0-9_-]{10,200}$/.test(a.key))throw Error('Clave de Composio no válida.');
   // Validate before replacing a working configuration. Keep stable identity on key rotation.
   const candidate={...c,apiKey:a.key,userId:c?.userId||'colmena_'+randomUUID().replaceAll('-',''),sessionId:null};
   await this.request(candidate,'toolkits?limit=1');await this.save(profile,candidate);this.clearProposals(profile);return {configured:true};
  }
  if(!c?.apiKey)throw Error('Conecta Composio en Ajustes → Conexiones.');
  if(op==='review'){const r=(c.receipts||[]).find(r=>r.id===a.id);if(!r)throw Error('Registro no encontrado.');r.status='reviewed';await this.save(profile,c);return {reviewed:true};}
  if(op==='accounts')return this.accounts(c,String(a.cursor||'').slice(0,2000));
  if(op==='account')return this.ownedAccount(c,a.account);
  if(op==='rename'){
   const account=await this.ownedAccount(c,a.account);if(account.status!=='ACTIVE')throw Error('La app todavía no está conectada.');
   if(typeof a.alias!=='string'||!a.alias.trim()||a.alias.length>80)throw Error('Escribe un nombre para esta cuenta.');
   c.aliases={...c.aliases,[account.id]:a.alias.trim()};await this.save(profile,c);return {renamed:true};
  }
  if(op==='disconnect'){
   const account=await this.ownedAccount(c,a.account);await this.request(c,'connected_accounts/'+slug(account.id),null,'DELETE');this.clearProposals(profile);return {disconnected:true};
  }
  if(op==='describe')return this.describe(c,a.tool,true);
  if(op==='discard'){const p=this.proposals.get(a.proposal);if(p?.profile===profile)this.proposals.delete(a.proposal);return {discarded:true};}
  if(op==='commit'){
   const p=this.proposals.get(a.proposal);this.proposals.delete(a.proposal);
   if(!p||p.profile!==profile||p.expires<this.now()||p.keyHash!==digest(c.apiKey)||p.sessionId!==c.sessionId)throw Error('La propuesta caducó o cambió la conexión. No se ejecutó.');
   const [schema,account]=await Promise.all([this.describe(c,p.tool),p.account?this.ownedAccount(c,p.account,p.toolkit):null]);
   if(digest(schema)!==p.schemaHash)throw Error('La herramienta cambió después de revisarla. Vuelve a preparar la acción.');
   if(account&&account.status!=='ACTIVE')throw Error('Reconecta esta cuenta antes de actuar.');
   const repeatableRead=!!readScopeFor(schema,p.arguments);
   if((c.receipts||[]).some(r=>r.fingerprint===p.fingerprint&&(r.status==='uncertain'||!repeatableRead&&r.status==='received'&&r.scope===p.scope)))throw Error('Esta misma acción ya se intentó. Revisa su resultado en la app antes de repetirla.');
   const receipt={id:randomUUID(),tool:p.tool,account:p.account,at:this.now(),status:'uncertain',fingerprint:p.fingerprint,scope:p.scope};
   // The same change twice at once never runs (reads may: they only look).
   this.inflight??=new Set();
   if(!repeatableRead&&this.inflight.has(p.fingerprint))throw Error('Esta misma acción ya está en curso. Espera su resultado.');
   if(!repeatableRead)this.inflight.add(p.fingerprint);
   try{
    // Durable BEFORE effect (a restart must not repeat it), written one at a time on a fresh copy.
    await this.locked(profile,async()=>{
     const f=(await this.load(profile))||c;
     // A read still running here is not a doubt: the same read may go alongside it.
     if((f.receipts||[]).some(r=>r.fingerprint===p.fingerprint&&(r.status==='uncertain'&&!(repeatableRead&&this.running?.has(r.id))||!repeatableRead&&r.status==='received'&&r.scope===p.scope)))throw Error('Esta misma acción ya se intentó. Revisa su resultado en la app antes de repetirla.');
     const uncertain=(f.receipts||[]).filter(r=>r.status==='uncertain');if(uncertain.length>=40)throw Error('Revisa las operaciones sin confirmar en Conexiones antes de continuar.');
     f.receipts=[...(f.receipts||[]).filter(r=>r.status!=='uncertain').slice(-40),...uncertain,receipt];await this.save(profile,f);
     (this.running??=new Set()).add(receipt.id);
    });
    try{
     const result=await this.request(c,await this.session(profile,c,inLock)+'/execute',{tool_slug:p.tool,arguments:p.arguments,...(p.account?{account:p.account}:{}),enable_auto_workbench_offload:false});
     receipt.status=result.error||result.data?.error||result.data?.successful===false?'uncertain':'received';receipt.log_id=result.log_id||null;
     await this.locked(profile,async()=>{const f=(await this.load(profile))||c;f.receipts=(f.receipts||[]).map(r=>r.id===receipt.id?{...r,status:receipt.status,log_id:receipt.log_id}:r);await this.save(profile,f);});
     const output=JSON.stringify(result.data??{});return {ok:receipt.status==='received',receipt:{id:receipt.id,tool:receipt.tool,status:receipt.status,log_id:receipt.log_id},data:output.length<=80000?result.data:{preview:output.slice(0,78000),truncated:true},...(result.error?{error:'La app devolvió un error. Comprueba el resultado antes de repetir.'}:{})};
    }catch(e){return {ok:false,receipt:{id:receipt.id,tool:receipt.tool,status:'uncertain',log_id:receipt.log_id||null},error:e.message+' El resultado externo queda sin confirmar; consulta la app antes de repetir.',recovery:{effect:'uncertain',kind:'app'}};}
   }finally{if(!repeatableRead)this.inflight.delete(p.fingerprint);this.running?.delete(receipt.id);}
  }
  const session=await this.session(profile,c,inLock);
  if(op==='catalogue'){
   const categories={mail:['Email','Calendar'],documents:['Documents','File Management & Storage','Spreadsheets','Notes'],team:['Team Collaboration','Team Chat'],development:['Developer Tools','Databases']};
   const filters=categories[a.category]||[''];let cursors={};if(a.cursor){try{cursors=JSON.parse(Buffer.from(String(a.cursor).slice(0,12000),'base64url').toString());if(!cursors||Array.isArray(cursors)||typeof cursors!=='object')throw Error();}catch{throw Error('Página de catálogo no válida.');}}
   const pages=await Promise.all(filters.map(async category=>{
    if(a.cursor&&cursors[category]===null)return {items:[],next_cursor:null};
    const q=new URLSearchParams({limit:filters.length>1?'12':'24',sort_by:'usage',...(category?{category}:{}),...(a.query?{search:String(a.query).slice(0,200)}:{}),...(cursors[category]?{cursor:String(cursors[category]).slice(0,2000)}:{})});
    return this.request(c,'toolkits?'+q);
   }));
   const raw=[...new Map(pages.flatMap(d=>d.items||[]).filter(x=>!/^composio(?:_|$)/i.test(x.slug)).map(x=>[x.slug,x])).values()];const items=[];
   for(let i=0;i<raw.length;i+=8)items.push(...await Promise.all(raw.slice(i,i+8).map(async x=>({slug:x.slug,name:x.name,description:String(x.meta?.description||'').slice(0,300),logo:await this.logo(x.meta?.logo),categories:x.meta?.categories||[],no_auth:x.no_auth===true||x.is_no_auth===true||x.meta?.isNoAuth===true,managed:!!x.composio_managed_auth_schemes?.length}))));
   const next=Object.fromEntries(filters.map((cat,i)=>[cat,pages[i].next_cursor||null]));return {items,next_cursor:Object.values(next).some(Boolean)?Buffer.from(JSON.stringify(next)).toString('base64url'):null};
  }
  if(op==='link'){
   const d=await this.request(c,session+'/link',{toolkit:slug(a.toolkit),...(a.alias?{alias:String(a.alias).slice(0,80)}:{})});let u;try{u=new URL(d.redirect_url);}catch{}
   if(!u||u.protocol!=='https:'||!['connect.composio.dev','app.composio.dev'].includes(u.hostname)||u.port||u.username||u.password)throw Error('Composio devolvió un enlace de autorización no admitido.');
   return {url:u.href};
  }
  if(op==='search'){
   if(typeof a.query!=='string'||!a.query.trim()||a.query.length>1200)throw Error('Describe brevemente qué necesitas hacer.');
   const [d,accounts]=await Promise.all([this.request(c,session+'/search',{queries:[{use_case:a.query}],search_strategy:'tool_search'}),this.accounts(c,'',false)]);
   if(d.success===false)throw Error('Composio no pudo buscar herramientas. Inténtalo con una consulta más concreta.');
   let budget=90000;
   const tools=Object.entries(d.tool_schemas||{}).slice(0,12).filter(([id,x])=>!/^COMPOSIO_/i.test(x.tool_slug||id)&&!/^composio(?:_|$)/i.test(x.toolkit||'')).map(([id,x])=>{
    const tool={tool:x.tool_slug||id,toolkit:x.toolkit,description:String(x.description||'').slice(0,700)};
    const size=JSON.stringify(x.input_schema||{}).length;
    if(x.hasFullSchema===true&&x.input_schema?.type==='object'&&size<=36000&&size<=budget){tool.input_schema=x.input_schema;tool.schema_complete=true;budget-=size;}
    return tool;
   });
   return {tools,accounts:accounts.items,accounts_next_cursor:accounts.next_cursor,connections:(d.toolkit_connection_statuses||[]).map(x=>({toolkit:x.toolkit,connected:x.has_active_connection})),next:'Si la herramienta incluye schema_complete:true, ya tienes su esquema: úsalo sin volver a describirla. Usa la cuenta de accounts; consulta más cuentas solo si hay paginación o falta la solicitada. Si falta el esquema completo, llama a apps_describe.'};
  }
  if(op==='prepare'){
   const args=argumentsObject(a.arguments_json);
   const [schema,account]=await Promise.all([this.describe(c,a.tool),a.account?this.ownedAccount(c,a.account):null]);
   if(!schema.no_auth&&!account)throw Error('Elige una cuenta conectada para esta app.');
   if(account&&account.toolkit!==schema.toolkit)throw Error('Esta cuenta no pertenece a la app y al perfil actuales.');
   if(account&&account.status!=='ACTIVE')throw Error('Reconecta esta cuenta en Ajustes → Conexiones.');
   const id=randomUUID(),fingerprint=digest([a.tool,account?.id||'',args]);
   const readScope=account?readScopeFor(schema,args):null;
   if((c.receipts||[]).some(r=>r.fingerprint===fingerprint&&(r.status==='uncertain'||!readScope&&r.status==='received'&&r.scope===a.scope)))throw Error('Esta acción ya se intentó. Consulta el resultado en la app; no se repetirá automáticamente.');
   for(const [key,p] of this.proposals)if(p.expires<this.now())this.proposals.delete(key);
   this.proposals.set(id,{profile,tool:a.tool,toolkit:schema.toolkit,account:account?.id||'',arguments:args,schemaHash:digest(schema),keyHash:digest(c.apiKey),sessionId:c.sessionId,expires:this.now()+120000,fingerprint,scope:String(a.scope||'').slice(0,100)});
   return {proposal:id,name:schema.name,tool:schema.tool,toolkit:schema.toolkit,account:account?account.alias+' · '+account.id:'Sin cuenta',account_alias:account?.alias||'Sin cuenta',read_scope:readScope,read_grant:account?digest(readScope?[account.id,readScope,digest(c.apiKey)]:[account.id,digest(schema),digest(args),digest(c.apiKey)]):null,arguments:args};
  }
  throw Error('Operación de conexión no permitida.');
 }
 clearProposals(profile){for(const [key,p] of this.proposals)if(p.profile===profile)this.proposals.delete(key);}
}

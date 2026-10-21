/* Original DC templates and logic own the presentation. This layer supplies real data/actions. */
window.__resources = {};
window.ColmenaScreens = (() => {
  let logic, screen, csrf, source, busy=false, error='', queued, hydrated=false;
  let state={bots:[],missions:[],approvals:[],automations:[],artifacts:[],skills:[],memories:[],settings:{}}, detail=null;
  let prompt='', message='', attachments=[], search='', templateQuery='', libraryQuery='', fileType=0, inboxFilter=0, selectedApprovalId='', selectedRuleId='';
  let instructions=null, rulePrompt=null, trialPrompt='', trialAnswer='', trialBusy=false, choice='';
  let draft={name:'',role:'',instructions:'',request:''};
  const stream=new Map(), params=new URLSearchParams(location.search);
  const seeds=[['atlas','Atlas','Coordinador','#FFC93C','hex'],['nora','Nora','Investigación','#2F6BFF','circle'],['tomas','Tomás','Datos y finanzas','#0B8A5F','square'],['iris','Iris','Diseño','#FF5CA8','diamond'],['bruno','Bruno','Código','#FF7A1A','arch'],['vera','Vera','Redacción','#7B4DFF','leaf']];
  const labels={running:'En marcha',waiting:'Te espera',paused:'En pausa',blocked:'Bloqueada',queued:'Pendiente',completed:'Terminada',cancelled:'Cancelada',awaiting_choice:'Elige una propuesta',pending:'Pendiente',approved:'Aprobada',denied:'Denegada',executed:'Resuelta',executing:'Ejecutando',scheduled:'Programada'};
  const modes={solo:'Un bot',equipo:'Equipo · coordina Atlas',debate:'Debate'};
  const link=(page, args={})=>'/screens/'+page+'.dc.html'+(Object.keys(args).length?'?'+new URLSearchParams(args):'');
  const go=(page,args)=>location.assign(link(page,args));
  const date=value=>value?new Date(value).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const time=value=>value?new Date(value).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'';
  const download=(title,content)=>{const url=URL.createObjectURL(new Blob([content||''],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=title||'entregable.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const keyAction=fn=>e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn(e);}};
  function repaint(){logic?.setState({liveRevision:(logic.state.liveRevision||0)+1});if(error)setTimeout(()=>{const el=document.querySelector('[data-app-notice]')||document.querySelector('[aria-labelledby="prueba"] h2');if(el){el.textContent=error;el.setAttribute('role','status');}},0);}
  async function api(path,method='GET',body){
    if(method!=='GET'&&!csrf)csrf=(await(await fetch('/api/bootstrap')).json()).csrf;
    const r=await fetch('/api'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Colmena-Token':csrf},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo completar la operación.');return data;
  }
  async function act(fn){if(busy)return;busy=true;error='';try{const result=await fn();await reload();return result;}catch(e){error=e.message;}finally{busy=false;document.documentElement.dataset.colmenaReady='true';repaint();}}
  function bot(id){
    const seed=seeds.find(b=>b[0]===id)||seeds[1];
    const b=state.bots.find(b=>b.id===id)||{id:seed[0],name:seed[1],role:seed[2],color:seed[3],shape:seed[4],instructions:''};
    const missions=state.missions.filter(m=>m.botIds?.includes(b.id)&&!['completed','cancelled'].includes(m.status));
    const status=missions.some(m=>m.status==='running')?'Trabaja':missions.some(m=>m.status==='waiting')?'Te espera':'Libre';
    return {...b,initial:b.name?.[0]||'?',ink:['#FFC93C','#FF5CA8','#FF7A1A'].includes(b.color)?'#12131A':'#FFFFFF',
      radius:({circle:'50%',square:'22%',arch:'50% 50% 18% 18%',leaf:'50% 12% 50% 12%'})[b.shape]||'0',
      clip:({hex:'polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)',diamond:'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)'})[b.shape]||'none',
      statusLabel:b.enabled===false?'Desactivado':status,statusColor:status==='Trabaja'?'#3DDC97':status==='Te espera'?'#FFC93C':'#8C91A0',missionLabel:`En ${missions.length} salas`,chatUrl:link('Chat',{bot:b.id}),profileUrl:link('Bot',{bot:b.id})};
  }
  const user={name:'Tú',initial:'TÚ',color:'#E6E8EE',ink:'#12131A',radius:'50%',clip:'none'};
  function mission(m){const bots=(m.botIds||[]).map(bot);const pending=state.approvals.filter(a=>a.missionId===m.id&&a.status==='pending');return {...m,bots,owner:bots.map(b=>b.name).join(', '),
    modeLabel:modes[m.mode]||m.mode,statusLabel:m.error||labels[m.status]||m.status,subtitle:m.error||`${modes[m.mode]||''} · ${labels[m.status]||m.status||''}`,
    date:date(m.createdAt),approvalLabel:pending.length?`${pending.length} por revisar`:'',progressColor:m.status==='completed'?'#FFC93C':m.status==='running'?'#12131A':'#DCE0E8',
    roomUrl:link(m.mode==='solo'?'Chat':m.mode==='debate'&&m.status==='awaiting_choice'?'Debate':'Sala',m.mode==='solo'?{id:m.id,bot:m.botIds[0]}:{id:m.id}),url:link('Mision',{id:m.id}),
    navBg:params.get('id')===m.id?'#FFC93C':'transparent',navInk:params.get('id')===m.id?'#12131A':'#CFD4E0',
    canResume:['paused','blocked'].includes(m.status),dragStart:e=>e.dataTransfer.setData('text/plain',m.id),
    open:()=>go('Mision',{id:m.id}),keyOpen:keyAction(()=>go('Mision',{id:m.id}))};}
  function approval(a){const b=bot(a.botId),m=state.missions.find(m=>m.id===a.missionId);const summary=a.tool==='write_file'?'Crear '+a.args.path:a.tool==='remember'?a.args.text:a.review?.name||'Revisar acción';
    const reviewUrl=a.tool==='apps_execute'?(a.kind==='send'?link('EditarEnvio',{approval:a.id,view:'confirmar'}):'/connections/Permissions.dc.html?approval='+encodeURIComponent(a.id)):link('Bandeja',{approval:a.id});
    return {...a,bot:b,summary,kind:a.tool==='apps_execute'?'Envío / lectura':'Permiso',context:b.name+' · '+(m?.title||''),statusLabel:labels[a.status]||a.status,time:time(a.decidedAt||a.createdAt),reviewUrl,
      review:()=>{if(a.tool==='apps_execute')location.assign(reviewUrl);else {selectedApprovalId=a.id;repaint();document.querySelector('aside')?.scrollIntoView({block:'nearest'});}},
      cannotEdit:a.kind!=='send',edit:()=>go('EditarEnvio',{approval:a.id}),
      deny:()=>act(()=>api(a.tool==='apps_execute'?'/connections/review/'+encodeURIComponent(a.id):'/approvals/'+encodeURIComponent(a.id),'POST',{decision:'denied'}))};}
  async function reload(){
    state=await api('/state');
    let id=params.get('id');
    if(screen==='Chat'&&!id&&!params.has('new'))id=[...state.missions].reverse().find(m=>m.mode==='solo'&&m.botIds?.[0]===(params.get('bot')||'nora'))?.id;
    if(id)detail=await api('/missions/'+encodeURIComponent(id));
    else detail=null;
    if(!hydrated){hydrated=true;const b=bot(params.get('bot')||'nora');if(screen==='Bot'&&b.personality)logic.setState(b.personality);
      if(screen==='NuevoBotAjusta') {try{draft=JSON.parse(sessionStorage.getItem('colmena-bot-draft'))||draft;}catch{}if(draft.shape)logic.setState({shape:draft.shape,color:draft.color});}
    }
    await window.ColmenaAdded?.reload(context());
    repaint();
  }
  function attach(){const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.txt,.md,.csv,.json,.html,.js,.css,.xml,.yaml,.yml';input.onchange=()=>act(async()=>{
    if(input.files.length>5)throw Error('Máximo cinco archivos de texto.');
    const files=[];for(const file of input.files){if(file.size>200000)throw Error('El archivo supera 200 KB.');files.push({name:file.name,content:await file.text()});}attachments=files;
  });input.click();}
  async function createMission(mode, text, ids, conversation=false){
    if(!text.trim())throw Error('Escribe el encargo antes de empezar.');
    const m=await api('/missions','POST',{prompt:text,mode,botIds:ids,conversation,attachments});attachments=[];
    go(mode==='solo'?'Chat':'Sala',mode==='solo'?{bot:ids[0],id:m.id}:{id:m.id});
  }
  const shapeKeys={circulo:'circle',cuadrado:'square',hexagono:'hex',rombo:'diamond',arco:'arch',hoja:'leaf'};
  function draftData(){return {name:draft.name.trim(),role:draft.role.trim(),instructions:draft.instructions.trim(),color:logic.renderVals().av.bg,shape:shapeKeys[logic.state.shape]||'circle',audience:draft.audience||'equipo'};}
  function context(){return {state,screen,params,logic,api,act,go,link,bot,repaint,attachments,draft,download,ruleId:selectedRuleId,setError:value=>{error=value;repaint();}};}
  async function trial(){if(trialBusy)return;trialBusy=true;trialAnswer='';repaint();try{const response=await api('/bots/preview','POST',{instructions:draft.instructions,prompt:trialPrompt});trialAnswer=response.text;}catch(e){trialAnswer=e.message;}finally{trialBusy=false;repaint();}}
  function values(instance, original){
    const allBots=Object.fromEntries([...seeds.map(s=>s[0]),...state.bots.map(b=>b.id)].map(id=>[id,bot(id)]));
    const b=bot(params.get('bot')||'nora'), missions=state.missions.map(mission), m=detail?mission(detail):{id:'',title:'',subtitle:'',statusLabel:'Sin misión seleccionada',bots:[]};
    const pending=state.approvals.filter(a=>a.status==='pending').map(approval),resolved=state.approvals.filter(a=>a.status!=='pending').map(approval);
    let selected=state.approvals.find(a=>a.id===(selectedApprovalId||params.get('approval')))||state.approvals.find(a=>a.status==='pending');
    const records=detail?.messages||[];
    const messages=records.map(x=>({...x,bot:x.role==='user'?user:bot(x.botId),time:time(x.at),activity:'Actividad de la misión',
      copy:()=>act(()=>navigator.clipboard.writeText(x.text)),remember:()=>act(()=>api('/memories','POST',{text:x.text.slice(0,2000)}))}));
    for(const [stepId,text] of stream){const step=detail?.steps?.find(s=>s.id===stepId);if(step?.status==='running'&&text)messages.push({id:stepId,text,bot:bot(step.botId),time:'En directo',activity:'En directo'});}
    const steps=(detail?.steps||[]).map(s=>({...s,bot:bot(s.botId),title:({plan:'Plan',solo:'Respuesta',work:'Trabajo',proposal:'Propuesta',critique:'Crítica',synthesis:'Síntesis',followup:'Continuación'})[s.kind]||s.kind,statusLabel:labels[s.status]||s.status}));
    const liveSteps=steps.map(s=>{const liveText=s.text||stream.get(s.id)||'';return {...s,liveText,noText:!liveText,wordLabel:liveText.trim()?liveText.trim().split(/\s+/).length+' palabras':'En espera',download:()=>download(s.bot.name+'.txt',liveText),closer:()=>{message='@'+s.bot.name+' Reescribe tu respuesta con un tono más cercano.';const input=document.querySelector('[data-field="message"]');if(input){input.value=message;input.focus();}},shorter:()=>{message='@'+s.bot.name+' Acorta tu respuesta sin perder información importante.';const input=document.querySelector('[data-field="message"]');if(input){input.value=message;input.focus();}}};});
    const events=(detail?.events||[]).map(ev=>({...ev,text:ev.text||ev.type,time:time(ev.at)}));
    const start=Date.parse(detail?.createdAt)||Date.now(),end=Math.max(start+1,...(detail?.events||[]).map(e=>Date.parse(e.at)||start));
    const tick=n=>new Date(start+(end-start)*n).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const timelineSteps=steps.map(s=>{const a=detail?.events.find(e=>e.type==='bot_started'&&e.stepId===s.id),b=detail?.events.findLast(e=>e.type==='bot_completed'&&e.stepId===s.id);const from=a?Math.max(2,Math.min(12,2+Math.floor((Date.parse(a.at)-start)/(end-start)*12))):12,to=b?Math.min(14,Math.max(from+2,2+Math.ceil((Date.parse(b.at)-start)/(end-start)*12))):14;return {...s,columns:from+' / '+to,background:s.status==='completed'?'#D6DAE3':s.status==='waiting'?'#FFC93C':'#FFFFFF',border:s.status==='pending'?'1.5px dashed #8C91A0':s.status==='running'||s.status==='waiting'?'2px solid #12131A':'0'};});
    const artifacts=state.artifacts.map(a=>({...a,date:date(a.createdAt),subtitle:(a.kind==='file'?'Archivo':'Documento')+' · '+(state.missions.find(m=>m.id===a.missionId)?.title||''),download:e=>{e?.preventDefault?.();download(a.title,a.content);},keyDownload:keyAction(()=>download(a.title,a.content))}));
    const missionArtifacts=artifacts.filter(a=>a.missionId===detail?.id),artifact=missionArtifacts.at(-1);
    const memories=state.memories.filter(mem=>mem.active).map(mem=>({...mem,source:'Compartido · '+date(mem.createdAt),remove:()=>act(()=>api('/memories/'+encodeURIComponent(mem.id),'PATCH',{active:false}))}));
    const skills=state.skills.map(s=>({...s,bot:bot(s.botId||'atlas'),description:`${s.status} · versión ${s.version} · ${s.description||''}`,profileUrl:link('Bot',{bot:s.botId||'atlas'}),review:()=>download(s.name+'.md',s.content)}));
    const rules=state.automations.map(r=>({...r,track:r.enabled?'#12131A':'#DCE0E8',knob:r.enabled?'#FFC93C':'#FFFFFF',justify:r.enabled?'flex-end':'flex-start',bot:bot(r.botId),title:r.name,modeLabel:'Automatización',owner:bot(r.botId).name,bots:[bot(r.botId)],url:link('Automatizaciones',{rule:r.id}),
      date:date(r.nextRun),time:time(r.nextRun),stateLabel:r.enabled?labels[r.state]||r.state:'En pausa',subtitle:`Cada ${r.intervalMinutes} minutos · ${r.enabled?'Activa':'En pausa'} · ${date(r.nextRun)}`,
      schedule:'Cada '+r.intervalMinutes+' minutos',toggle:()=>act(()=>api('/automations/'+encodeURIComponent(r.id),'PATCH',{enabled:!r.enabled})),select:()=>{selectedRuleId=r.id;rulePrompt=null;repaint();},keySelect:keyAction(()=>{selectedRuleId=r.id;rulePrompt=null;repaint();})}));
    const rule=rules.find(r=>r.id===(selectedRuleId||params.get('rule')))||rules[0];
    const filteredMissions=missions.filter(m=>!search||m.title.toLowerCase().includes(search.toLowerCase()));
    const columns=[filteredMissions.filter(m=>['waiting','awaiting_choice','blocked','paused'].includes(m.status)),filteredMissions.filter(m=>['running','queued'].includes(m.status)),rules,filteredMissions.filter(m=>['completed','cancelled'].includes(m.status))];
    const proposals=steps.filter(s=>s.kind==='proposal').map((s,i)=>{const letter=String.fromCharCode(65+i),on=choice===s.botId;return {...s,label:'Propuesta '+letter+' · '+s.bot.name,summary:s.statusLabel,critiques:steps.filter(c=>c.kind==='critique').map(c=>({bot:c.bot,text:c.text})),selected:on,choiceLabel:on?'Elegida':'Elegir '+letter,pick:()=>{choice=s.botId;repaint();},border:on?'2px solid #12131A':'1px solid #DCE0E8',shadow:on?'6px 6px 0 #FFC93C':'none'};});
    const running=state.missions.filter(m=>m.status==='running');
    const vals={...original,busy,bots:allBots,bot:{...b,instructions:instructions??b.instructions},mission:m,steps,liveSteps,timelineSteps,timelineTick0:tick(0),timelineTick1:tick(1/3),timelineTick2:tick(2/3),timelineNow:tick(1),timelineMarker:'calc(168px + (100% - 168px) * 0.9)',events,messages,messagePlaceholder:screen==='Chat'?'Mensaje a '+b.name:'Mensaje a #'+m.title,
      userMessages:messages.filter(m=>m.bot===user),assistantMessages:messages.filter(m=>m.bot!==user),
      pendingCount:pending.length,missionCount:missions.filter(m=>!['completed','cancelled'].includes(m.status)).length,
      navMissions:missions.filter(m=>!['completed','cancelled'].includes(m.status)).slice(-8),homeMissions:filteredMissions.filter(m=>!['completed','cancelled'].includes(m.status)),
      customBots:state.bots.filter(b=>!seeds.some(s=>s[0]===b.id)).map(b=>bot(b.id)),workingCount:running.length,freeCount:Object.values(allBots).filter(b=>b.statusLabel==='Libre').length,
      today:new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'}),
      greeting:running.length?`Tu equipo lleva ${running.length} misiones en marcha.`:'Tu equipo está listo.',
      teamSummary:`${state.bots.length} bots · ${running.length} misiones en marcha`,pendingApprovals:pending,scheduled:rules.filter(r=>r.enabled),
      inboxSummary:`${pending.length} cosas te esperan. Todo lo demás sigue su curso.`,
      inboxItems:inboxFilter===4?[]:pending.filter(a=>inboxFilter===0||inboxFilter===2&&a.tool==='apps_execute'||inboxFilter===3&&a.tool!=='apps_execute'),resolvedApprovals:resolved,
      selectedApproval:!!selected,previewTitle:selected?.tool==='write_file'?'Archivo propuesto':selected?.tool==='remember'?'Recuerdo propuesto':'Vista previa · lo que se enviará',
      previewPosition:selected?date(selected.createdAt):'',previewRecipient:selected?.review?.arguments.recipient_email||'Colmena · almacenamiento local',
      previewSubject:selected?.args.path||selected?.review?.arguments.subject||'Memoria compartida',previewBody:selected?.args.content||selected?.args.text||JSON.stringify(selected?.review?.arguments||{},null,2),
      previewContext:selected?bot(selected.botId).name+' · '+(labels[selected.status]||selected.status):'',
      selectedLocalPending:!!selected&&selected.status==='pending'&&selected.tool!=='apps_execute',
      approveSelected:()=>act(()=>api('/approvals/'+encodeURIComponent(selected.id),'POST',{decision:'approved'})),
      missionPending:pending.some(a=>a.missionId===m.id),missionPendingLabel:pending.filter(a=>a.missionId===m.id).map(a=>a.summary).join(' · '),memberCount:m.bots.length+1,
      stepProgress:steps.filter(s=>s.status==='completed').length+'/'+steps.length,threadCount:messages.filter(m=>m.bot!==user).length+' respuestas',
      controlLabel:['paused','blocked'].includes(m.status)?'Reanudar misión':'Pausar a todos los bots de la sala',
      controlMission:()=>act(()=>api('/missions/'+m.id+'/control','POST',{action:['paused','blocked'].includes(m.status)?'resume':'pause'})),
      rules,selectedRule:!!rule,rule,ruleHistory:missions.filter(m=>m.automationId===rule?.id),rulePromptInput:e=>{rulePrompt=e.currentTarget.textContent;},
      saveRule:()=>act(()=>api('/automations/'+encodeURIComponent(rule.id),'PATCH',{prompt:rulePrompt??rule.prompt})),
      proposals,debateSummary:m.statusLabel,choiceSummary:choice?'Has elegido '+bot(choice).name+'.':'Elige una propuesta.',
      confirmChoice:e=>{e.preventDefault();return act(async()=>{if(!choice)throw Error('Elige una propuesta.');await api('/missions/'+m.id+'/choose','POST',{botId:choice});go('Sala',{id:m.id});});},
      missionArtifactCount:missionArtifacts.length,missionArtifacts,artifacts:artifacts.filter(a=>(!libraryQuery||(a.title+' '+a.content).toLowerCase().includes(libraryQuery.toLowerCase()))&&(fileType===0||fileType===1&&(a.kind==='document'||/\.(md|txt)$/i.test(a.title))||fileType===2&&/\.(csv|tsv|xlsx?)$/i.test(a.title)||fileType===3&&/\.(pptx?|odp)$/i.test(a.title)||fileType===4&&/\.(svg|png|jpe?g|webp)$/i.test(a.title)||fileType===5&&/\.(js|mjs|ts|jsx|tsx|py|html|css|json|yaml)$/i.test(a.title))),
      hasArtifact:!!artifact,panelOpen:!!original.panelOpen&&!!artifact,artifactTitle:artifact?.title||'',artifactSubtitle:artifact?.subtitle||'',artifactContent:artifact?.content||'',
      copyArtifact:()=>act(()=>navigator.clipboard.writeText(artifact?.content||'')),downloadArtifact:()=>artifact?.download(),
      memories,pendingSkills:skills.filter(s=>s.status==='pending'),activeSkills:skills.filter(s=>s.status==='active'),pendingSkillsCount:skills.filter(s=>s.status==='pending').length,
      focusFiles:()=>{fileType=0;libraryQuery='';repaint();document.querySelector('main')?.scrollIntoView();},
      memoryHeading:'Lo que '+b.name+' recuerda',focusMemories:()=>document.querySelector('[aria-labelledby="memoria"]')?.scrollIntoView(),focusSkills:()=>document.querySelector('[aria-labelledby="revisar"]')?.scrollIntoView(),
      librarySearch:e=>{libraryQuery=e.target.value;repaint();},
      urls:Object.fromEntries(['Sala','Mision','Debate','EnVivo'].map(p=>[p,detail?link(p,{id:detail.id}):link('Misiones')])),
      chatLabel:'Conversación con '+b.name,conversationTitle:detail?.title||'Nueva conversación',newConversation:()=>go('Chat',{bot:b.id,new:'1'}),
      newMission:()=>go('Main'),team:()=>go('Equipo'),connections:()=>location.assign('/connections/Connections.dc.html'),
      promptInput:e=>{prompt=e.target.value;},messageInput:e=>{message=e.target.value;},
      startMission:e=>{e.preventDefault();return act(()=>{const mode=instance.state.mode||'equipo';const mentioned=state.bots.filter(b=>prompt.toLowerCase().includes('@'+b.name.toLowerCase())).map(b=>b.id);return createMission(mode,prompt,mentioned.length?mentioned.slice(0,4):mode==='solo'?['nora']:mode==='debate'?['nora','iris','vera']:['nora','tomas','vera']);});},
      sendChat:e=>{e.preventDefault();return act(async()=>{if(detail){if(attachments.length)throw Error('Adjunta los archivos al comenzar una conversación.');await api('/missions/'+detail.id+'/messages','POST',{text:message});message='';document.querySelectorAll('[data-field="message"]').forEach(e=>e.value='');}else await createMission('solo',message,[b.id],false);});},
      sendMessage:e=>{e.preventDefault();return act(async()=>{if(!m.id)throw Error('Abre una misión.');if(attachments.length)throw Error('Adjunta archivos al crear la misión.');await api('/missions/'+m.id+'/messages','POST',{text:message});message='';document.querySelectorAll('[data-field="message"]').forEach(e=>e.value='');});},
      attachFiles:attach,attachmentLabel:attachments.length?attachments.length+' archivos':'Adjuntar',connectionLabel:'Conexiones',
      insertMention:()=>{message+=(message&&!message.endsWith(' ')?' ':'')+'@';const input=document.querySelector('[data-field="message"]');if(input){input.value=message;input.focus();}},
      searchInput:e=>{search=e.target.value;repaint();},searchEnter:e=>{if(e.key==='Enter'){e.preventDefault();prompt=search;const input=document.querySelector('textarea');if(input){input.value=prompt;input.focus();}}},
      templateSearch:e=>{templateQuery=e.target.value.toLowerCase();repaint();},
      dragOver:e=>e.preventDefault(),dropResume:e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(missions.some(m=>m.id===id&&m.canResume))act(()=>api('/missions/'+encodeURIComponent(id)+'/control','POST',{action:'resume'}));},
      draft:{...draft,initial:draft.name?.[0]||'?'},draftName:e=>{draft.name=e.target.value;repaint();},draftRole:e=>{draft.role=e.target.value;repaint();},draftInstructions:e=>{draft.instructions=e.currentTarget.textContent;},
      saveDraft:()=>{sessionStorage.setItem('colmena-bot-draft',JSON.stringify({...draft,shape:instance.state.shape,color:instance.state.color}));},
      hireLabel:draft.name?'Contratar a '+draft.name:'Contratar bot',hireDescription:(draft.name||'El bot')+' entrará en ',
      createBot:e=>{e.preventDefault();return act(async()=>{const b=await api('/bots','POST',draftData());sessionStorage.removeItem('colmena-bot-draft');go('Bot',{bot:b.id});});},
      trialPrompt,trialAnswer:trialBusy?'Consultando…':trialAnswer,trialInput:e=>{trialPrompt=e.target.value;},trialEnter:e=>{if(e.key==='Enter'){e.preventDefault();trial();}},runTrial:trial,
      botInstructions:e=>{instructions=e.currentTarget.textContent;},focusInstructions:()=>document.querySelector('[data-field="instructions"]')?.focus(),
      saveBot:()=>act(()=>api('/bots/'+encodeURIComponent(b.id),'PATCH',{instructions:instructions??b.instructions,personality:{tono:instance.state.tono,detalle:instance.state.detalle,riesgo:instance.state.riesgo}})),
      duplicateBot:()=>act(async()=>{const copy=await api('/bots','POST',{name:b.name+' copia',role:b.role,instructions:b.instructions,color:b.color,shape:b.shape});go('Bot',{bot:copy.id});}),
      autonomyUnavailable:true,
    };
    for(let i=0;i<4;i++){vals['column'+(i+1)]=columns[i];vals['column'+(i+1)+'Count']=columns[i].length;}
    ['Todo','Preguntas','Envíos','Permisos','Resueltas hoy'].forEach((label,i)=>{vals['inboxLabel'+i]=label+' · '+(i===0?pending.length:i===1?0:i===2?pending.filter(a=>a.tool==='apps_execute').length:i===3?pending.filter(a=>a.tool!=='apps_execute').length:resolved.length);vals['inboxPressed'+i]=inboxFilter===i;vals['inboxFilter'+i]=()=>{inboxFilter=i;repaint();};});
    const suggestions=['Resume los correos de ayer y dime cuáles piden respuesta','Compara tres programas de contabilidad para nosotros','Convierte este Excel en 5 diapositivas'];
    suggestions.forEach((text,i)=>vals['suggestion'+i]=()=>{prompt=text;document.querySelector('textarea').value=text;});
    const templates=['Informe para dirección','Revisar un contrato','Tres ideas de diseño','Automatizar una tarea repetida'];
    templates.forEach((text,i)=>vals['missionTemplate'+i]=()=>go('Main',{prompt:text,mode:i===2?'debate':i===1||i===3?'solo':'equipo'}));
    ['Asistente legal contratos renovación','Asesor fiscal impuestos plazos','Atención al cliente correos chats','Recursos humanos empleo candidatos','Analista de marketing campañas','Traductor documentos webs glosario'].forEach((text,i)=>vals['templateVisible'+i]=!templateQuery||text.toLowerCase().includes(templateQuery));
    ['Asistente legal','Asesor fiscal','Atención al cliente','Recursos humanos','Analista de marketing','Traductor'].forEach((role,i)=>vals['hireTemplate'+i]=()=>go('NuevoBot',{template:role}));
    ['Resume el contrato de alquiler','¿Qué contratos vencen este año?'].forEach((text,i)=>vals['trialSuggestion'+i]=()=>{trialPrompt=text;const input=document.querySelector('[data-field="trial"]');if(input)input.value=text;});
    for(let i=0;i<6;i++){vals['fileFilter'+i]=()=>{fileType=i;repaint();};vals['fileFilterOn'+i]=fileType===i;vals['fileFilterBg'+i]=fileType===i?'#12131A':'#FFFFFF';vals['fileFilterFg'+i]=fileType===i?'#FFFFFF':'#12131A';}
    return {...vals,...window.ColmenaAdded?.values(instance,original,context())};
  }
  function mount(instance,name){logic=instance;screen=name;
    window.ColmenaAdded?.init(context());
    queueMicrotask(async()=>{await act(async()=>{});if(params.has('mode'))instance.setState({mode:params.get('mode')});if(params.has('prompt')){prompt=params.get('prompt');const el=document.querySelector('[data-field="prompt"]');if(el)el.value=prompt;}
      source=new EventSource('/api/events');source.onmessage=e=>{const ev=JSON.parse(e.data);if(ev.type==='delta'){stream.set(ev.stepId,(stream.get(ev.stepId)||'')+ev.text);repaint();}else{if(ev.type==='bot_started')stream.delete(ev.stepId);clearTimeout(queued);queued=setTimeout(()=>reload().catch(e=>{error=e.message;repaint();}),120);}};
    });
  }
  addEventListener('pagehide',()=>{source?.close();clearTimeout(queued);});
  return {mount,values};
})();

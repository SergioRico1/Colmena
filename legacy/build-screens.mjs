import {readFile, writeFile, mkdir, cp} from 'node:fs/promises';
import {load} from 'cheerio';
import {bindAddedScreen} from './bind-added-screens.mjs';
export const screens = {Main:'01', Bandeja:'02', EditarEnvio:'02b', Chat:'03', Sala:'04', Debate:'05', EnVivo:'05b', Misiones:'06', Mision:'07', Automatizaciones:'08-v2', Equipo:'09', NuevoBot:'10-v2', NuevoBotAjusta:'10b', Bot:'11', Biblioteca:'12', Ajustes:'13', AjustesIA:'13b'};
const out = new URL('../public/screens/', import.meta.url);
await mkdir(out, {recursive:true});
await cp(new URL('../references/designs/01/vendor/', import.meta.url), new URL('vendor/', out), {recursive:true});
await cp(new URL('../references/designs/01/support.js', import.meta.url), new URL('support.js', out));
await cp(new URL('../src/screens/bridge.js', import.meta.url), new URL('bridge.js', out));
await cp(new URL('../src/screens/added.js', import.meta.url), new URL('added.js', out));
const ids = ['atlas','nora','tomas','iris','bruno','vera'];
for (const [name, dir] of Object.entries(screens)) {
  const source = await readFile(new URL(`../references/designs/${dir}/${name}.dc.html`, import.meta.url),'utf8');
  const $ = load(source), main = $('main');
  const exact = (tag, text) => $(tag).filter((_,e)=>$(e).text().trim()===text);
  const txt = (el, value) => el.text('{{'+value+'}}');
  const own = (el, value) => {const nodes=el.contents().filter((_,n)=>n.type==='text'&&n.data.trim()); if(nodes.length) {nodes.first().replaceWith('{{'+value+'}}'); nodes.slice(1).remove();}};
  const action = (el, value) => el.attr('onClick','{{'+value+'}}');
  const when = (el, value) => el.wrap('<sc-if value="{{'+value+'}}"></sc-if>');
  const loop = (items, list, variable, bind) => {
    const first=items.first(); if(!first.length) throw Error(name+': missing loop '+list);
    bind(first,variable); items.slice(1).remove(); first.wrap('<sc-for list="{{'+list+'}}" as="'+variable+'"></sc-for>');
  };
  const styleValue = (el, prop, value) => {const style=el.attr('style')||'',re=new RegExp('(^|;\\s*)'+prop+':[^;]*');el.attr('style',re.test(style)?style.replace(re,'$1'+prop+': {{'+value+'}}'):style+'; '+prop+': {{'+value+'}}');};
  const avatar = (el, value) => {txt(el,value+'.initial'); styleValue(el,'background',value+'.color'); styleValue(el,'color',value+'.ink'); styleValue(el,'border-radius',value+'.radius'); styleValue(el,'clip-path',value+'.clip');};
  const plain = (el, value) => {txt(el,value); el.attr('data-preserve-text','');};
  const unavailable = (el, reason='Pantalla pendiente de diseño') => el.attr({disabled:true,'aria-disabled':'true',title:reason});
  $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/icon.svg">');
  $('script[src="./support.js"]').before('<script src="./bridge.js"></script><script src="./added.js"></script>');
  const nav=$('nav[aria-label="Navegación principal"]');
  nav.find('a[href="Bandeja.dc.html"] > span').last().each((_,e)=>txt($(e),'pendingCount'));
  nav.find('a[href="Misiones.dc.html"] > span').last().each((_,e)=>txt($(e),'missionCount'));
  const rooms=nav.find('a[href="Sala.dc.html"],a[href="Debate.dc.html"],a[href="EnVivo.dc.html"],a[href="Mision.dc.html"]');
  if(rooms.length) loop(rooms,'navMissions','room',(el,v)=>{el.attr('href','{{'+v+'.roomUrl}}');const spans=el.children('span'); if(spans.length>1) txt(spans.eq(1),v+'.title'); else own(el,v+'.title'); spans.slice(2).remove();styleValue(el,'background',v+'.navBg');styleValue(el,'color',v+'.navInk');});
  const botLinks=nav.find('a[href="Chat.dc.html"]');
  botLinks.each((i,e)=>{const el=$(e),id=ids[i];el.attr('href',`/screens/Chat.dc.html?bot=${id}`);txt(el.children('span').eq(1),`bots.${id}.name`);const status=el.children('span').eq(2);own(status,`bots.${id}.statusLabel`);status.attr({title:`{{bots.${id}.statusLabel}}`,'aria-label':`{{bots.${id}.statusLabel}}`});if(status.length&&!status.text().trim())styleValue(status,'background',`bots.${id}.statusColor`);});
  // Dynamic additions reuse a supplied bot row, with no new visual component.
  if(botLinks.length) {const custom=botLinks.eq(1).clone(); botLinks.last().after(custom); loop(custom,'customBots','custom',(el,v)=>{el.attr('href','{{'+v+'.chatUrl}}');avatar(el.children('span').eq(0),v);txt(el.children('span').eq(1),v+'.name');own(el.children('span').eq(2),v+'.statusLabel');});}
  action(nav.find('[aria-label="Nueva sala"]'),'newMission');
  nav.find('a[href="Ajustes.dc.html"]').attr('href','/screens/Ajustes.dc.html');
  // An existing subtitle carries loading/error state instead of an invented toast/modal.
  const notice=main.find('header p').first().length?main.find('header p').first():main.find('p').first();
  notice.attr('data-app-notice','');

  if(name==='Main') {
    txt($('#saludo'),'greeting'); txt($('#saludo').prev('p'),'today');
    $('#saludo').parent().next().find('strong').each((i,e)=>txt($(e),['workingCount','pendingCount','freeCount'][i]));
    main.find('header a[href="Bandeja.dc.html"] span').last().each((_,e)=>txt($(e),'pendingCount'));
    $('form').attr('onSubmit','{{startMission}}'); $('textarea').attr({'data-field':'prompt',onInput:'{{promptInput}}'});
    action(exact('button','Adjuntar'),'attachFiles'); own(exact('button','Adjuntar'),'attachmentLabel');
    action(exact('button','4 conectores'),'connections'); own(exact('button','4 conectores'),'connectionLabel');
    main.find('input[type="search"]').attr({onChange:'{{searchInput}}',onKeyDown:'{{searchEnter}}'});
    $('section[aria-labelledby="saludo"] > div').last().find('button').each((i,e)=>action($(e),'suggestion'+i));
    const cards=$('section[aria-labelledby="misiones"] > article');
    loop(cards,'homeMissions','m',(el,v)=>{
      const top=el.children('div').eq(0);txt(top.children('div').eq(0).children('span'),v+'.modeLabel');txt(top.find('a'),v+'.title');top.find('a').attr('href','{{'+v+'.roomUrl}}');
      loop(top.children('div').eq(1).children('span'),v+'.bots','member',(av,b)=>avatar(av,b));
      el.children('div').eq(1).attr('aria-label','{{'+v+'.statusLabel}}').children('span').each((_,e)=>styleValue($(e),'background',v+'.progressColor'));
      const bottom=el.children('div').eq(2);own(bottom.children('p'),v+'.statusLabel');txt(bottom.find('span').eq(1),v+'.approvalLabel');txt(bottom.find('span').last(),v+'.date');
    });
    const ok=$('section[aria-labelledby="ok"]');txt(ok.children('div').eq(0).children('span'),'pendingCount');
    loop(ok.children('div').slice(1),'pendingApprovals','a',(el,v)=>{avatar(el.children('span').first(),v+'.bot');plain(el.find('p'),v+'.summary');el.find('a').attr('href','{{'+v+'.reviewUrl}}').text('Revisar');});
    const today=$('section[aria-labelledby="hoy"]');
    if(today.length) loop(today.children('div').slice(1),'scheduled','rule',(el,v)=>{const spans=el.children('span');txt(spans.eq(0),v+'.time');txt(spans.eq(1),v+'.name');txt(spans.eq(2),v+'.stateLabel');});
  }
  if(name==='Equipo') {
    txt(main.children('div').first().find('p'),'teamSummary');
    const cards=main.find('article');
    cards.each((i,e)=>{const el=$(e),v='bots.'+ids[i];txt(el.find('strong').first(),v+'.name');txt(el.children('div').eq(0).children('div').children('span'),v+'.role');own(el.children('p'),v+'.statusLabel');
      el.find('a[href="Chat.dc.html"]').attr('href',`/screens/Chat.dc.html?bot=${ids[i]}`);el.find('a[href="Bot.dc.html"]').attr('href',`/screens/Bot.dc.html?bot=${ids[i]}`);
      const info=el.children('div').eq(2);info.children('span').first().text('Servicio local');info.children('span').last().text('Con revisión de permisos');
    });
    const custom=cards.eq(1).clone();cards.last().after(custom);loop(custom,'customBots','b',(el,v)=>{avatar(el.children('div').first().children('span'),v);txt(el.find('strong').first(),v+'.name');txt(el.children('div').first().find('div span'),v+'.role');own(el.children('p'),v+'.statusLabel');el.find('a').eq(0).attr('href','{{'+v+'.chatUrl}}');el.find('a').eq(1).attr('href','{{'+v+'.profileUrl}}');});
    $('#galeria').closest('section').find('button').each((i,e)=>action($(e),'hireTemplate'+i));
    $('#galeria').closest('section').children('div').last().children('div').each((i,e)=>when($(e),'templateVisible'+i));
    $('input[aria-label="Buscar plantillas"]').attr('onChange','{{templateSearch}}');
  }
  if(name==='Misiones') {
    action(exact('button','Nueva misión'),'newMission');
    for(let i=1;i<=4;i++) {
      const section=$('section[aria-labelledby="col'+i+'"]');txt(section.children('div').first().children('span').last(),'column'+i+'Count');
      const items=i===4?section.children('div').slice(1):section.children('a');
      loop(items,'column'+i,'m',(el,v)=>{
        if(i<4) el.attr('href','{{'+v+'.url}}'); else {el.attr({role:'link',tabindex:'0',onClick:'{{'+v+'.open}}',onKeyDown:'{{'+v+'.keyOpen}}'});}
        txt(el.children('strong'),v+'.title');const spans=el.children('span');
        if(i<4) txt(spans.eq(0),v+'.modeLabel');
        if(i===1||i===2) {own(spans.eq(1),v+'.statusLabel');spans.slice(2,-1).remove();}
        const footer=spans.last(); if(footer.children().length) {const avatarHost=footer.children().first(); if(avatarHost.children().length) loop(avatarHost.children(),v+'.bots','b',(av,b)=>avatar(av,b)); else txt(avatarHost,v+'.owner');txt(footer.children().last(),v+'.date');}
      });
    }
    main.find('button').filter((_,e)=>$(e).text().includes('Arrastra')).attr({onDragOver:'{{dragOver}}',onDrop:'{{dropResume}}'});
    $('section[aria-labelledby="col1"] a').attr({draggable:'{{m.canResume}}',onDragStart:'{{m.dragStart}}'});
    $('section[aria-labelledby="plantillas"] button').each((i,e)=>action($(e),'missionTemplate'+i));
  }
  if(name==='Bandeja') {
    txt(main.find('p').first(),'inboxSummary');
    $('[aria-label="Filtrar"] button').each((i,e)=>{action($(e),'inboxFilter'+i);txt($(e),'inboxLabel'+i);$(e).attr('aria-pressed','{{inboxPressed'+i+'}}');});
    const cards=main.find('article');
    loop(cards,'inboxItems','a',(el,v)=>{avatar(el.children('span'),v+'.bot');const body=el.children('div');txt(body.children('div').first().children('span').eq(0),v+'.kind');txt(body.children('div').first().children('span').eq(1),v+'.context');plain(body.children('p'),v+'.summary');const buttons=el.find('button');action(buttons.eq(0),v+'.review');buttons.eq(0).text('Revisar');action(buttons.eq(1),v+'.edit');buttons.eq(1).attr('disabled','{{a.cannotEdit}}');action(buttons.eq(2),v+'.deny');});
    const resolved=$('section[aria-labelledby="resueltas"]');loop(resolved.children('div'),'resolvedApprovals','a',(el,v)=>{el.children('span').each((i,e)=>txt($(e),v+'.'+['time','summary','statusLabel'][i]));});
    const preview=$('aside[aria-label="Vista previa del envío"]');when(preview,'selectedApproval');
    txt(preview.children('div').eq(0).children('span').first(),'previewTitle');txt(preview.children('div').eq(0).children('span').last(),'previewPosition');
    const body=preview.children('div').eq(1);const fields=body.children('div').first().children('div');txt(fields.eq(0).children('span').last(),'previewRecipient');txt(fields.eq(1).children('strong'),'previewSubject');
    plain(body.children('div').eq(1),'previewBody');txt(body.children('div').eq(2),'previewContext');
    const footer=preview.children('div').eq(2);when(footer,'selectedLocalPending');footer.children('div').children('span').remove();footer.find('button').text('Aprobar').removeAttr('disabled');action(footer.find('button'),'approveSelected');
  }
  if(['Chat','Sala','EnVivo'].includes(name)) {
    const conversation=name==='Chat'?main.find('section').first():$('section[aria-label="Mensajes de la sala"]');
    conversation.attr('aria-label',name==='Chat'?'{{chatLabel}}':'Mensajes de la sala');
    const messages=conversation.children('div').first();
    if(name==='Chat') {
      txt(main.find('h1'),'bot.name');txt(main.find('h1').next('span'),'bot.role');avatar(main.find('header > div').first().children('span'),'bot');
      const history=main.find('header button').first();txt(history,'conversationTitle');
      action(exact('button','Nueva conversación'),'newConversation');
      main.find('a[href="Bot.dc.html"]').attr('href','{{bot.profileUrl}}');
      const user=messages.children('div').first();user.children('span').remove();plain(user.children('div'),'msg.text');loop(user,'userMessages','msg',()=>{});
      const response=messages.children('article').first();messages.children('article').slice(1).remove();
      loop(response,'assistantMessages','msg',(el,v)=>{
        avatar(el.children('div').eq(0).children('span'),v+'.bot');txt(el.children('div').eq(0).children('strong'),v+'.bot.name');
        txt(el.children('button').eq(0),v+'.activity');
        loop(el.find('ol li'),'events','ev',(li,x)=>plain(li,x+'.text'));
        plain(el.children('div').eq(1),v+'.text');
        const artifact=el.children('button').eq(1);when(artifact,'hasArtifact');txt(artifact.find('strong'),'artifactTitle');txt(artifact.find('strong').next('span'),'artifactSubtitle');
        action(el.find('[aria-label="Copiar respuesta"]'),v+'.copy');action(el.find('[aria-label="Guardar en la memoria de Nora"]'),v+'.remember');
      });
      const panel=$('aside[aria-label="Comparativa abierta"]');panel.attr('aria-label','Entregable abierto');txt(panel.find('strong').first(),'artifactTitle');txt(panel.find('strong').first().next('span'),'artifactSubtitle');txt(panel.find('h2'),'artifactTitle');
      const table=panel.find('table');const originalCell=table.find('td').first().clone();table.find('thead').remove();table.find('tbody').empty().append('<tr></tr>');table.find('tr').append(originalCell);plain(originalCell,'artifactContent');panel.find('ul, p').remove();
      action(panel.find('button').filter((_,e)=>$(e).text()==='Copiar'),'copyArtifact');action(exact('button','Guardar en Biblioteca'),'downloadArtifact');
      exact('button','Carpeta compartida, Web').text('Archivos y conexiones');action(exact('button','Archivos y conexiones'),'connections');
    } else {
      own(main.find('h1'),'mission.title');txt(main.find('header p'),'mission.subtitle');
      const row=messages.children('div').filter((_,e)=>$(e).children('div').find('p').length).first();
      const liveArticle=name==='EnVivo'?messages.children('article').eq(1):null;
      messages.children().not(row).not(liveArticle||[]).remove();
      loop(row,name==='EnVivo'?'userMessages':'messages','msg',(el,v)=>{avatar(el.children('span'),v+'.bot');const body=el.children('div');body.children('span,ul,button').remove();txt(body.children('div').first().children('strong'),v+'.bot.name');txt(body.children('div').first().children('span').last(),v+'.time');plain(body.children('p'),v+'.text');});
      if(liveArticle)loop(liveArticle,'liveSteps','step',(el,v)=>{
        const head=el.children('div').eq(0),body=el.children('div').eq(1);avatar(head.children('span').first(),v+'.bot');txt(head.children('strong'),v+'.bot.name');own(head.children('span').eq(1),v+'.statusLabel');txt(head.children('span').last(),v+'.wordLabel');
        txt(body.children('span').first(),'mission.title');txt(body.children('h3'),v+'.title');plain(body.children('p'),v+'.liveText');
        loop(body.children('div').children('span'),'steps','phase',(el,p)=>txt(el,p+'.title'));
        const buttons=el.children('div').last().children('button');action(buttons.eq(0),v+'.download');buttons.eq(0).attr('disabled','{{step.noText}}');action(buttons.eq(1),v+'.closer');action(buttons.eq(2),v+'.shorter');
      });
      action(main.find('[aria-label="Pausar a todos los bots de la sala"]'),'controlMission');main.find('[aria-label="Pausar a todos los bots de la sala"]').attr({'aria-label':'{{controlLabel}}',title:'{{controlLabel}}'});
      plain(conversation.find('form > p'),'mission.statusLabel');
      if(name==='Sala') {
        const pending=main.children('a');pending.attr('href','/screens/Bandeja.dc.html');when(pending,'missionPending');plain(pending.children('span').eq(1),'missionPendingLabel');
        txt(main.find('header button[aria-label]').first().children('span').last(),'memberCount');txt(main.find('header button[aria-pressed] span'),'stepProgress');
        const thread=$('aside[aria-label="Hilo entre bots"]');txt(thread.children('div').eq(0).find('span'),'mission.title');
        const threadBody=thread.children('div').eq(1);txt(threadBody.children('div').first().children('span').first(),'threadCount');
        loop(threadBody.children('div').slice(1),'assistantMessages','msg',(el,v)=>{avatar(el.children('span'),v+'.bot');txt(el.find('strong'),v+'.bot.name');txt(el.children('div').children('span').first().children('span'),v+'.time');plain(el.children('div').children('span').last(),v+'.text');});
        thread.find('form').attr('onSubmit','{{sendMessage}}');thread.find('input').attr({'data-field':'message',onInput:'{{messageInput}}'});
        const progress=$('aside[aria-label="Progreso de la sala"] > div').eq(1);loop(progress.children('div'),'steps','step',(el,v)=>{avatar(el.children('span').eq(0),v+'.bot');txt(el.children('span').eq(1),v+'.title');txt(el.children('strong'),v+'.statusLabel');});
      } else {
        const strip=$('[aria-label="Qué está haciendo cada bot ahora"]');loop(strip.children('span').slice(1),'steps','step',(el,v)=>{avatar(el.children('span').first(),v+'.bot');txt(el.children('strong'),v+'.bot.name');own(el,v+'.statusLabel');});
        // No simulated generation, tests, pages or progress: live text comes from SSE.
      }
    }
    conversation.find('form').attr('onSubmit',name==='Chat'?'{{sendChat}}':'{{sendMessage}}');
    conversation.find('textarea,input').attr({'data-field':'message',onInput:'{{messageInput}}'});
    conversation.find('[placeholder]').attr('placeholder','{{messagePlaceholder}}');
    conversation.find('form button[aria-label="Enviar"], form button[aria-label="Enviar mensaje"]').attr('type','submit');
    action(main.find('[aria-label="Adjuntar archivo"]'),'attachFiles');
    action(main.find('[aria-label="Mencionar a un bot"]'),'insertMention');
  }
  if(name==='Debate') {
    own(main.find('h1'),'mission.title');txt(main.find('header p'),'mission.subtitle');
    const summary=exact('strong','Atlas resume el debate').parent();txt(summary.children('span'),'debateSummary');
    const cards=main.find('article');
    loop(cards,'proposals','proposal',(el,v)=>{
      const head=el.children('div').eq(0);avatar(head.children('span').eq(0),v+'.bot');plain(head.children('span').eq(1),v+'.label');txt(head.children('span').eq(2),v+'.statusLabel');
      const mock=el.children('div').eq(1);plain(mock,v+'.text');mock.removeAttr('role').attr('aria-label','Propuesta');
      const body=el.children('div').eq(2);plain(body.children('p'),v+'.summary');
      const critics=body.children('div');loop(critics.children('div'),v+'.critiques','critique',(row,c)=>{avatar(row.children('span').eq(0),c+'.bot');plain(row.children('span').eq(1),c+'.text');});
      action(body.children('button'),v+'.pick');txt(body.children('button'),v+'.choiceLabel');body.children('button').attr('aria-pressed','{{'+v+'.selected}}');
      styleValue(el,'border',v+'.border');styleValue(el,'box-shadow',v+'.shadow');
    });
    unavailable(main.find('button[onclick="{{pickAB}}"]'),'Combinar propuestas: función pendiente');
    action(exact('a','Confirmar y seguir'),'confirmChoice');txt(main.find('p').last(),'choiceSummary');
  }
  if(name==='Mision') {
    txt(main.find('h1'),'mission.title');txt(main.find('header > div > div').last().children('span'),'mission.statusLabel');
    txt(main.find('[role="tab"]').last().children('span'),'missionArtifactCount');main.find('[role="tab"]').last().attr('href','#entregables');
    txt(main.find('h2').first().next('p'),'mission.subtitle');
    const grid=$('section[aria-label="Línea de tiempo por bot"] > div');
    const axis=grid.children('div').eq(2);axis.children('span').slice(1).each((i,e)=>txt($(e),'timelineTick'+i));
    const marker=grid.children('div').eq(1);txt(marker.children('span'),'timelineNow');styleValue(marker,'left','timelineMarker');
    loop(grid.children('div').slice(3),'timelineSteps','step',(el,v)=>{const bot=el.children('div').first();avatar(bot.children('span').first(),v+'.bot');txt(bot.find('strong'),v+'.bot.name');txt(bot.find('strong').next('span'),v+'.title');el.children('div').slice(2).remove();const bar=el.children('div').eq(1);plain(bar,v+'.statusLabel');styleValue(bar,'grid-column',v+'.columns');styleValue(bar,'background',v+'.background');styleValue(bar,'border',v+'.border');});
    const events=$('section[aria-labelledby="traspasos"]');loop(events.children('div'),'events','ev',(el,v)=>{txt(el.children('span').first(),v+'.time');plain(el.children('span').last(),v+'.text');});
    const artifacts=$('section[aria-labelledby="entregables"] > div');loop(artifacts.children('div'),'missionArtifacts','file',(el,v)=>{txt(el.children('span').first(),v+'.subtitle');txt(el.children('strong'),v+'.title');txt(el.children('span').last(),v+'.date');el.attr({role:'link',tabindex:'0',onClick:'{{'+v+'.download}}',onKeyDown:'{{'+v+'.keyDownload}}'});});
  }
  if(name==='Automatizaciones') {
    const section=$('section[aria-labelledby="auto-t"]'), list=section.children('div').last();
    section.children('div').eq(1).remove(); // Remove invented learning suggestion.
    loop(list.children('div'),'rules','rule',(el,v)=>{avatar(el.children('span').first(),v+'.bot');txt(el.find('strong'),v+'.name');txt(el.children('span').eq(1).children('span'),v+'.subtitle');action(el.find('button'),v+'.toggle');el.find('button').attr({'aria-checked':'{{'+v+'.enabled}}','aria-label':'{{'+v+'.name}}'});styleValue(el.find('button'),'background',v+'.track');styleValue(el.find('button'),'justify-content',v+'.justify');styleValue(el.find('button span'),'background',v+'.knob');action(el.children('span').eq(1),v+'.select');el.children('span').eq(1).attr({role:'button',tabindex:'0',onKeyDown:'{{'+v+'.keySelect}}'});});
    const editor=$('section[aria-labelledby="regla-t"]');when(editor,'selectedRule');txt($('#regla-t'),'rule.name');
    const rows=editor.children('div').eq(1).children('div');
    const prompt=rows.eq(2).children('div');plain(prompt,'rule.prompt');prompt.attr({contenteditable:'true',role:'textbox','aria-label':'Acción de la automatización','data-field':'rulePrompt',onBlur:'{{rulePromptInput}}',suppressContentEditableWarning:'true'});
    rows.eq(3).children('div').text('En Colmena: resultado o solicitud de permiso');
    const toolSummary=editor.children('div').eq(2);txt(toolSummary.children('span'),'whoNeeds');toolSummary.children('div').children('span').each((i,e)=>$(e).text(['Archivos de la misión','Apps conectadas · con revisión','Memoria · con aprobación'][i]));
    action(exact('button','Guardar cambios'),'saveRule');unavailable(exact('button','Probar con el último correo'),'Pendiente de la configuración del disparador y de su evento de prueba');
    $('[aria-label="Cuándo se pone en marcha"] input').attr('onChange','{{triggerSearch}}');
    const history=editor.children('div').last();loop(history.children('div'),'ruleHistory','m',(el,v)=>{el.children('span').each((i,e)=>txt($(e),v+'.'+['date','title','statusLabel'][i]));});
  }
  if(name==='NuevoBotAjusta') {
    $('header button').filter((_,e)=>$(e).text()==='Guardar borrador').attr('onClick','{{saveDraft}}');
    const section=$('section[aria-labelledby="propuesta"]');
    section.find('input').eq(0).attr({value:'{{draft.name}}',onChange:'{{draftName}}','data-field':'botName'}).removeAttr('readonly');
    section.find('input').eq(1).attr({value:'{{draft.role}}',onChange:'{{draftRole}}','data-field':'botRole'}).removeAttr('readonly');
    section.children('div').eq(0).children('span').text('{{draft.initial}}');
    const instructions=section.children('div').eq(2).children('div');plain(instructions,'draft.instructions');instructions.attr({contenteditable:'true',role:'textbox','aria-label':'Instrucciones','data-field':'instructions',onBlur:'{{draftInstructions}}',suppressContentEditableWarning:'true'});
    txt($('section[aria-labelledby="pedido"] p'),'draft.request');
    section.children('div').eq(3).find('span').slice(1).remove();
    section.children('div').eq(4).find('div span').filter((i)=>i%2===1).text('Sin permiso previo');
    const preview=$('aside[aria-labelledby="prueba"]');txt(preview.children('div').eq(0).children('span'),'draft.initial');preview.find('h2').next('span').text('Prueba privada, sin herramientas ni efectos externos');
    plain(preview.children('div').eq(1).children('div').eq(0),'trialPrompt');const answer=preview.children('div').eq(1).children('div').eq(1);txt(answer.children('strong'),'draft.name');plain(answer.children('p').first(),'trialAnswer');answer.children('ul').remove();answer.children('p').slice(1).remove();
    preview.find('input').attr({onInput:'{{trialInput}}',onKeyDown:'{{trialEnter}}','data-field':'trial'});action(preview.find('[aria-label="Enviar pregunta de prueba"]'),'runTrial');
    preview.find('button').slice(0,2).each((i,e)=>action($(e),'trialSuggestion'+i));
    action($('footer a').last(),'createBot');txt($('footer a').last(),'hireLabel');own($('footer span').first(),'hireDescription');
    action(exact('button','Atrás'),'team');
    $('section[aria-labelledby="propuesta"] > h2').text('Perfil del bot');
  }
  bindAddedScreen(name, {$,exact,txt,own,action,when,loop,styleValue,avatar,plain,unavailable});
  $('[data-preserve-text]').each((_,e)=>{const el=$(e);el.attr('style',(el.attr('style')||'')+'; white-space: pre-wrap; overflow-wrap: anywhere');});
  if(name==='Bot') {
    txt(main.find('h1'),'bot.name');avatar(main.find('header > div > div > span').first(),'bot');
    const meta=main.find('h1').next('div');own(meta.children('span').first(),'bot.statusLabel');txt(meta.children('span').eq(1),'bot.missionLabel');meta.children('span').last().text('Servicio local');
    main.find('a[href="Chat.dc.html"]').attr('href','{{bot.chatUrl}}');action(exact('button','Duplicar'),'duplicateBot');action(exact('button','Guardar cambios'),'saveBot');
    const role=$('#rol > div').eq(1);plain(role,'bot.instructions');role.attr({contenteditable:'true',role:'textbox','aria-label':'Rol e instrucciones',onBlur:'{{botInstructions}}','data-field':'instructions',suppressContentEditableWarning:'true'});action($('#rol button'),'focusInstructions');
    const skills=$('#habilidades');const pending=skills.children('div').eq(1);loop(pending,'pendingSkills','skill',(el,v)=>{txt(el.find('strong'),v+'.name');txt(el.children('div').first().children('span').last(),v+'.description');action(el.find('button').first(),v+'.review');unavailable(el.find('button').last(),'Primero revisa el contenido completo; falta ese diseño');});
    const installed=skills.children('div').last();loop(installed.children('div'),'activeSkills','skill',(el,v)=>{txt(el.find('strong'),v+'.name');txt(el.find('span'),v+'.description');});
    txt($('#mem-t'),'memoryHeading');loop($('#memoria').children('div').slice(1),'memories','mem',(el,v)=>{plain(el.children('span').first(),v+'.text');txt(el.children('span').eq(1),v+'.source');action(el.find('button'),v+'.remove');});
    $('[aria-label="Nivel de autonomía"] button').attr('disabled','{{autonomyUnavailable}}').attr('title','Los permisos externos siempre se revisan');
    exact('span','Sigue trabajando con el portátil cerrado').text('No disponible: Colmena necesita seguir abierta');
    $('section[aria-labelledby="cer-t"] button').each((_,e)=>unavailable($(e),'Configuración pendiente; ejecución local con el modelo de tu cuenta'));
    $('#herramientas button').text('Requiere revisión');action($('#herramientas button'),'connections');
    $('#equipo [role="switch"]').attr({'aria-checked':'false',disabled:true,title:'Canal no configurado'});$('#equipo [aria-label="Colmena"]').attr('aria-checked','true');
    exact('span','tomas@[tu-dominio]').text('Sin cuenta configurada');
    exact('span','[TU ERP]').text('Contabilidad');
    exact('button','En la nubeNo disponible: Colmena necesita seguir abierta').attr('aria-pressed','false');
    $('#equipo [aria-label="Colmena"]').attr('title','Canal local activo');
  }
  if(name==='Biblioteca') {
    $('input[aria-label="Buscar en la Biblioteca"]').attr('onChange','{{librarySearch}}');
    const cards=main.find('a').filter((_,e)=>$(e).children('span').length===2&&$(e).find('strong').length);
    loop(cards,'artifacts','file',(el,v)=>{el.attr({href:'#',onClick:'{{'+v+'.download}}'});txt(el.find('strong'),v+'.title');plain(el.children('span').last().children('span'),v+'.subtitle');});
    const skills=$('section[aria-labelledby="revisar"]');loop(skills.children('div').slice(1),'pendingSkills','skill',(el,v)=>{avatar(el.children('span'),v+'.bot');txt(el.find('strong'),v+'.name');txt(el.find('strong').next('span'),v+'.description');el.find('a').attr('href','{{'+v+'.profileUrl}}');});
    const memory=$('section[aria-labelledby="memoria"]');loop(memory.children('div').slice(1),'memories','mem',(el,v)=>{plain(el.children('span').first(),v+'.text');txt(el.children('span').last(),v+'.source');});
    const tabs=$('[aria-label="Secciones de la Biblioteca"] button');action(tabs.eq(1),'focusMemories');action(tabs.eq(2),'focusSkills');txt(tabs.eq(2).children('span'),'pendingSkillsCount');action(exact('button','Ver toda la memoria'),'focusMemories');
    action(tabs.eq(0),'focusFiles');
    const filters=main.children('div').eq(2).find('button');filters.slice(0,6).each((i,e)=>{action($(e),'fileFilter'+i);$(e).attr('aria-pressed','{{fileFilterOn'+i+'}}');styleValue($(e),'background','fileFilterBg'+i);styleValue($(e),'color','fileFilterFg'+i);});
  }
  // Resolve original page links after the bindings; contextual links keep the current mission/bot.
  $('a[href]').each((_,e)=>{const el=$(e),href=el.attr('href');if(href.includes('{{'))return;
    const match=/^([A-Za-z]+)\.dc\.html$/.exec(href);if(!match)return;
    const target=match[1];if(!screens[target]){el.attr({'aria-disabled':'true',title:'Pantalla pendiente de diseño',href:'#'});return;}
    el.attr('href',['Sala','Mision','Debate','EnVivo'].includes(target)?'{{urls.'+target+'}}':'/screens/'+target+'.dc.html');
  });
  $('button').each((_,e)=>{const el=$(e);if(!Object.keys(e.attribs).some(k=>/^on/i.test(k))&&el.attr('type')!=='submit'&&!el.attr('disabled'))unavailable(el);});
  $('button').not('[type]').attr('type','button');
  $('*').each((_,e)=>{for(const [key,value] of Object.entries(e.attribs||{}))if(/^on[A-Z]/.test(key)){delete e.attribs[key];e.attribs[key.toLowerCase()]=value;}});
  const original=$('script[data-dc-script]').text();
  const base=original.replace('class Component extends DCLogic','class OriginalComponent extends DCLogic');
  $('script[data-dc-script]').text(base+`\nclass Component extends OriginalComponent {
    constructor(props) { super(props); window.ColmenaScreens.mount(this, '${name}'); }
    ${name==='EnVivo'?'componentDidMount() {}':''}
    renderVals() { return window.ColmenaScreens.values(this, super.renderVals()); }
  }`);
  await writeFile(new URL(name+'.dc.html',out),$.html());
}

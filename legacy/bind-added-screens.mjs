export function bindAddedScreen(name, h) {
  const {$,exact,txt,own,action,when,loop,avatar,plain,unavailable}=h;
  if(name==='NuevoBot') {
    $('#descripcion').attr('onInput','{{textChange}}');
    action(exact('a','Preparar mi bot'),'prepareBot');
    action(exact('button','Arrastra ejemplos de su trabajoContratos, informes, correos… Le ayudan a entender cómo trabajáis.'),'attachFiles');
    const material=$('button').filter((_,e)=>$(e).text().includes('Arrastra ejemplos'));action(material,'attachFiles');txt(material.children('span').first(),'materialLabel');
    $('#ayuda-t').parent().children('span').attr('data-app-notice','');
    txt($('footer div > span'),'prepareStatus');
    unavailable(exact('button','Dictar'),'Dictado de voz todavía no integrado');
  }
  if(name==='AjustesIA') {
    $('sc-for[list="{{bots}}"] ').attr('list','{{iaBots}}');
    txt(exact('strong','[TU CORREO]'),'accountLabel');txt(exact('strong','[TU PLAN]'),'accountPlan');
    $('sc-if[value="{{isWait}}"] > div > div').last().attr('hidden','{{noDeviceCode}}');
    txt(exact('span','K7QF-29XM'),'deviceCode');
    action(exact('button','Volver a abrir la página'),'reopenLogin');action(exact('button','Probar conexión'),'testConnection');
    exact('span','{{usingCount}} de 6').text('{{usingLabel}}');
    $('[aria-label="Secciones de ajustes"] a').slice(2).each((_,e)=>$(e).attr({href:'#','aria-disabled':'true',title:'Falta el diseño de esta sección'}));
    exact('a','Este ordenador').removeAttr('aria-disabled').removeAttr('title').attr('href','/screens/Ajustes.dc.html#ordenador');
    exact('a','Límites y gasto').removeAttr('aria-disabled').removeAttr('title').attr('href','/screens/Ajustes.dc.html#limites');
    $('section[aria-labelledby="otras-t"] button,section[aria-labelledby="privacidad-t"] button').each((_,e)=>unavailable($(e),'Proveedor o configuración todavía no integrado'));
    unavailable(exact('button','Usar una clave de API en su lugar'),'La configuración de claves de API no está integrada');
    $('h1').next('p').attr('data-app-notice','');
  }
  if(name==='Ajustes') {
    exact('strong','Clientes · [TU CRM]').text('Clientes · CRM');exact('strong','Contabilidad · [TU ERP]').text('Contabilidad · ERP');
    const content=$('main > div'), cards=content.children('div').eq(1).children('div');
    cards.each((i,e)=>{const card=$(e);txt(card.children('span').last(),'connectorStatus'+i);action(card,'connections');card.attr({role:'button',tabindex:'0',onKeyDown:'{{connectionsKey}}'});action(card.find('button'),'connections');});
    const rows=$('tbody tr');
    rows.each((i,e)=>$(e).find('td').each((j,cell)=>{const el=$(cell);el.empty().text('{{permission'+i+'_'+j+'}}').attr({role:'button',tabindex:'0',onClick:'{{connections}}',onKeyDown:'{{connectionsKey}}'});}));
    exact('p','Pulsa una casilla para cambiarla. Enviar fuera, mover dinero, borrar e instalar siempre piden permiso.').text('Las acciones externas requieren revisión. Las casillas abren tus conexiones; no conceden permisos automáticamente.');
    const folders=$('section[aria-labelledby="ordenador"] > div').eq(1);folders.find('span span').each((i,e)=>txt($(e),i%2===0?'workspaceLabel':'workspaceAccess'));
    exact('strong','[GASTO DEL MES] de [TU LÍMITE]').text('No disponible en esta cuenta');
    $('section[aria-labelledby="limites"] [role="switch"]').attr({'aria-checked':'false',disabled:true,title:'Los límites de gasto no están integrados'});
    unavailable(exact('button','Añadir carpeta'),'El selector de carpetas y sus permisos necesita diseño');
    $('[aria-label="Secciones de ajustes"] a').slice(2).each((_,e)=>{const el=$(e);if(el.text()==='Este ordenador')el.attr('href','#ordenador');else if(el.text()==='Límites y gasto')el.attr('href','#limites');else el.attr({href:'#','aria-disabled':'true',title:'Falta el diseño de esta sección'});});
  }
  if(name==='EditarEnvio') {
    const form=$('form');form.attr('onSubmit','{{preventSubmit}}');
    $('h1').closest('div').prev('p').attr('data-app-notice','');
    txt(form.children('div').first().children('span').last(),'senderLabel');
    txt(exact('span','Vera tendrá en cuenta tus cambios para el resumen de la semana que viene.'),'editNotice');
    const preview=$('[aria-label="Vista previa del envío"]');txt(preview.children('div').first().children('span').eq(1),'senderLabel');
    action(exact('button','Rechazar'),'rejectSend');action(exact('a','Aprobar y enviar'),'approveSend');
    for(const id of ['campo-asunto','campo-cuerpo'])$('#'+id).attr('onInput',id==='campo-asunto'?'{{subjectChange}}':'{{bodyChange}}');
    for(const [id,field] of [['campo-para','to'],['campo-cc','cc'],['campo-cco','cco']])$('#'+id).attr('onInput','{{'+field+'.change}}');
    unavailable(exact('button','Añadir archivo o arrastrarlo aquí'),'Adjuntos de correo todavía no integrados con el proveedor');
    $('[aria-label="Formato"] button').each((_,e)=>unavailable($(e),'El envío actual admite texto plano; formato enriquecido pendiente de integración'));
    for(const [label,mode] of [['Más corto','short'],['Más formal','formal'],['Revisar ortografía','spelling']])action(exact('button',label),'rewrite_'+mode);
  }
}

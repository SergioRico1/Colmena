import {readFile, writeFile, mkdir, cp} from 'node:fs/promises';
import {load} from 'cheerio';

// Keep the supplied layout and every retained style verbatim; bind data and actions only.
const out = new URL('../public/connections/', import.meta.url);
await mkdir(out, {recursive: true});
await cp(new URL('../references/designs/09b/vendor/', import.meta.url), new URL('vendor/', out), {recursive: true});
await cp(new URL('../references/designs/09b/support.js', import.meta.url), new URL('support.js', out));
await cp(new URL('../src/connections/bridge.js', import.meta.url), new URL('bridge.js', out));
for (const [dir, file] of [['09b', 'Connections'], ['09c', 'Permissions']]) {
  await cp(new URL('../references/designs/' + dir, import.meta.url), new URL('../public/design-reference/' + dir, import.meta.url), {recursive: true});
  const source = await readFile(new URL('../references/designs/' + dir + '/' + file + '.dc.html', import.meta.url), 'utf8');
  const $ = load(source);
  $('head').append('<link rel="icon" href="/icon.svg">');
  $('script[src="./support.js"]').before('<script src="./bridge.js"></script>');
  const exact = (tag, text) => $(tag).filter((_, e) => $(e).text().trim() === text);
  const button = (text, action) => exact('button', text).attr('onClick', '{{' + action + '}}');
  if (dir === '09b') {
    const sections = $('section');
    const connected = sections.eq(0), card = connected.children('div').first();
    card.wrap('<sc-for list="{{connectedAccounts}}" as="account"></sc-for>');
    const row = card.children('div').eq(0);
    row.children('span').eq(0).text('{{account.mono}}');
    const labels = row.children('span').eq(1).children('span');
    labels.eq(0).contents().filter((_, n) => n.type === 'text').first().replaceWith('{{account.name}}');
    labels.eq(0).find('span').text('{{account.alias}}');
    labels.eq(1).contents().filter((_, n) => n.type === 'text').last().replaceWith('{{account.statusLabel}}');
    button('Añadir otra cuenta', 'account.connect');
    button('Desconectar', 'account.disconnect');
    const permissionCells = card.children('div').eq(1).children('div');
    permissionCells.eq(0).children('span').eq(1).text('Revisión o permiso de lectura');
    permissionCells.eq(1).children('span').eq(0).text('Acciones en la app');
    permissionCells.eq(1).children('span').eq(1).text('Con revisión');
    permissionCells.eq(2).children('span').eq(0).text('Enviar o modificar');
    card.children('span').last().text('{{account.lastUse}}');
    connected.children('h2').text('{{connectedHeading}}');
    const suggestion = connected.next('div');
    suggestion.find('span').filter((_, e) => $(e).text().trim() === 'Para «Hotel en Lisboa»').contents().filter((_, n) => n.type === 'text').last().replaceWith('{{serviceTitle}}');
    exact('span', 'Conecta Google Calendar y añadiré la estancia del 14 al 17 de octubre cuando reserves.').text('{{serviceMessage}}');
    suggestion.find('button').attr('disabled', '{{unavailable}}');
    const catalogue = sections.eq(1);
    catalogue.find('input').attr('onChange', '{{searchApps}}');
    const filters = catalogue.children('div').eq(1).children('span');
    ['suggested', 'mail', 'documents', 'team', 'development'].forEach((key, i) => {
      filters.eq(i).attr({role: 'button', tabindex: '0', onClick: '{{filter_' + key + '}}', onKeyDown: '{{key_' + key + '}}', 'aria-pressed': '{{filterOn_' + key + '}}'});
    });
    exact('a', 'Ver el catálogo completo').attr({href: '#catalogo', onClick: '{{fullCatalogue}}'}).text('{{catalogueLabel}}');
    catalogue.attr('id', 'catalogo');
    // The operator provisions the engine; users must never see its configuration.
    const advanced = exact('h2', 'Avanzado');
    advanced.next('div').remove(); advanced.remove();
    $('[aria-label="Atrás"]').attr('onClick', '{{goBack}}');
    $('nav a').each((_, e) => {
      if ($(e).text().trim() !== 'Conexiones') $(e).attr({'aria-disabled': 'true', title: 'Pantalla pendiente de diseño', href: '#'});
    });
    exact('a','General').removeAttr('aria-disabled').removeAttr('title').attr('href','/screens/Ajustes.dc.html');
    exact('a','Nexo').removeAttr('aria-disabled').removeAttr('title').attr('href','/screens/AjustesIA.dc.html');
    $('button').each((_,e)=>{if(!Object.keys(e.attribs).some(k=>/^on/i.test(k)))$(e).attr({disabled:true,title:'Control de ventana no disponible en la versión web'});});
    const original = $('script[data-dc-script]').text().replace('class Component extends DCLogic', 'class OriginalComponent extends DCLogic');
    $('script[data-dc-script]').text(original + `\nclass Component extends OriginalComponent {
      constructor(props) { super(props); window.ColmenaConnections.mount(this, 'connections'); }
      renderVals() { return window.ColmenaConnections.connectionValues(this, super.renderVals()); }
    }`);
  } else {
    const root = $('x-dc').children('div');
    root.children('div').each((i, e) => {
      $(e).wrap('<sc-if value="{{show_' + ['name', 'read', 'send'][i] + '}}"></sc-if>');
      $(e).children('span').last().remove(); // Artboard annotations are not dialog content.
    });
    const name = $('[aria-label="Nombrar la cuenta"]');
    exact('span', 'Gmail está conectado').text('{{accountTitle}}');
    name.find('input').attr('onChange', '{{changeName}}');
    button('Listo', 'saveName').attr('disabled', '{{busy}}');
    exact('span', '¿Cómo quieres llamar a esta cuenta? Así sabrás cuál usa Nexo.').text('{{nameMessage}}');
    exact('span', '¿Puedo ver tu perfil de Gmail?').text('{{readTitle}}');
    exact('span', 'Para saber desde qué dirección trabajar. No cambia nada en tu cuenta.').text('{{readMessage}}');
    exact('span', 'Gmail · Personal').text('{{accountLabel}}');
    exact('span', 'Leerá tu nombre y tu dirección').text('{{readDescription}}');
    const read = $('[aria-label="Permitir lectura"]');
    read.find('sc-if div').text('{{technicalDetails}}');
    read.find('[role="checkbox"]').contents().filter((_, n) => n.type === 'text').last().replaceWith('{{rememberLabel}}');
    button('Ahora no', 'deny').attr('disabled', '{{busy}}');
    button('Permitir', 'allow').attr('disabled', '{{busy}}');
    const send = $('[aria-label="Confirmar envío"]');
    exact('span', 'Voy a enviar este correo desde Gmail · Personal').text('{{sendTitle}}');
    const preview = send.children('div').eq(1);
    preview.children('div').eq(0).children('span').eq(0).contents().filter((_, n) => n.type === 'text').last().replaceWith('{{recipient}}');
    preview.children('div').eq(0).children('span').eq(1).contents().filter((_, n) => n.type === 'text').last().replaceWith('{{subject}}');
    preview.children('div').eq(1).text('{{body}}');
    // Preserve full reviewed text, including line breaks and long addresses.
    preview.attr('style', preview.attr('style') + '; overflow-wrap: anywhere; white-space: pre-wrap');
    button('Editar', 'edit').attr('disabled','{{busy}}');
    const sendButton = send.find('button').last();
    sendButton.removeAttr('onclick').attr({onPointerDown: '{{holdStart}}', onPointerUp: '{{holdEnd}}', onPointerLeave: '{{holdEnd}}', onPointerCancel: '{{holdEnd}}', onKeyDown: '{{holdKeyStart}}', onKeyUp: '{{holdEnd}}', onBlur: '{{holdEnd}}', disabled: '{{busy}}'});
    const original = $('script[data-dc-script]').text().replace('class Component extends DCLogic', 'class OriginalComponent extends DCLogic');
    $('script[data-dc-script]').text(original + `\nclass Component extends OriginalComponent {
      constructor(props) { super(props); window.ColmenaConnections.mount(this, 'permissions'); }
      renderVals() { return window.ColmenaConnections.permissionValues(this, super.renderVals()); }
    }`);
  }
  // Product identity changes, not styling. No provider branding in the user surface.
  $('*').each((_,e)=>{for(const [key,value] of Object.entries(e.attribs||{}))if(/^on[A-Z]/.test(key)){delete e.attribs[key];e.attribs[key.toLowerCase()]=value;}});
  await writeFile(new URL(file + '.dc.html', out), $.html().replaceAll('Nexo', 'Colmena'));
}

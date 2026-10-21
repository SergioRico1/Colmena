/* Data/action bindings for the supplied 09b/09c designs. No generated markup or CSS. */
window.__resources = {};
window.ColmenaConnections = (() => {
  let token, logic, mode, timer, searchTimer, holdTimer, holdStartAt = 0;
  let state = {available: false, loaded: false, accounts: [], catalogue: null, catalogueOffset: 0, nextCursor: null, error: '', busy: false, filter: 'suggested', query: '', review: null};
  const params = new URLSearchParams(location.search);
  const definitions = [
    {slug: 'gmail', name: 'Gmail', mono: 'G', description: 'Busca correos y prepara respuestas.'},
    {slug: 'googlecalendar', name: 'Google Calendar', mono: 'C', description: 'Consulta eventos y disponibilidad.'},
    {slug: 'googlesheets', name: 'Google Sheets', mono: 'S', description: 'Trabaja con tus hojas de cálculo.'},
    {slug: 'notion', name: 'Notion', mono: 'N', description: 'Consulta tus páginas y notas.'},
    {slug: 'slack', name: 'Slack', mono: 'S', description: 'Consulta tus canales y mensajes.'},
    {slug: 'github', name: 'GitHub', mono: 'G', description: 'Revisa issues y pull requests.'},
    {slug: 'supabase', name: 'Supabase', mono: 'S', description: 'Conecta tu proyecto de datos.'},
  ];
  const appName = slug => definitions.find(d => d.slug === slug)?.name || slug;
  const refresh = () => logic?.setState({connectionRevision: (logic.state.connectionRevision || 0) + 1});
  const pending = () => {try {return JSON.parse(sessionStorage.getItem('colmena-pending-link') || 'null');} catch {return null;}};
  async function api(route, body) {
    if (body && !token) token = (await (await fetch('/api/bootstrap')).json()).csrf;
    const response = await fetch('/api/connections/' + route, body ? {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Colmena-Token': token}, body: JSON.stringify(body)} : {});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'No se pudo completar la operación.');
    return data;
  }
  async function action(fn) {
    if (state.busy) return;
    state.busy = true; state.error = ''; refresh();
    try {return await fn();} catch (error) {state.error = error.message;}
    finally {state.busy = false; refresh();}
  }
  async function accounts() {
    const items = []; let cursor = '';
    for (let i = 0; i < 20; i++) {
      const page = await api('accounts?cursor=' + encodeURIComponent(cursor));
      items.push(...page.items); cursor = page.next_cursor;
      if (!cursor) break;
    }
    state.accounts = items;
  }
  async function loadConnections() {
    const status = await api('status'); state.available = status.available;
    if (state.available) await accounts();
    state.loaded = true;
    const p = pending();
    if (p && Date.now() - p.started > 600000) {
      sessionStorage.removeItem('colmena-pending-link');
      state.error = 'La autorización no se ha completado. Puedes volver a conectar la app.';
    } else if (p) {
      const account = state.accounts.find(a => a.toolkit === p.toolkit && a.status === 'ACTIVE' && !p.before.includes(a.id));
      if (account) {
        sessionStorage.removeItem('colmena-pending-link');
        location.assign('./Permissions.dc.html?account=' + encodeURIComponent(account.id)); return;
      }
    }
    refresh();
    clearTimeout(timer);
    if (pending() && !document.hidden) timer = setTimeout(() => action(loadConnections), 5000);
  }
  async function connect(toolkit) {
    if (!state.available || state.busy) {
      state.error = state.loaded ? 'El servicio de conexiones no está disponible. Contacta con el administrador.' : 'Cargando conexiones…'; refresh(); return;
    }
    // Open synchronously for popup policies, then navigate only to a validated provider URL.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    await action(async () => {
      try {
        const data = await api('link', {toolkit});
        const u = new URL(data.url);
        if (u.protocol !== 'https:' || !['connect.composio.dev', 'app.composio.dev'].includes(u.hostname) || u.username || u.password || u.port) throw Error('Enlace de autorización no válido.');
        sessionStorage.setItem('colmena-pending-link', JSON.stringify({toolkit, started: Date.now(), before: state.accounts.map(a => a.id)}));
        if (popup) popup.location.replace(u.href);
        else {
          window.open(u.href, '_blank', 'noopener');
          state.authorizationUrl = u.href;
          state.error = 'Si la autorización no se ha abierto, usa el botón para continuar.';
        }
        await loadConnections();
      } catch (e) {popup?.close(); throw e;}
    });
  }
  const filter = category => action(async () => {
    state.filter = category;
    state.catalogueOffset = 0; state.nextCursor = null;
    if (category === 'suggested' && !state.query) state.catalogue = null;
    else {
      const page = await api('catalogue?' + new URLSearchParams({category: category === 'suggested' ? '' : category, query: state.query}));
      state.catalogue = page.items; state.nextCursor = page.next_cursor;
    }
  });
  function connectionValues(instance, original) {
    const p = pending();
    const all = state.catalogue || definitions.filter(d => d.slug !== 'gmail' || !state.accounts.some(a => a.toolkit === 'gmail' && a.status === 'ACTIVE'));
    const selected = all.slice(state.catalogueOffset, state.catalogueOffset + 6);
    const vals = {...original,
      connectedHeading: state.accounts.length ? 'Conectadas' : 'Conectadas · ninguna',
      connectedAccounts: state.accounts.map(a => ({...a, mono: appName(a.toolkit)[0], name: appName(a.toolkit),
        statusLabel: a.status === 'ACTIVE' ? 'Conectada' : 'Pendiente de autorización',
        lastUse: '', connect: () => connect(a.toolkit), disconnect: () => action(async () => {await api('disconnect', {account: a.id}); await loadConnections();})})),
      serviceTitle: state.error ? 'Conexiones' : 'Tus apps',
      serviceMessage: state.error || (!state.loaded ? 'Cargando conexiones…' : !state.available ? 'El servicio de conexiones no está disponible. Contacta con el administrador.' : p ? 'Termina la autorización en la pestaña de tu app.' : 'Conecta las apps que quieres usar con tu equipo.'),
      unavailable: !state.available || state.busy,
      suggestLabel: state.authorizationUrl ? 'Abrir autorización' : p ? 'Comprobar conexión' : 'Conectar Calendar',
      suggestConnect: () => state.authorizationUrl ? window.open(state.authorizationUrl, '_blank', 'noopener') : p ? action(loadConnections) : connect('googlecalendar'),
      apps: selected.map(d => {
        const on = state.accounts.some(a => a.toolkit === d.slug && a.status === 'ACTIVE'), waiting = p?.toolkit === d.slug;
        return {mono: d.mono || d.name[0], name: d.name, desc: d.description,
          label: on ? 'Conectada' : waiting ? 'Esperando autorización…' : 'Conectar',
          btnBg: on ? '#E3EEE8' : waiting ? '#FBF1EC' : '#F2F2F0', btnFg: on ? '#2F6A4C' : waiting ? '#9A3B22' : '#1D1D1F',
          dot: on ? '#3A7D5C' : waiting ? '#B5482B' : '#A1A1A6', ring: waiting ? '0 0 0 1.5px #B5482B' : '0 0 0 1px rgba(0,0,0,0.06)',
          act: () => waiting ? action(loadConnections) : connect(d.slug)};
      }),
      searchApps: e => {state.query = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => filter(state.filter), 250);},
      catalogueLabel: state.catalogueOffset + 6 < all.length || state.nextCursor ? 'Ver más apps' : 'Ver el catálogo completo',
      fullCatalogue: e => {
        e.preventDefault();
        if (state.catalogueOffset + 6 < all.length) {state.catalogueOffset += 6; refresh(); return;}
        if (!state.nextCursor) return filter('');
        return action(async () => {
          const next = await api('catalogue?' + new URLSearchParams({category: state.filter === 'suggested' ? '' : state.filter, query: state.query, cursor: state.nextCursor}));
          state.catalogue = next.items; state.catalogueOffset = 0; state.nextCursor = next.next_cursor;
        });
      },
      goBack: () => location.assign('/#/settings'),
    };
    for (const key of ['suggested', 'mail', 'documents', 'team', 'development']) {
      vals['filter_' + key] = () => filter(key);
      vals['key_' + key] = e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); filter(key);}};
      vals['filterOn_' + key] = state.filter === key;
    }
    return vals;
  }
  async function loadPermission() {
    if (params.has('account')) {
      await accounts();
      state.account = state.accounts.find(a => a.id === params.get('account'));
      if (!state.account) throw Error('Cuenta no encontrada.');
    } else if (params.has('approval')) {
      state.review = await api('review/' + encodeURIComponent(params.get('approval')));
      if(state.review.kind==='send' && (state.review.review?.arguments.cc?.length || state.review.review?.arguments.bcc?.length)) {
        location.replace('/screens/EditarEnvio.dc.html?view=confirmar&approval='+encodeURIComponent(params.get('approval')));return;
      }
      if (state.review.status !== 'pending') state.error = state.review.result?.error || 'Esta solicitud ya está resuelta.';
    } else throw Error('No hay una cuenta ni una solicitud seleccionada.');
    state.loaded = true; refresh();
  }
  async function decide(decision) {
    stopHold();
    await action(async () => {
      const data = await api('review/' + encodeURIComponent(params.get('approval')), {
        decision, revision: state.review.revision, remember: !!logic.state.remember && state.review.kind === 'read'
      });
      if (data.error) {state.error = data.error; state.review.status = 'executed'; return;}
      location.assign('/#/inbox');
    });
  }
  function stopHold() {clearInterval(holdTimer); holdTimer = null; holdStartAt = 0; refresh();}
  function beginHold(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (holdTimer || state.busy || state.review?.status !== 'pending') return;
    holdStartAt = Date.now();
    holdTimer = setInterval(() => {if (Date.now() - holdStartAt >= 1200) decide('approved'); else refresh();}, 40);
    refresh();
  }
  function permissionValues(instance, original) {
    const r = state.review, p = r?.review, kind = params.has('account') ? 'name' : r?.kind || 'read';
    const error = state.error;
    const disabled = state.busy || !state.loaded || (r && r.status !== 'pending');
    return {...original, show_name: kind === 'name', show_read: kind === 'read', show_send: kind === 'send', busy: disabled,
      names: original.names.map(n => ({...n, pick: () => instance.setState({name: n.label, customName: undefined})})),
      accountTitle: appName(state.account?.toolkit || '') + ' está conectado',
      nameMessage: error || '¿Cómo quieres llamar a esta cuenta? Así sabrás cuál usa Colmena.',
      nameValue: instance.state.customName ?? original.nameValue.replace('Gmail', appName(state.account?.toolkit || 'gmail')),
      changeName: e => instance.setState({customName: e.target.value}),
      saveName: () => action(async () => {
        await api('rename', {account: state.account.id, alias: instance.state.customName ?? instance.state.name});
        location.assign('./Connections.dc.html');
      }),
      readTitle: p ? '¿Puedo consultar ' + appName(p.toolkit) + '?' : 'Revisar permiso',
      readMessage: error || 'Solo se consultarán los datos indicados. No se modificará tu cuenta.',
      accountLabel: p ? appName(p.toolkit) + ' · ' + p.account_alias : '',
      readDescription: p?.name || '',
      technicalDetails: p ? p.tool + '\n' + JSON.stringify(p.arguments, null, 2) + '\nCuenta: ' + p.account : '',
      rememberLabel: 'No volver a preguntar para estas lecturas en ' + (p ? appName(p.toolkit) : 'esta cuenta'),
      deny: () => decide('denied'), allow: () => decide('approved'),
      sendTitle: error || ('Voy a enviar este correo desde Gmail · ' + (p?.account_alias || '')),
      recipient: p?.arguments.recipient_email || '', subject: p?.arguments.subject || '', body: p?.arguments.body || '',
      holdW: holdStartAt ? Math.min(100, (Date.now() - holdStartAt) / 12) + '%' : '0%',
      sendLabel: state.busy ? 'Enviando…' : 'Mantén pulsado para enviar',
      holdStart: beginHold, holdEnd: stopHold,
      holdKeyStart: e => {if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {e.preventDefault(); beginHold(e);}},
      edit: () => location.assign('/screens/EditarEnvio.dc.html?approval='+encodeURIComponent(params.get('approval'))),
    };
  }
  function mount(instance, page) {
    logic = instance; mode = page;
    queueMicrotask(() => action(mode === 'connections' ? loadConnections : loadPermission));
  }
  window.addEventListener('focus', () => {if (mode === 'connections' && pending()) action(loadConnections);});
  document.addEventListener('visibilitychange', () => {stopHold(); if (document.hidden) clearTimeout(timer); else if (mode === 'connections' && pending()) action(loadConnections);});
  window.addEventListener('pagehide', () => {clearTimeout(timer); clearTimeout(searchTimer); stopHold();});
  return {mount, connectionValues, permissionValues};
})();

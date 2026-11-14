// «Este ordenador»: what this computer lends to the person's cloud bots (the agent's local
// allowlist) and «Llevar mis datos a la nube». Every change is saved at once; nothing is lent
// until the person turns it on here, bot by bot.
(function () {
  const api = window.colmenaAgent;
  const root = document.getElementById("app");
  let identity = null, state = { status: "starting" }, policy = null, bots = [], apps = null, saved = "", migrate = { preview: null, busy: false, progress: null, result: null, error: null, kinds: null };
  let logins = { open: false, managers: null, items: null, manager: null, error: null };
  let claude = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const newId = () => "f" + Math.random().toString(16).slice(2, 8);
  const STATUS = {
    online: ["ok", "Conectado"], connecting: ["", "Conectando…"], starting: ["", "Arrancando…"], pending: ["warn", "Esperando tu aprobación"],
    offline: ["off", "Sin conexión"], revoked: ["off", "Quitado de tus dispositivos"], unregistered: ["warn", "Sin añadir a tu empresa"], stopped: ["off", "Detenido"], idle: ["", "En pausa"],
  };
  const KIND_LABELS = { bots: "bots", skills: "habilidades", memories: "recuerdos", goals: "objetivos", automations: "rutinas", missions: "conversaciones", rooms: "salas", messages: "mensajes", wikiPages: "páginas de notas" };

  let timer = null;
  const save = () => {
    clearTimeout(timer);
    saved = "Guardando…";
    paintSaved();
    timer = setTimeout(async () => {
      try { policy = await api.setPolicy(policy); saved = "Guardado. Tus bots ya lo ven así."; }
      catch (e) { saved = "No se pudo guardar: " + e.message; }
      paintSaved();
    }, 250);
  };
  const paintSaved = () => { const el = document.getElementById("saved"); if (el) el.textContent = saved; };

  const botChips = (list, onToggle, key) => {
    if (!bots.length) return '<span class="muted small">Cuando este ordenador esté conectado verás aquí tus bots.</span>';
    return '<div class="chips" role="group" aria-label="Bots">' + bots.map((b) => '<button type="button" class="chip" data-bot="' + esc(b.id) + '" data-key="' + esc(key) + '" aria-pressed="' + (list.includes(b.id) ? "true" : "false") + '">' + esc(b.name) + "</button>").join("") + "</div>";
  };
  const capCard = (id, title, text, extra = "") => {
    const c = policy[id];
    return '<section class="card cap" aria-labelledby="t-' + id + '"><div class="cap-top"><div><h2 id="t-' + id + '">' + esc(title) + "</h2><p>" + text + "</p></div>" +
      '<label class="switch"><input type="checkbox" data-switch="' + id + '"' + (c.enabled ? " checked" : "") + ' aria-labelledby="t-' + id + '"><span></span></label></div>' +
      (c.enabled ? '<div><div class="label">Qué bots</div>' + botChips(c.bots, null, id) + "</div>" + extra : "") + "</section>";
  };

  function render() {
    const [tone, label] = STATUS[state.status] || ["", state.status];
    const reg = identity?.registration;
    const who = state.person ? esc(state.person.email || state.person.name) : "";
    let html = '<div class="head"><div><h1>Este ordenador</h1><p class="lead">Lo que prestas aquí lo pueden usar tus bots de la nube cuando <strong>tú</strong> les pides algo. Nunca un compañero, y nunca más de lo que marques. Enviar, pagar o publicar siempre te pregunta.</p></div>' +
      '<div class="status"><span class="pill ' + tone + '"><span class="dot"></span>' + esc(label) + "</span>" +
      '<span class="muted small">' + esc(identity?.name || "") + (state.workspace?.name ? " · " + esc(state.workspace.name) : "") + "</span>" + (who ? '<span class="muted small">' + who + "</span>" : "") + "</div></div>";
    if (!reg) html += '<div class="notice warn">Este ordenador aún no está en tu empresa. En la ventana de Colmena, abre <strong>Ajustes › Tus dispositivos</strong> y pulsa «Añadir este ordenador».</div>';
    else if (state.status === "pending") html += '<div class="notice warn">Falta tu aprobación. En <strong>Ajustes › Tus dispositivos</strong>, comprueba que la huella es <strong>' + esc(identity.fingerprint) + "</strong> y pulsa «Aprobar».</div>";
    else if (state.status === "revoked") html += '<div class="notice warn">Quitaste este ordenador de tus dispositivos. Para volver a usarlo, añádelo otra vez desde Ajustes › Tus dispositivos.</div>';
    html += '<div id="saved" class="saved" role="status">' + esc(saved) + "</div>";
    if (policy && reg) {
      // Folders
      html += '<section class="card cap" aria-labelledby="t-carpetas"><div class="cap-top"><div><h2 id="t-carpetas">Carpetas</h2><p>Tus bots leen los archivos de estas carpetas, y solo de estas. No pueden salir de ellas.</p></div>' +
        '<button type="button" class="btn ghost small" id="add-folder">Prestar una carpeta…</button></div>';
      if (!policy.folders.length) html += '<span class="muted small">Ninguna carpeta prestada.</span>';
      for (const f of policy.folders) {
        html += '<div class="folder"><div class="folder-top"><strong>' + esc(f.label) + '</strong><span class="path" title="' + esc(f.path) + '">' + esc(f.path) + "</span>" +
          '<button type="button" class="btn danger small" data-remove="' + esc(f.id) + '">Dejar de prestar</button></div>' +
          '<div class="row"><span class="small muted">Pueden</span><div class="chips"><button type="button" class="chip" data-access="' + esc(f.id) + '" data-value="lee" aria-pressed="' + (f.access !== "escribe") + '">Leer</button><button type="button" class="chip" data-access="' + esc(f.id) + '" data-value="escribe" aria-pressed="' + (f.access === "escribe") + '">Leer y escribir</button></div></div>' +
          '<div><div class="label">Qué bots</div>' + botChips(f.bots, null, "folder:" + f.id) + "</div></div>";
      }
      html += "</section>";
      html += capCard("navegador", "Navegador con tus sesiones", "Tus bots abren páginas en el navegador de Colmena de este ordenador, con las sesiones que tengas abiertas allí. Rellenar un formulario te avisa; enviarlo te pregunta.");
      const appChips = apps === null ? '<span class="muted small">Buscando apps…</span>' : apps.length ? '<div class="chips">' + apps.map((a) => '<button type="button" class="chip" data-app="' + esc(a.id) + '" aria-pressed="' + policy.ordenador.apps.some((x) => x.id === a.id) + '">' + esc(a.label) + "</button>").join("") + "</div>" : '<span class="muted small">No encuentro apps conocidas en este ordenador.</span>';
      html += capCard("ordenador", "Apps y programas", "Abrir documentos de tus carpetas y las apps que marques, y ejecutar programas. Ejecutar un programa siempre te pregunta antes.", '<div><div class="label">Apps que pueden abrir</div>' + appChips + "</div>");
      const loginRows = policy.contrasenas.logins.map((l) => '<div class="item"><span><strong>' + esc(l.label || l.domain) + '</strong> <span class="muted small">' + esc(l.domain) + " · " + esc(l.username || "") + '</span></span><button type="button" class="btn danger small" data-unlogin="' + esc(l.id) + '">Quitar</button></div>').join("");
      let chooser = "";
      if (logins.open) {
        if (logins.error) chooser = '<div class="notice warn">' + esc(logins.error) + "</div>";
        else if (!logins.managers) chooser = '<span class="muted small">Mirando tus gestores…</span>';
        else if (!logins.items) chooser = '<div class="row">' + logins.managers.map((m) => '<button type="button" class="btn ghost small" data-manager="' + esc(m.id) + '"' + (m.state === "connected" ? "" : " disabled") + ">" + esc(m.label) + " · " + esc(m.detail || m.state) + "</button>").join("") + "</div>";
        else chooser = '<div class="items">' + (logins.items.length ? logins.items.map((it) => '<div class="item"><span><strong>' + esc(it.title) + '</strong> <span class="muted small">' + esc((it.domain || "") + (it.user ? " · " + it.user : "")) + '</span></span><button type="button" class="btn ghost small" data-choose="' + esc(it.itemId) + '">Prestar</button></div>').join("") : '<span class="muted small">No hay inicios de sesión.</span>') + "</div>";
      }
      html += capCard("contrasenas", "Gestor de contraseñas", "Tus bots entran en webs con un inicio de sesión de 1Password o Bitwarden que marques. Ni la nube ni el bot ven nunca la contraseña: se rellena aquí, en este ordenador.",
        '<div><div class="label">Inicios de sesión prestados</div><div class="items">' + (loginRows || '<span class="muted small">Ninguno todavía.</span>') + '</div></div><div class="row"><button type="button" class="btn ghost small" id="logins">' + (logins.open ? "Cerrar" : "Elegir un inicio de sesión…") + "</button></div>" + chooser);
      const codeFolders = policy.codigo.folders.map((f) => '<div class="item"><span><strong>' + esc(f.label) + '</strong> <span class="muted small">' + esc(f.path) + '</span></span><button type="button" class="btn danger small" data-uncode="' + esc(f.id) + '">Quitar</button></div>').join("");
      const claudeLine = claude === null ? "" : claude.status === "available" ? '<span class="pill ok"><span class="dot"></span>Claude Code con la cuenta ' + esc(claude.email || "de este ordenador") + "</span>" : '<span class="pill warn"><span class="dot"></span>' + (claude.status === "not_installed" ? "Claude Code no está instalado aquí" : "Claude Code no tiene sesión iniciada") + "</span>";
      html += capCard("codigo", "Claude Code de este ordenador", "Tus bots pueden pedir a Claude Code, con tu propia cuenta, que haga una tarea en una carpeta de proyecto. Puede leer y editar archivos de esa carpeta, no ejecutar órdenes. Cada tarea te pregunta antes.",
        '<div class="row">' + claudeLine + '</div><div><div class="label">Carpetas de proyecto</div><div class="items">' + (codeFolders || '<span class="muted small">Ninguna todavía.</span>') + '</div></div><div class="row"><button type="button" class="btn ghost small" id="add-code">Añadir una carpeta de proyecto…</button></div>');
    }
    // Migration
    if (reg) {
      const m = migrate;
      html += '<section class="card cap" aria-labelledby="t-migrate"><div class="cap-top"><div><h2 id="t-migrate">Llevar mis datos a la nube</h2><p>Sube a tu empresa los bots, sus SOUL, recuerdos y habilidades, rutinas, salas y conversaciones de tu Colmena de este ordenador. Las claves y contraseñas no viajan: vuelve a escribir tus claves de IA en la nube. Puedes repetirlo: lo que ya subiste no se duplica.</p></div></div>';
      if (m.error) html += '<div class="notice warn">' + esc(m.error) + "</div>";
      if (m.preview) {
        const kinds = m.kinds || Object.keys(m.preview.counts).filter((k) => m.preview.counts[k] > 0);
        html += '<div class="counts">' + Object.entries(m.preview.counts).filter(([, n]) => n > 0).map(([k, n]) => '<button type="button" class="chip" data-kind="' + esc(k) + '" aria-pressed="' + kinds.includes(k) + '">' + n + " " + esc(KIND_LABELS[k] || k) + "</button>").join("") + "</div>";
        html += '<p class="small muted" style="margin:0">Tus conversaciones solo las verás tú. Las rutinas llegan en pausa. Los recuerdos de tus bots los usan los bots de toda la empresa.</p>';
      }
      if (m.progress) html += '<div class="progress" aria-hidden="true"><span style="width:' + Math.round((m.progress.done / Math.max(1, m.progress.total)) * 100) + '%"></span></div><span class="small muted">Subiendo ' + m.progress.done + " de " + m.progress.total + "…</span>";
      if (m.result) html += '<div class="notice">Hecho: ' + m.result.totals.created + " nuevos, " + m.result.totals.updated + " actualizados, " + m.result.totals.unchanged + " ya estaban" + (m.result.totals.skipped ? ", " + m.result.totals.skipped + " se quedan aquí" : "") + ".</div>";
      html += '<div class="row">' + (m.preview ? '<button type="button" class="btn" id="upload"' + (m.busy || state.status !== "online" ? " disabled" : "") + ">" + (m.busy ? "Subiendo…" : "Subir a la nube") + "</button>" : '<button type="button" class="btn ghost" id="preview"' + (m.busy ? " disabled" : "") + ">Ver qué se subiría</button>") + (state.status !== "online" ? '<span class="small muted">Hace falta que este ordenador esté conectado.</span>' : "") + "</div></section>";
    }
    root.innerHTML = html;
  }

  root.addEventListener("click", async (e) => {
    const t = e.target.closest("button, input");
    if (!t) return;
    if (t.dataset.bot) {
      const key = t.dataset.key;
      const list = key.startsWith("folder:") ? policy.folders.find((f) => f.id === key.slice(7)).bots : policy[key].bots;
      const i = list.indexOf(t.dataset.bot);
      if (i >= 0) list.splice(i, 1); else list.push(t.dataset.bot);
      save(); render();
    } else if (t.dataset.access) {
      policy.folders.find((f) => f.id === t.dataset.access).access = t.dataset.value;
      save(); render();
    } else if (t.dataset.remove) {
      policy.folders = policy.folders.filter((f) => f.id !== t.dataset.remove);
      save(); render();
    } else if (t.dataset.app) {
      const has = policy.ordenador.apps.some((a) => a.id === t.dataset.app);
      policy.ordenador.apps = has ? policy.ordenador.apps.filter((a) => a.id !== t.dataset.app) : [...policy.ordenador.apps, apps.find((a) => a.id === t.dataset.app)];
      save(); render();
    } else if (t.dataset.unlogin) {
      policy.contrasenas.logins = policy.contrasenas.logins.filter((l) => l.id !== t.dataset.unlogin);
      save(); render();
    } else if (t.dataset.uncode) {
      policy.codigo.folders = policy.codigo.folders.filter((f) => f.id !== t.dataset.uncode);
      save(); render();
    } else if (t.dataset.manager) {
      logins.manager = t.dataset.manager; logins.items = null; render();
      try { logins.items = (await api.managerItems(t.dataset.manager)) || []; } catch (err) { logins.error = err.message; }
      render();
    } else if (t.dataset.choose) {
      try {
        const l = await api.chooseLogin(logins.manager, t.dataset.choose);
        if (l && !policy.contrasenas.logins.some((x) => x.id === l.id)) policy.contrasenas.logins.push({ id: l.id, label: l.title || l.label || l.domain, domain: l.domain, username: l.username || l.user || "", bots: [] });
        logins = { open: false, managers: null, items: null, manager: null, error: null };
        save();
      } catch (err) { logins.error = err.message; }
      render();
    } else if (t.dataset.kind) {
      const all = Object.keys(migrate.preview.counts).filter((k) => migrate.preview.counts[k] > 0);
      const now = migrate.kinds || all;
      migrate.kinds = now.includes(t.dataset.kind) ? now.filter((k) => k !== t.dataset.kind) : [...now, t.dataset.kind];
      render();
    } else if (t.id === "add-folder" || t.id === "add-code") {
      const chosen = await api.pickFolder(t.id === "add-code" ? "code" : "share");
      if (!chosen) return;
      const label = chosen.split(/[\\/]/).filter(Boolean).pop() || chosen;
      if (t.id === "add-folder") { if (!policy.folders.some((f) => f.path === chosen)) policy.folders.push({ id: newId(), path: chosen, label, access: "lee", bots: [] }); }
      else if (!policy.codigo.folders.some((f) => f.path === chosen)) policy.codigo.folders.push({ id: newId(), path: chosen, label });
      save(); render();
    } else if (t.id === "logins") {
      logins = { open: !logins.open, managers: null, items: null, manager: null, error: null };
      render();
      if (logins.open) { try { logins.managers = await api.managers(); } catch (err) { logins.error = err.message; } render(); }
    } else if (t.id === "preview") {
      migrate = { ...migrate, busy: true, error: null }; render();
      try { migrate.preview = await api.migratePreview(); } catch (err) { migrate.error = err.message; }
      migrate.busy = false; render();
    } else if (t.id === "upload") {
      migrate = { ...migrate, busy: true, error: null, result: null, progress: { done: 0, total: 1 } }; render();
      try { migrate.result = await api.migrate(migrate.kinds || undefined); } catch (err) { migrate.error = err.message; }
      migrate.busy = false; migrate.progress = null; render();
    }
  });
  root.addEventListener("change", (e) => {
    const sw = e.target.dataset?.switch;
    if (!sw) return;
    policy[sw].enabled = e.target.checked;
    if (sw === "ordenador" && e.target.checked && apps === null) api.apps().then((a) => { apps = a || []; render(); }).catch(() => { apps = []; render(); });
    if (sw === "codigo" && e.target.checked && claude === null) api.claude().then((c) => { claude = c; render(); }).catch(() => {});
    save(); render();
  });
  document.querySelectorAll("[data-window]").forEach((b) => b.addEventListener("click", () => api.window(b.dataset.window)));

  api.onEvent((event) => {
    if (event.type === "agent") { state = event.state || state; bots = state.bots?.length ? state.bots : bots; render(); }
    if (event.type === "migrate" && event.progress) { migrate.progress = event.progress; render(); }
  });
  (async () => {
    identity = await api.identity();
    state = identity.agent || state;
    bots = state.bots || [];
    try { const s = await api.status(); policy = s.policy; state = s.state || state; bots = state.bots?.length ? state.bots : bots; } catch (e) { saved = e.message; }
    if (policy?.ordenador?.enabled) api.apps().then((a) => { apps = a || []; render(); }).catch(() => { apps = []; render(); });
    if (policy?.codigo?.enabled) api.claude().then((c) => { claude = c; render(); }).catch(() => {});
    render();
  })();
})();

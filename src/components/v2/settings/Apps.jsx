import Select from "../../Select.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { del, get, patch, post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { useStore } from "../../../lib/store.jsx";
import { isHidden, later, useHiddenVersion } from "../../../lib/undoToast.js";
import { useExpert } from "../../../lib/expert.js";
import AppLogo from "../../settings/AppLogo.jsx";
import { appName, linkUrl, loadAccounts, loadCatalogue, loadStatus, pendingLink, rememberApps, setPendingLink } from "../../settings/connections.jsx";
import { Alert, BotMark, Chip, Go, INK, LINE, LINK, MUTED, SOFT, Term, UNDO_MS, anchorOf, btn, h3, mono, select, srOnly } from "./v3.jsx";

// Ajustes › Apps y carpetas (design/V3Conexiones.dc.html): the apps your bots work with —
// direct MCP connections first, the rest (Google, Microsoft, Slack…) through Composio —, the
// catalogue to connect another one, this computer's folders and the bots' own browser. What
// each bot may touch is decided in Permisos. Own tools and MCP servers by address go in
// Avanzado. After a Composio sign-in, /permisos/:id asks what the new account may do.

const FILTERS = [["todas", "Todas"], ["mail", "Correo y agenda"], ["documents", "Archivos"], ["team", "Mensajería"], ["business", "Ventas y facturas"], ["development", "Desarrollo"]];
const SUGGESTED = ["gmail", "googlecalendar", "notion", "googlesheets", "slack", "atlassian", "linear", "dropbox", "stripe"];
const UNAVAILABLE = "Ahora no se puede llegar al servicio de apps. Comprueba tu conexión a internet y vuelve a intentarlo en un momento.";
const NEEDS_ACCOUNT = "Las apps se conectan con tu cuenta de IA. Conéctala primero en Cuentas de IA y vuelve aquí.";
const ACCESS = [["lee", "Solo leer"], ["escribe", "Leer y escribir"]];
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PAGE = 8;
// Which kind of app (bot.tools, Permisos › Qué app usa cada bot) a Composio toolkit is.
const KIND_OF = { gmail: "correo", outlook: "correo", googlecalendar: "calendario", outlookcalendar: "calendario", googledrive: "carpeta", dropbox: "carpeta", onedrive: "carpeta", box: "carpeta", googlesheets: "hojas", excel: "hojas", slack: "chat", microsoftteams: "chat", teams: "chat", holded: "erp", quickbooks: "erp", xero: "erp" };
const names = (list) => (list.length === 1 ? list[0] : list.slice(0, -1).join(", ") + " y " + list.at(-1));

function useConnections(initialQuery) {
  const { account, provider } = useStore();
  const noAccount = !account && !provider?.kind;
  const [available, setAvailable] = useState(false); // Composio
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [curated, setCurated] = useState([]);
  const [mcpOk, setMcpOk] = useState(true);
  const [servers, setServers] = useState([]);
  const [catalogue, setCatalogue] = useState(null); // Composio search results
  const [nextCursor, setNextCursor] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState(null);
  const [pending, setPending] = useState(pendingLink);
  const [mcpPending, setMcpPending] = useState(null); // {id, name}
  const busyRef = useRef(false);
  const timer = useRef(null);

  const action = useCallback(async (fn) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try { return await fn(); } catch (e) { setError(e.message || "No se pudo completar la operación."); return undefined; } finally { busyRef.current = false; setBusy(false); }
  }, []);
  const loadMcp = useCallback(async () => {
    const data = await get("/mcp/catalog");
    setMcpOk(data?.available !== false);
    setCurated(data?.items || []);
    rememberApps((data?.items || []).map((i) => ({ slug: i.toolkit || i.id, name: i.name })));
    const list = (await get("/mcp/servers"))?.servers || [];
    setServers(list);
    return list;
  }, []);
  const load = useCallback(async () => {
    const [ok] = await Promise.all([loadStatus().catch(() => false), loadMcp()]);
    setAvailable(ok);
    const list = ok ? await loadAccounts() : [];
    setAccounts(list);
    setLoaded(true);
    const p = pendingLink();
    if (p && Date.now() - p.started > 600000) {
      setPendingLink(null); setPending(null); setAuthorizationUrl(null);
      throw Error("La autorización no se ha completado. Puedes volver a conectar la app.");
    }
    if (p) {
      const found = list.find((a) => a.toolkit === p.toolkit && a.status === "ACTIVE" && !p.before.includes(a.id));
      if (found) { setPendingLink(null); navigate(`/permisos/${encodeURIComponent(found.id)}?cuenta=1`); return; }
    }
    setPending(p);
  }, [loadMcp]);
  const search = useCallback((category, text) => action(async () => {
    setNextCursor(null);
    if (!text || !available) { setCatalogue(null); return; }
    // Searching also asks Composio, for apps beyond the curated catalogue.
    const page = await loadCatalogue({ category: category === "todas" || category === "business" ? "" : category, query: text });
    setCatalogue(page?.items || []);
    setNextCursor(page?.next_cursor || null);
  }), [action, available]);
  const more = (category, text) => action(async () => {
    const page = await loadCatalogue({ category: category === "todas" || category === "business" ? "" : category, query: text, cursor: nextCursor });
    setCatalogue((c) => [...(c || []), ...(page?.items || [])]);
    setNextCursor(page?.next_cursor || null);
  });

  useEffect(() => { action(async () => { await load(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (loaded && initialQuery) search("todas", initialQuery); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // While an authorization is pending, re-check every few seconds and when the window regains focus.
  useEffect(() => {
    clearTimeout(timer.current);
    if (!pending && !mcpPending) return undefined;
    const check = async () => {
      if (document.hidden) return;
      if (mcpPending) {
        const list = await loadMcp().catch(() => null);
        const s = list?.find((x) => x.id === mcpPending.id);
        if (s && s.status !== "needs_auth" && s.status !== "connecting") {
          setMcpPending(null); setAuthorizationUrl(null);
          if (s.status === "error") setError(s.error || "No se pudo conectar.");
          return;
        }
      }
      if (pending) action(load);
      timer.current = setTimeout(check, 3000);
    };
    timer.current = setTimeout(check, 3000);
    window.addEventListener("focus", check);
    return () => { clearTimeout(timer.current); window.removeEventListener("focus", check); };
  }, [pending, mcpPending, accounts, action, load, loadMcp]);

  // Opens a tab synchronously (popup policies); in the desktop app the URL goes to the system browser.
  const openAuth = async (getUrl) => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const url = await getUrl();
      if (!url) { popup?.close(); return; }
      if (popup) popup.location.replace(url);
      else window.open(url, "_blank", "noopener");
      setAuthorizationUrl(url);
    } catch (e) { popup?.close(); throw e; }
  };
  const connectComposio = async (toolkit) => {
    if (!available || busyRef.current) { setError(loaded ? (noAccount ? NEEDS_ACCOUNT : UNAVAILABLE) : "Cargando conexiones…"); return; }
    await action(() => openAuth(async () => {
      const url = await linkUrl(toolkit);
      const p = { toolkit, started: Date.now(), before: accounts.map((a) => a.id) };
      setPendingLink(p); setPending(p);
      return url;
    }));
  };
  const connectMcp = (body) => action(() => openAuth(async () => {
    const out = await post("/mcp/connect", body);
    await loadMcp();
    if (!out.authorizeUrl) return null; // connected without a sign-in
    const u = new URL(out.authorizeUrl);
    if (u.protocol !== "https:" || u.username || u.password) throw Error("Enlace de autorización no válido.");
    setMcpPending({ id: out.server.id, name: out.server.name });
    return u.href;
  }));
  const connect = (item) => (item.via === "mcp" ? connectMcp({ catalogId: item.id }) : connectComposio(item.toolkit || item.slug));
  const disconnect = (a) => action(async () => { await post("/connections/disconnect", { account: a.id }); await load(); });
  const removeServer = (s) => action(async () => { await del(`/mcp/servers/${encodeURIComponent(s.id)}`); await loadMcp(); });
  const rename = (a, alias) => action(async () => { await post("/connections/rename", { account: a.id, alias }); setAccounts(await loadAccounts()); return true; });
  return { noAccount, available, loaded, accounts, curated, mcpOk, servers, catalogue, nextCursor, error, setError, busy, authorizationUrl, pending, mcpPending, action, load, search, more, connect, connectComposio, connectMcp, disconnect, removeServer, rename };
}

/** One connected app: its logo, name and state, and «Ajustar» for what you can do with it. */
function Connected({ row, c, first, team }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(null);
  const s = row.s, a = row.a;
  const ok = s ? s.status === "connected" : a.status === "ACTIVE";
  const waiting = s ? s.status === "needs_auth" || s.status === "connecting" : !ok;
  const meta = s ? c.curated.find((x) => x.id === s.catalogId) : c.curated.find((x) => x.toolkit === a.toolkit);
  const label = s ? s.name : appName(a.toolkit);
  const note = s
    ? (ok ? `Conexión directa · ${s.toolCount} ${s.toolCount === 1 ? "acción" : "acciones"}` : waiting ? "Pendiente de autorización en tu navegador." : s.error || "Hay que volver a entrar.")
    : (ok ? a.alias || "Conectada" : "Pendiente de autorización en tu navegador.");
  const trouble = s ? !ok && !waiting : false;
  const kind = a ? KIND_OF[a.toolkit] : null;
  const users = kind ? team.filter((b) => (b.tools?.[kind] || "none") !== "none") : [];
  const reconnect = () => (s ? c.connectMcp(s.catalogId ? { catalogId: s.catalogId } : { url: s.url, name: s.name }) : c.connectComposio(a.toolkit));
  const remove = () => later({
    id: s ? "mcp:" + s.id : "account:" + a.id, keys: [s ? "mcp:" + s.id : "account:" + a.id], ms: UNDO_MS, text: `${label} desconectada`, error: "No se pudo desconectar",
    run: () => (s ? c.removeServer(s) : c.disconnect(a)),
  });
  return (
    <li style={{ display: "flex", flexDirection: "column", background: trouble ? "#FFF6DC" : "#FFFFFF", borderTop: first ? 0 : LINE }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", minHeight: "68px", padding: "12px 18px" }}>
        <AppLogo id={meta?.id || s?.catalogId || a?.toolkit} name={label} logo={meta?.logo} size={40} />
        <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ fontSize: "15px", fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: "13px", lineHeight: 1.4, color: trouble || waiting ? "#8A5A00" : MUTED }}>{note}</span>
        </span>
        {users.length ? (
          <span title={"La usan " + names(users.map((b) => b.name))} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={srOnly}>{"La usan " + names(users.map((b) => b.name))}</span>
            {users.slice(0, 6).map((b) => <BotMark key={b.id} bot={b} />)}
          </span>
        ) : null}
        {trouble ? <button type="button" disabled={c.busy} onClick={reconnect} style={btn("dark", 34)}>Volver a entrar</button>
          : <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={btn("outline", 34)}>Ajustar</button>}
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "0 18px 14px 72px", animation: "fade .25s ease-out" }}>
          <span style={{ fontSize: "13px", lineHeight: 1.5, color: MUTED }}>Leer y buscar, sin preguntar. Cambiar algo, con tu OK. Enviar, borrar, pagar o publicar, siempre tú.</span>
          {name !== null ? (
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) c.rename(a, name.trim()).then((done) => done && setName(null)); }} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <input autoFocus aria-label="Nombre de la cuenta" value={name} maxLength={80} placeholder={appName(a.toolkit) + " trabajo"} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setName(null); }} style={{ ...select, width: "240px", padding: "0 12px", height: "34px" }} />
              <button type="submit" disabled={c.busy || !name.trim()} style={btn("dark", 34)}>Guardar</button>
              <button type="button" onClick={() => setName(null)} style={btn("ghost", 34)}>Cancelar</button>
            </form>
          ) : (
            <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <Go to="/ajustes/permisos#que-app" style={btn("outline", 32)}>Qué puede hacer cada bot</Go>
              {a ? <button type="button" onClick={() => setName(a.alias || "")} style={btn("outline", 32)}>Cambiar el nombre</button> : null}
              {a ? <button type="button" disabled={c.busy} onClick={() => c.connectComposio(a.toolkit)} style={btn("outline", 32)}>Añadir otra cuenta</button> : null}
              {s && !ok ? <button type="button" disabled={c.busy} onClick={reconnect} style={btn("outline", 32)}>Volver a entrar</button> : null}
              <button type="button" disabled={c.busy} onClick={remove} style={{ ...btn("ghost", 32), color: "#B4232A" }}>Desconectar</button>
            </span>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Catalogue({ c, initialQuery }) {
  const [expert] = useExpert();
  const [filter, setFilter] = useState("todas");
  const [text, setText] = useState(initialQuery || "");
  const [shown, setShown] = useState(PAGE);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const words = fold(text).split(/\s+/).filter(Boolean);
  const matches = (i) => words.every((w) => fold(i.name + " " + i.description).includes(w));
  const curated = c.curated
    .filter((i) => (filter === "todas" ? true : i.category === filter) && matches(i))
    .sort((x, y) => (words.length ? 0 : (SUGGESTED.indexOf(y.id) > -1) - (SUGGESTED.indexOf(x.id) > -1)));
  const known = new Set(c.curated.map((i) => i.toolkit || i.id));
  const extra = (c.catalogue || []).filter((d) => !known.has(d.slug)).map((d) => ({ id: d.slug, name: d.name, description: d.description, via: "composio", toolkit: d.slug, logo: d.logo || null }));
  const all = [...curated, ...extra];
  const list = all.slice(0, shown);
  const on = (item) => (item.via === "mcp"
    ? c.servers.some((s) => s.catalogId === item.id && s.status === "connected")
    : c.accounts.some((a) => a.toolkit === item.toolkit && a.status === "ACTIVE"));
  const waiting = (item) => (item.via === "mcp" ? c.mcpPending && c.servers.some((s) => s.catalogId === item.id && s.id === c.mcpPending.id) : c.pending?.toolkit === item.toolkit);
  const pick = (f) => { setFilter(f); setShown(PAGE); c.search(f, text); };
  const type = (value) => { setText(value); setShown(PAGE); clearTimeout(t.current); t.current = setTimeout(() => c.search(filter, value), 300); };
  const canMore = shown < all.length || !!c.nextCursor;
  const showMore = (e) => { e.preventDefault(); if (shown < all.length) setShown(shown + 12); else c.more(filter, text); };
  const status = c.mcpPending ? `Termina de autorizar ${c.mcpPending.name} en tu navegador. Colmena lo detecta solo.`
    : c.pending ? `Termina la autorización de ${appName(c.pending.toolkit)} en tu navegador. Colmena lo detecta solo.`
    : c.loaded && !c.available ? (c.noAccount ? "Las apps del servicio de conexiones (Gmail, Calendar, Slack…) se activan cuando conectes tu cuenta de IA. Las de conexión directa ya funcionan." : UNAVAILABLE) : null;
  return (
    <section {...anchorOf("conectar-app")} aria-labelledby="add-t" style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px 22px", borderRadius: "20px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <h3 id="add-t" style={{ ...h3, flex: "1 1 180px" }}>Conectar otra app</h3>
        <label style={{ flex: "0 1 260px", display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 12px", borderRadius: "10px", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.12)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C606C" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2" /></svg>
          <span style={srOnly}>Buscar una app</span>
          <input className="c-bare" type="text" value={text} onChange={(e) => type(e.target.value)} placeholder={`Buscar entre ${c.curated.length > 30 ? "cientos de" : "todas las"} apps`} style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "14px", color: INK }} />
        </label>
      </div>
      <div role="group" aria-label="Filtrar por tipo" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {FILTERS.map(([id, label]) => {
          const sel = filter === id;
          return <button key={id} type="button" aria-pressed={sel} onClick={() => pick(id)} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", background: sel ? INK : "#F1F1EC", color: sel ? "#FFFFFF" : "#3D404A", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>{label}</button>;
        })}
      </div>
      {status ? (
        <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "10px 14px", borderRadius: "12px", background: c.pending || c.mcpPending ? "#FFF6DC" : "#F6F6F3", fontSize: "13.5px", lineHeight: 1.45, color: c.pending || c.mcpPending ? "#8A5A00" : SOFT }}>
          <span style={{ flex: "1 1 260px" }}>{status}</span>
          {c.authorizationUrl && (c.pending || c.mcpPending) ? <button type="button" onClick={() => window.open(c.authorizationUrl, "_blank", "noopener")} style={btn("outline", 32)}>Abrir autorización</button> : null}
          {c.pending ? <button type="button" disabled={c.busy} onClick={() => c.action(c.load)} style={btn("outline", 32)}>Comprobar</button> : null}
          {c.loaded && !c.available && c.noAccount ? <Go to="/ajustes/ia" style={btn("dark", 32)}>Conectar mi cuenta</Go> : null}
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(172px, 100%), 1fr))", gap: "8px" }}>
        {c.loaded && !list.length ? <p style={{ gridColumn: "1 / -1", margin: 0, padding: "18px 0", textAlign: "center", fontSize: "14px", color: MUTED }}>{text ? `No hay apps que coincidan con «${text}».` : "No hay apps en este tipo."}</p> : null}
        {!c.loaded ? Array.from({ length: 4 }, (_, i) => <span key={i} style={{ minHeight: "56px", borderRadius: "14px", background: "linear-gradient(90deg, #F6F6F3, #EEEEEA, #F6F6F3)", backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite" }} />) : null}
        {list.map((d) => {
          const isOn = on(d), wait = waiting(d);
          const blocked = d.via === "composio" ? !c.available && c.loaded : !c.mcpOk;
          return (
            <button key={d.via + ":" + d.id} type="button" disabled={c.busy || blocked || (isOn && d.via === "mcp")} onClick={() => (wait && d.via === "composio" ? c.action(c.load) : c.connect(d))}
              aria-label={isOn ? `${d.name} conectada` : wait ? `Comprobar la autorización de ${d.name}` : `Conectar ${d.name}`}
              title={blocked ? (d.via === "composio" ? (c.noAccount ? NEEDS_ACCOUNT : UNAVAILABLE) : "Las conexiones directas solo funcionan en la aplicación de escritorio.") : d.description}
              style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "56px", padding: "8px 12px 8px 10px", border: 0, borderRadius: "14px", background: "#F6F6F3", textAlign: "left", color: INK, cursor: blocked ? "default" : "pointer", opacity: blocked ? 0.55 : 1, boxShadow: wait ? "inset 0 0 0 1.5px #FFC93C" : "none", animation: "fade .3s ease-out" }}>
              <span style={{ flex: "none", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "10px", background: "#FFFFFF", overflow: "hidden" }}><AppLogo id={d.id} name={d.name} logo={d.logo} size={30} /></span>
              <span style={{ flex: 1, minWidth: 0, fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              {isOn ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B6B4A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d="m5 12 5 5 9-10" /></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C606C" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}><path d="M12 5.5v13M5.5 12h13" /></svg>}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "6px 16px", fontSize: "13px" }}>
        {canMore ? <a href="#conectar-app" onClick={showMore} style={{ fontWeight: 600, color: LINK }}>{shown < all.length ? `Ver las ${all.length} apps` : "Ver más apps"}</a> : <span />}
        <span style={{ color: MUTED }}>¿Una herramienta propia o un servidor <Term tip="Model Context Protocol: una forma estándar de darle herramientas nuevas a un bot.">MCP</Term>? Va en {expert ? <Go to="/ajustes/avanzado#mcp">Avanzado</Go> : <Go to="/ajustes/general#modo-experto">Avanzado (modo experto)</Go>}.</span>
      </div>
    </section>
  );
}

function Folders() {
  const { folders = [], bots = [], run } = useStore();
  const [error, setError] = useState(null);
  useHiddenVersion();
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const list = folders.filter((f) => !isHidden("folder:" + f.id));
  const add = async () => {
    if (!window.colmenaWindow?.pickFolder) { navigate("/ajustes/ordenador"); return; }
    const chosen = await window.colmenaWindow.pickFolder().catch(() => null);
    if (!chosen) return;
    setError(null);
    try { await run(() => post("/folders", { path: chosen })); } catch (e) { setError(e.message); }
  };
  const access = (f, v) => run(() => patch(`/folders/${encodeURIComponent(f.id)}`, { access: v })).catch((e) => setError(e.message));
  return (
    <section {...anchorOf("carpetas")} aria-labelledby="fold-t" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px 22px 10px", borderRadius: "20px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
        <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <h3 id="fold-t" style={h3}>Carpetas de este ordenador</h3>
          <span style={{ fontSize: "13px", color: MUTED }}>Fuera de estas, tus bots no ven nada de tu disco. Borrar un archivo siempre te lo preguntan.</span>
        </span>
        <button type="button" onClick={add} style={{ ...btn("outline", 36), fontSize: "13.5px" }}>Añadir carpeta…</button>
      </div>
      {!list.length ? <p style={{ margin: 0, padding: "14px 0", borderTop: LINE, fontSize: "14px", color: MUTED }}>Ningún bot ve tus archivos hasta que les des una carpeta.</p> : null}
      {list.map((f) => (
        <div key={f.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", minHeight: "62px", padding: "8px 0", borderTop: LINE }}>
          <span aria-hidden="true" style={{ flex: "none", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "10px", background: "#F1F1EC" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4A4D57" strokeWidth="1.8" strokeLinejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>
          </span>
          <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "14.5px", fontWeight: 500 }}>{f.label}<span style={{ fontWeight: 400, color: MUTED }}>{f.botIds?.length ? " · " + f.botIds.map((id) => botOf(id)?.name).filter(Boolean).join(", ") : ""}</span></span>
            <span style={{ font: `400 12.5px/1.3 ${mono}`, color: MUTED, overflowWrap: "anywhere" }}>{f.path}</span>
          </span>
          <Select aria-label={`Qué pueden hacer en ${f.label}`} value={f.access} onChange={(e) => access(f, e.target.value)} style={{ ...select, width: "auto", height: "32px", borderRadius: "999px", padding: "0 10px 0 12px", fontSize: "13px" }} options={ACCESS} />
          <button type="button" aria-label={`Quitar ${f.label}`} onClick={() => later({ id: "folder:" + f.id, keys: ["folder:" + f.id], ms: UNDO_MS, text: `Carpeta «${f.label || f.path}» quitada`, error: "No se pudo quitar la carpeta", run: () => run(() => del(`/folders/${encodeURIComponent(f.id)}`)) })} style={{ ...btn("ghost", 32), padding: "0 8px" }}>Quitar</button>
        </div>
      ))}
      {list.length ? <Go to="/ajustes/ordenador" style={{ padding: "8px 0 6px", fontSize: "13px", fontWeight: 600 }}>Elegir qué bot ve cada carpeta</Go> : null}
      <Alert>{error}</Alert>
    </section>
  );
}

export default function AppsSection({ query = {} }) {
  const { computer, bots = [] } = useStore();
  const team = bots.filter((b) => b.enabled !== false && b.audience !== "yo");
  const c = useConnections(query.q || "");
  useHiddenVersion(); // repaint when a disconnect waits or is undone
  const rows = [
    ...c.servers.filter((s) => !isHidden("mcp:" + s.id)).map((s) => ({ key: "mcp:" + s.id, s })),
    ...c.accounts.filter((a) => !isHidden("account:" + a.id)).map((a) => ({ key: a.id, a })),
  ];
  return (
    <>
      <Alert>{c.error}</Alert>
      <section {...anchorOf("apps-conectadas")} aria-labelledby="con-t" style={{ display: "flex", flexDirection: "column", gap: "10px", scrollMarginTop: "24px" }}>
        <h3 id="con-t" style={h3}>{rows.length ? `Conectadas · ${rows.length}` : "Conectadas"}</h3>
        <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none", borderRadius: "20px", background: "#FFFFFF", overflow: "hidden" }}>
          {!c.loaded ? <li style={{ height: "68px", background: "linear-gradient(90deg, #FFFFFF, #F6F6F3, #FFFFFF)", backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite" }} /> : null}
          {c.loaded && !rows.length ? <li style={{ padding: "20px 18px", fontSize: "14.5px", color: MUTED }}>Ninguna todavía. Conecta abajo la primera: tu correo, tu calendario o tus documentos.</li> : null}
          {rows.map((r, i) => <Connected key={r.key} row={r} c={c} first={i === 0} team={team} />)}
        </ul>
      </section>
      <Catalogue c={c} initialQuery={query.q || ""} />
      <Folders />
      <section {...anchorOf("navegador")} aria-labelledby="nav-t" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "20px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "10px 16px" }}>
          <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
            <h3 id="nav-t" style={h3}>Navegador propio para cada bot</h3>
            <span style={{ fontSize: "13px", lineHeight: 1.5, color: MUTED }}>Navegan en una ventana de Colmena, no en tu Chrome. Nunca escriben contraseñas: las de la bóveda las pone Colmena y el resto te las piden a ti.</span>
          </span>
          {computer?.available ? <Chip tone="green" style={{ height: "28px", padding: "0 12px", fontSize: "13px" }}>Activo</Chip> : <Chip tone="quiet" style={{ height: "28px", padding: "0 12px", fontSize: "13px" }}>En la app de escritorio</Chip>}
        </div>
      </section>
    </>
  );
}

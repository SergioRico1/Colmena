import Select from "../../Select.jsx";
import { Folder } from "../../Icon.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { del, get, patch, post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { useStore } from "../../../lib/store.jsx";
import { isHidden, later, useHiddenVersion } from "../../../lib/undoToast.js";
import AppLogo from "../../settings/AppLogo.jsx";
import { appName, linkUrl, loadAccounts, loadCatalogue, loadStatus, pendingLink, rememberApps, setPendingLink } from "../../settings/connections.jsx";
import { Alert, BotMark, Confirm, Go, LINE, UNDO_MS, anchorOf, btn, danger, h3, mono, select, srOnly } from "./v3.jsx";
import { KIND_OF, disconnectAppText } from "./effects.js";
import { C } from "../../../lib/theme.js";
import { isCloud } from "../../../lib/cloud.js";
import { AppDetail, Marketplace, useMarketplace } from "./Marketplace.jsx";

// Ajustes › Apps y carpetas (design/V3Conexiones.dc.html): the apps your bots work with —
// direct MCP connections, the mail connector and Composio accounts —, the Marketplace to connect
// another one (Marketplace.jsx, with each app's page at ?app=<id>) and this computer's folders (the bots' own browser is in
// Navegador y dictado). What each bot may touch is decided in Autonomía y permisos. Own tools and MCP servers by address go in
// Avanzado. After a Composio sign-in, /permisos/:id asks what the new account may do.

const UNAVAILABLE = "Ahora no se puede llegar al servicio de apps. Comprueba tu conexión a internet y vuelve a intentarlo en un momento.";
const NEEDS_ACCOUNT = "Las apps se conectan con tu cuenta de IA. Conéctala primero en Cuentas de IA y vuelve aquí.";
const ACCESS = [["lee", "Solo leer"], ["escribe", "Leer y escribir"]];
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
  const [asking, setAsking] = useState(false);
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
  // A mailbox or a pasted key is entered again on its marketplace page; a sign-in reopens at once.
  const reconnect = () => (s && s.catalogId && ["mail", "token"].includes(s.auth) ? navigate("/ajustes/apps?app=" + encodeURIComponent(s.catalogId)) : s ? c.connectMcp(s.catalogId ? { catalogId: s.catalogId } : { url: s.url, name: s.name }) : c.connectComposio(a.toolkit));
  const remove = () => later({
    id: s ? "mcp:" + s.id : "account:" + a.id, keys: [s ? "mcp:" + s.id : "account:" + a.id], ms: UNDO_MS, text: `${label} desconectada`, error: "No se pudo desconectar",
    run: () => (s ? c.removeServer(s) : c.disconnect(a)),
  });
  return (
    <li style={{ display: "flex", flexDirection: "column", background: trouble ? "var(--c-honey-soft)" : "var(--c-card)", borderTop: first ? 0 : LINE }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", minHeight: "68px", padding: "12px 18px" }}>
        <AppLogo id={meta?.icon || meta?.id || s?.catalogId || a?.toolkit} name={label} logo={meta?.logo} size={40} />
        <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.4, color: trouble || waiting ? "var(--c-honey-text)" : "var(--c-text-3)" }}>{note}</span>
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
          <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>Leer y buscar, sin preguntar. Cambiar algo, con tu OK. Enviar, borrar, pagar o publicar, siempre tú.</span>
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
              {!asking ? <button type="button" disabled={c.busy} onClick={() => setAsking(true)} style={{ ...danger(32), marginLeft: "auto" }}>Desconectar…</button> : null}
            </span>
          )}
          {asking ? (
            <Confirm title={`¿Desconectar ${label}?`} action={`Desconectar ${label}`} onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); remove(); }}>
              {disconnectAppText(label, users)}
            </Confirm>
          ) : null}
        </div>
      ) : null}
    </li>
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
    <section {...anchorOf("carpetas")} aria-labelledby="fold-t" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "20px 22px 10px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", scrollMarginTop: "24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
        <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <h3 id="fold-t" style={h3}>Carpetas de este ordenador</h3>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Fuera de estas, tus bots no ven nada de tu disco. Borrar un archivo siempre te lo preguntan.</span>
        </span>
        <button type="button" onClick={add} style={{ ...btn("outline", 36), fontSize: "var(--t-ui)" }}>Añadir carpeta…</button>
      </div>
      {!list.length ? <p style={{ margin: 0, padding: "14px 0", borderTop: LINE, fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>Ningún bot ve tus archivos hasta que les des una carpeta.</p> : null}
      {list.map((f) => (
        <div key={f.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", minHeight: "62px", padding: "8px 0", borderTop: LINE }}>
          <span aria-hidden="true" style={{ flex: "none", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: "var(--c-chip)" }}>
            <Folder size={17} color={C.text2} />
          </span>
          <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "var(--t-body)", fontWeight: 500 }}>{f.label}<span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>{f.botIds?.length ? " · " + f.botIds.map((id) => botOf(id)?.name).filter(Boolean).join(", ") : ""}</span></span>
            <span style={{ font: `400 var(--t-meta)/1.3 ${mono}`, color: "var(--c-text-3)", overflowWrap: "anywhere" }}>{f.path}</span>
          </span>
          <Select aria-label={`Qué pueden hacer en ${f.label}`} value={f.access} onChange={(e) => access(f, e.target.value)} style={{ ...select, width: "auto", height: "32px", borderRadius: "var(--r-sm)", padding: "0 10px 0 12px", fontSize: "var(--t-meta)" }} options={ACCESS} />
          <button type="button" aria-label={`Quitar ${f.label}`} onClick={() => later({ id: "folder:" + f.id, keys: ["folder:" + f.id], ms: UNDO_MS, text: `Carpeta «${f.label || f.path}» quitada`, error: "No se pudo quitar la carpeta", run: () => run(() => del(`/folders/${encodeURIComponent(f.id)}`)) })} style={{ ...btn("ghost", 32), padding: "0 8px" }}>Quitar</button>
        </div>
      ))}
      {list.length ? <Go to="/ajustes/ordenador" style={{ padding: "8px 0 6px", fontSize: "var(--t-meta)", fontWeight: 600 }}>Elegir qué bot ve cada carpeta</Go> : null}
      <Alert>{error}</Alert>
    </section>
  );
}

export default function AppsSection({ query = {} }) {
  const { bots = [] } = useStore();
  const team = bots.filter((b) => b.enabled !== false && b.audience !== "yo");
  const c = useConnections(query.q || "");
  const market = useMarketplace();
  useHiddenVersion(); // repaint when a disconnect waits or is undone
  // A marketplace app's own page (/ajustes/apps?app=<id>).
  if (query.app) return (<><Alert>{c.error}</Alert><AppDetail id={query.app} market={market} c={c} /></>);
  const rows = [
    ...c.servers.filter((s) => !isHidden("mcp:" + s.id)).map((s) => ({ key: "mcp:" + s.id, s })),
    ...c.accounts.filter((a) => !isHidden("account:" + a.id)).map((a) => ({ key: a.id, a })),
  ];
  // The count says what works now; a sign-in left half-way shows in the list with its own note.
  const live = rows.filter((r) => (r.s ? r.s.status === "connected" : r.a.status === "ACTIVE")).length;
  return (
    <>
      <Alert>{c.error}</Alert>
      <section {...anchorOf("apps-conectadas")} aria-labelledby="con-t" style={{ display: "flex", flexDirection: "column", gap: "10px", scrollMarginTop: "24px" }}>
        <h3 id="con-t" style={h3}>{live ? `Conectadas · ${live}` : "Conectadas"}</h3>
        <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden" }}>
          {!c.loaded ? <li style={{ height: "68px", background: "linear-gradient(90deg, var(--c-card), var(--c-hover), var(--c-card))", backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite" }} /> : null}
          {c.loaded && !rows.length ? <li style={{ padding: "20px 18px", fontSize: "var(--t-body)", color: "var(--c-text-3)" }}>Ninguna todavía. Conecta abajo la primera: tu correo, tu calendario o tus documentos.</li> : null}
          {rows.map((r, i) => <Connected key={r.key} row={r} c={c} first={i === 0} team={team} />)}
        </ul>
      </section>
      <Marketplace market={market} c={c} />
      {isCloud() ? null : <Folders />}
    </>
  );
}

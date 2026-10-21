import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Lock, Plug, Search } from "lucide-react";
import { del, get, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import SettingsShell, { PageHeader } from "../components/settings/SettingsShell.jsx";
import { useStore } from "../lib/store.jsx";
import AppLogo from "../components/settings/AppLogo.jsx";
import { appName, linkUrl, loadAccounts, loadCatalogue, loadStatus, pendingLink, rememberApps, setPendingLink } from "../components/settings/connections.jsx";

// «Apps conectadas» (design/Connections.dc.html, NEXO 09b): one catalogue, MCP first. Apps with
// their own MCP server connect directly with one click (Colmena registers itself, you sign in in
// the browser); the rest (Google, Microsoft, Slack…) go through Composio.
const FILTERS = [
  { key: "suggested", label: "Sugeridas" },
  { key: "mail", label: "Correo y calendario" },
  { key: "documents", label: "Documentos" },
  { key: "team", label: "Equipo" },
  { key: "development", label: "Desarrollo" },
  { key: "business", label: "Negocio" },
];
const SUGGESTED = ["gmail", "googlecalendar", "notion", "googlesheets", "slack", "atlassian", "linear", "dropbox", "stripe"];
const EXTRA = "\nbutton:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #12131A;outline-offset:2px}\nbutton:not(:disabled){cursor:pointer}";
const UNAVAILABLE = "Ahora no se puede llegar al servicio de apps. Comprueba tu conexión a internet y vuelve a intentarlo en un momento.";
const NEEDS_ACCOUNT = "Las apps se conectan con tu cuenta de IA. Conéctala primero en «Cuenta de IA» y vuelve aquí.";
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();


export default function Connections({ query = {} }) {
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
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("suggested");
  const [search, setSearch] = useState(query.q || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [pending, setPending] = useState(pendingLink);
  const [mcpPending, setMcpPending] = useState(null); // {id, name, url}
  const [manual, setManual] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [renaming, setRenaming] = useState(null); // {id, value, error}
  const busyRef = useRef(false);
  const timer = useRef(null);
  const searchTimer = useRef(null);

  const action = useCallback(async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message || "No se pudo completar la operación.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
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
      setPendingLink(null);
      setPending(null);
      setAuthorizationUrl(null);
      throw Error("La autorización no se ha completado. Puedes volver a conectar la app.");
    }
    if (p) {
      const found = list.find((a) => a.toolkit === p.toolkit && a.status === "ACTIVE" && !p.before.includes(a.id));
      if (found) {
        setPendingLink(null);
        navigate(`/permisos/${encodeURIComponent(found.id)}?cuenta=1`);
        return;
      }
    }
    setPending(p);
  }, [loadMcp]);

  const runFilter = useCallback((category, text) => action(async () => {
    setFilter(category);
    setOffset(0);
    setNextCursor(null);
    if (!text || !available) {
      setCatalogue(null);
      return;
    }
    // Searching also asks Composio, for apps beyond the curated catalogue.
    const page = await loadCatalogue({ category: category === "suggested" || category === "business" ? "" : category, query: text });
    setCatalogue(page?.items || []);
    setNextCursor(page?.next_cursor || null);
  }), [action, available]);

  useEffect(() => {
    action(async () => {
      await load();
      if (query.q) runFilter("suggested", query.q);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          setMcpPending(null);
          setAuthorizationUrl(null);
          if (s.status === "error") setError(s.error || "No se pudo conectar.");
          return;
        }
      }
      if (pending) action(load);
      timer.current = setTimeout(check, 3000);
    };
    timer.current = setTimeout(check, 3000);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("focus", check);
    };
  }, [pending, mcpPending, accounts, action, load, loadMcp]);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

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
    } catch (e) {
      popup?.close();
      throw e;
    }
  };
  const connectComposio = async (toolkit) => {
    if (!available || busyRef.current) {
      setError(loaded ? (noAccount ? NEEDS_ACCOUNT : UNAVAILABLE) : "Cargando conexiones…");
      return;
    }
    await action(() => openAuth(async () => {
      const url = await linkUrl(toolkit);
      const p = { toolkit, started: Date.now(), before: accounts.map((a) => a.id) };
      setPendingLink(p);
      setPending(p);
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
  const disconnect = (a) => action(async () => {
    await post("/connections/disconnect", { account: a.id });
    setConfirm(null);
    await load();
  });
  const removeServer = (s) => action(async () => {
    await del(`/mcp/servers/${encodeURIComponent(s.id)}`);
    setConfirm(null);
    await loadMcp();
  });

  const activeComposio = (slug) => accounts.some((a) => a.toolkit === slug && a.status === "ACTIVE");
  const stateOf = (item) => {
    if (item.via === "mcp") {
      const s = item.server || servers.find((x) => x.catalogId === item.id);
      return s?.status === "connected" ? "on" : mcpPending?.id === s?.id && s ? "waiting" : "off";
    }
    return activeComposio(item.toolkit) ? "on" : pending?.toolkit === item.toolkit ? "waiting" : "off";
  };
  // The curated catalogue (filtered by category or text), then Composio's search results.
  const words = fold(search).split(/\s+/).filter(Boolean);
  const matches = (i) => words.every((w) => fold(i.name + " " + i.description).includes(w));
  const curatedShown = curated.filter((i) => (filter === "suggested" ? (words.length ? true : SUGGESTED.includes(i.id)) : i.category === filter) && matches(i));
  const curatedSlugs = new Set(curated.map((i) => i.toolkit || i.id));
  const extra = (catalogue || []).filter((d) => !curatedSlugs.has(d.slug)).map((d) => ({ id: d.slug, name: d.name, description: d.description, via: "composio", toolkit: d.slug, logo: d.logo || null }));
  const all = [...curatedShown, ...extra];
  const shownApps = all.slice(0, offset + 9);
  const more = offset + 9 < all.length || Boolean(nextCursor);
  const fullCatalogue = (e) => {
    e.preventDefault();
    if (offset + 9 < all.length) return setOffset(offset + 9);
    if (filter === "suggested" && !words.length) return setFilter("documents");
    if (!nextCursor) return undefined;
    return action(async () => {
      const page = await loadCatalogue({ category: filter === "suggested" || filter === "business" ? "" : filter, query: search, cursor: nextCursor });
      setCatalogue([...(catalogue || []), ...(page?.items || [])]);
      setNextCursor(page?.next_cursor || null);
    });
  };
  const onSearch = (e) => {
    const text = e.target.value;
    setSearch(text);
    setOffset(0);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runFilter(filter, text), 300);
  };

  const connectedCount = accounts.length + servers.length;
  const serviceTitle = error ? "Conexiones" : "Tus apps";
  const serviceMessage = error || (!loaded ? "Cargando conexiones…"
    : !available && !pending && !mcpPending ? (noAccount ? "Las apps del servicio de conexiones (Gmail, Calendar, Slack…) se activan cuando conectes tu cuenta de IA. Las de conexión directa ya funcionan." : UNAVAILABLE)
    : mcpPending ? `Termina de autorizar ${mcpPending.name} en tu navegador. Colmena lo detecta solo.`
      : pending ? `Termina la autorización de ${appName(pending.toolkit)} en tu navegador. Colmena lo detecta solo.`
        : "Conecta las apps que quieres usar con tu equipo. Las que tienen conexión directa se conectan con un clic; el resto, a través de nuestro servicio de conexiones.");
  const suggest = authorizationUrl && (pending || mcpPending)
    ? { label: "Abrir autorización", run: () => window.open(authorizationUrl, "_blank", "noopener") }
    : pending ? { label: "Comprobar conexión", run: () => action(load) }
      : loaded && !available && noAccount ? { label: "Conectar mi cuenta", run: () => navigate("/ajustes/ia") } : null;

  const INK = "#12131A";
  const MUTED = "#5C606C";
  const FAINT = "#6B6F7A";
  const LINE = "1px solid rgba(18,19,26,.06)";
  const pill = (dark) => ({ height: "38px", flex: "none", border: "0", padding: "0 16px", borderRadius: "999px", background: dark ? INK : "rgba(18,19,26,.06)", color: dark ? "#FFFFFF" : INK, fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" });
  const ghost = { height: "38px", flex: "none", border: "0", padding: "0 14px", borderRadius: "999px", background: "transparent", fontSize: "13px", fontWeight: "600", color: MUTED, whiteSpace: "nowrap" };
  const danger = { ...ghost, background: "#FBEAE7", color: "#B4372A" };
  const status = (ok, waiting, text) => (
    <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "14px", color: ok ? "#0B6B4A" : waiting ? "#8A5A00" : "#B4372A" }}>
      <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: ok ? "#0B8A5F" : "#FFC93C", animation: waiting ? "halo 1.8s ease-out infinite" : "none" }} />
      {text}
    </span>
  );
  const levels = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingLeft: "60px" }}>
      <span style={{ padding: "7px 12px", borderRadius: "999px", background: "#F4F4F0", fontSize: "13px" }}>{"Leer y buscar · "}<strong style={{ fontWeight: "600", color: "#0B6B4A" }}>sin preguntar</strong></span>
      <span style={{ padding: "7px 12px", borderRadius: "999px", background: "#F4F4F0", fontSize: "13px" }}>{"Cambiar algo · "}<strong style={{ fontWeight: "600" }}>con tu OK</strong></span>
      <span style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "999px", background: "#F4F4F0", fontSize: "13px" }}><Lock size={13} strokeWidth={2.2} aria-hidden="true" />{"Enviar, borrar, pagar o publicar · "}<strong style={{ fontWeight: "600" }}>siempre tú</strong></span>
    </div>
  );
  const row = (key, last, logo, name, tag, line, actions, extra) => (
    <div key={key} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px", borderBottom: last ? "0" : LINE }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px" }}>
        {logo}
        <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "16px", fontWeight: "600" }}>{name}{tag}</span>
          {line}
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>{actions}</span>
      </div>
      {extra}
    </div>
  );
  // The name of an account, changed right in its row (two Gmail accounts: «personal» / «trabajo»).
  const saveName = (a, alias) => action(async () => {
    const value = String(alias || "").trim();
    if (!value) { setRenaming((r) => ({ ...r, error: "Escribe un nombre." })); return; }
    try {
      await post("/connections/rename", { account: a.id, alias: value });
      setRenaming(null);
      setAccounts(await loadAccounts());
    } catch (e) {
      setRenaming((r) => ({ ...r, error: e.message || "No se pudo cambiar el nombre." }));
    }
  });
  const renameForm = (a) => {
    const app = appName(a.toolkit);
    return (
      <form onSubmit={(e) => { e.preventDefault(); saveName(a, renaming.value); }} style={{ display: "flex", flexDirection: "column", gap: "10px", paddingLeft: "60px", animation: "rise .25s ease-out" }}>
        <div role="radiogroup" aria-label="Nombre de la cuenta" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {["personal", "trabajo", "familia"].map((w) => {
            const v = app + " " + w;
            const on = renaming.value.trim().toLowerCase() === v.toLowerCase();
            const taken = accounts.some((x) => x.id !== a.id && x.toolkit === a.toolkit && String(x.alias).toLowerCase() === v.toLowerCase());
            return <button key={w} type="button" role="radio" aria-checked={on} disabled={taken} title={taken ? "Ya lo usa otra cuenta" : undefined} onClick={() => setRenaming((r) => ({ ...r, value: v, error: "" }))} style={{ height: "34px", padding: "0 14px", border: "0", borderRadius: "999px", fontSize: "13px", fontWeight: "600", background: on ? INK : "rgba(18,19,26,.05)", color: on ? "#FFFFFF" : INK, opacity: taken ? 0.4 : 1 }}>{w.charAt(0).toUpperCase() + w.slice(1)}</button>;
          })}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <input autoFocus aria-label="Nombre de la cuenta" value={renaming.value} maxLength={80} onChange={(e) => setRenaming((r) => ({ ...r, value: e.target.value, error: "" }))} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} style={{ flex: "1 1 220px", height: "40px", padding: "0 16px", border: "0", borderRadius: "999px", background: "#F4F4F0", fontSize: "14px", outline: "none" }} />
          <button type="submit" disabled={busy} style={pill(true)}>{busy ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={() => setRenaming(null)} style={ghost}>Cancelar</button>
        </div>
        {renaming.error ? <span role="alert" style={{ fontSize: "13px", color: "#B4372A" }}>{renaming.error}</span> : null}
      </form>
    );
  };
  const rows = [
    ...servers.map((s) => ({ kind: "mcp", s })),
    ...accounts.map((a) => ({ kind: "account", a })),
  ];

  return (
    <SettingsShell section="conectores" extraCss={EXTRA} gap="38px">
      <PageHeader title="Apps conectadas">Deja que tus bots trabajen con tus apps. Cada una se autoriza por separado, decides qué puede hacer y la quitas cuando quieras.</PageHeader>

      <section aria-labelledby="con-t" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2 id="con-t" style={{ margin: "0 0 0 20px", fontSize: "13px", fontWeight: "500", color: FAINT }}>{connectedCount ? `Conectadas · ${connectedCount}` : "Conectadas"}</h2>
        <div style={{ background: "#FFFFFF", borderRadius: "26px", overflow: "hidden" }}>
          {!loaded ? <div style={{ height: "76px", animation: "shimmer 1.6s ease-in-out infinite", background: "#FFFFFF" }} /> : null}
          {loaded && !rows.length ? <p style={{ margin: 0, padding: "22px 20px", fontSize: "15px", color: MUTED }}>Ninguna todavía. Busca abajo la primera: correo, calendario o tus documentos.</p> : null}
          {rows.map((r, i) => {
            const last = i === rows.length - 1;
            if (r.kind === "mcp") {
              const s = r.s;
              const ok = s.status === "connected";
              const waiting = s.status === "needs_auth" || s.status === "connecting";
              return row("mcp:" + s.id, last,
                <AppLogo id={s.catalogId} name={s.name} logo={curated.find((x) => x.id === s.catalogId)?.logo} size={44} />,
                s.name,
                <span style={{ padding: "3px 10px", borderRadius: "999px", background: "#F4F4F0", fontSize: "12px", fontWeight: "500", color: MUTED }}>Conexión directa</span>,
                status(ok, waiting, ok ? `Conectada · ${s.toolCount} ${s.toolCount === 1 ? "acción" : "acciones"}` : waiting ? "Pendiente de autorización" : s.error || "Hay que volver a conectarla"),
                <>
                  {!ok ? <button type="button" disabled={busy} onClick={() => connectMcp(s.catalogId ? { catalogId: s.catalogId } : { url: s.url, name: s.name })} style={pill(true)}>Volver a conectar</button> : null}
                  {confirm === "mcp:" + s.id ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => removeServer(s)} style={danger}>Sí, desconectar</button>
                      <button type="button" onClick={() => setConfirm(null)} style={ghost}>Cancelar</button>
                    </>
                  ) : <button type="button" disabled={busy} onClick={() => setConfirm("mcp:" + s.id)} style={ghost}>Desconectar</button>}
                </>,
                ok ? levels : null);
            }
            const a = r.a;
            const ok = a.status === "ACTIVE";
            const meta = curated.find((x) => x.toolkit === a.toolkit);
            return row(a.id, last,
              <AppLogo id={meta?.id || a.toolkit} name={appName(a.toolkit)} logo={meta?.logo} size={44} />,
              appName(a.toolkit),
              <button type="button" onClick={() => setRenaming(renaming?.id === a.id ? null : { id: a.id, value: a.alias || "", error: "" })} aria-expanded={renaming?.id === a.id} title="Cambiar el nombre de esta cuenta" style={{ display: "inline-flex", alignItems: "center", gap: "5px", height: "24px", padding: "0 10px", border: "0", borderRadius: "999px", background: "#F4F4F0", fontSize: "12px", fontWeight: "500", color: MUTED, cursor: "pointer" }}>{a.alias}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg></button>,
              status(ok, !ok, ok ? "Conectada" : "Pendiente de autorización"),
              <>
                <button type="button" onClick={() => navigate("/ajustes/permisos")} style={pill(false)}>Qué puede hacer</button>
                <button type="button" disabled={busy} onClick={() => connectComposio(a.toolkit)} style={pill(false)}>Añadir otra cuenta</button>
                {confirm === a.id ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => disconnect(a)} style={danger}>Sí, desconectar</button>
                    <button type="button" onClick={() => setConfirm(null)} style={ghost}>Cancelar</button>
                  </>
                ) : <button type="button" disabled={busy} onClick={() => setConfirm(a.id)} style={ghost}>Desconectar</button>}
              </>,
              renaming?.id === a.id ? renameForm(a) : ok ? levels : null);
          })}
        </div>
      </section>

      {error || pending || mcpPending || (loaded && !available) ? (
        <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px", padding: "18px 22px", borderRadius: "24px", background: error ? "#FBEAE7" : "#FFFFFF", boxShadow: pending || mcpPending ? "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16)" : "none", animation: "rise .3s ease-out" }}>
          <span aria-hidden="true" style={{ width: "9px", height: "9px", borderRadius: "50%", background: error ? "#B4372A" : "#FFC93C", flexShrink: "0", animation: pending || mcpPending ? "halo 1.8s ease-out infinite" : "none" }} />
          <span style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{ fontSize: "13px", fontWeight: "500", color: error ? "#8F1D22" : pending || mcpPending ? "#8A5A00" : FAINT }}>{serviceTitle}</span>
            <span style={{ fontSize: "15px", lineHeight: "1.45", color: INK }}>{serviceMessage}</span>
          </span>
          {suggest ? <button type="button" onClick={suggest.run} disabled={busy} style={{ ...pill(true), height: "42px", opacity: busy ? 0.55 : 1 }}>{suggest.label}</button> : null}
        </div>
      ) : null}

      <section id="catalogo" aria-labelledby="add-t" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
          <h2 id="add-t" style={{ margin: 0, font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>Añadir una app</h2>
          {more ? <a href="#catalogo" onClick={fullCatalogue} style={{ fontSize: "14px", fontWeight: "500", color: "#1F4FD1" }}>Ver más apps</a> : null}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "12px", height: "56px", padding: "0 22px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 14px 34px -22px rgba(18,19,26,.3)", color: FAINT }}>
          <Search size={18} strokeWidth={2.2} aria-hidden="true" />
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar una app</span>
          <input type="search" value={search} onChange={onSearch} placeholder="Busca una app: Notion, Jira, Stripe, Gmail…" style={{ flex: "1", minWidth: "0", border: "0", outline: "none", background: "transparent", fontSize: "16px", color: INK }} />
        </label>
        <div role="radiogroup" aria-label="Categorías" style={{ alignSelf: "flex-start", display: "flex", flexWrap: "wrap", gap: "2px", padding: "4px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return <button key={f.key} type="button" role="radio" aria-checked={on} onClick={() => runFilter(f.key, search)} style={{ height: "40px", padding: "0 16px", border: "0", borderRadius: "999px", fontSize: "14px", fontWeight: "500", color: INK, transition: "all .2s ease", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" }}>{f.label}</button>;
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))", gap: "14px" }}>
          {shownApps.length === 0 && loaded ? <p style={{ gridColumn: "1 / -1", margin: 0, padding: "30px 0", textAlign: "center", fontSize: "15px", color: FAINT }}>{search ? `No hay apps que coincidan con «${search}».` : "No hay apps en esta categoría."}</p> : null}
          {shownApps.map((d) => {
            const st = stateOf(d);
            const blocked = d.via === "composio" ? !available && loaded : !mcpOk;
            return (
              <div key={d.via + ":" + d.id} style={{ minHeight: "172px", boxSizing: "border-box", padding: "20px", borderRadius: "26px", background: "#FFFFFF", display: "flex", flexDirection: "column", gap: "10px", transition: "box-shadow .3s ease", boxShadow: st === "waiting" ? "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.14)" : "0 1px 2px rgba(18,19,26,.05)", animation: "rise .35s ease-out" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <AppLogo id={d.id} name={d.name} logo={d.logo} size={40} />
                  <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                    <strong style={{ fontSize: "16px", fontWeight: "600" }}>{d.name}</strong>
                    <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: FAINT }}>
                      {d.via === "mcp" ? <Plug size={12} strokeWidth={2.2} aria-hidden="true" /> : <Link2 size={12} strokeWidth={2.2} aria-hidden="true" />}
                      {d.via === "mcp" ? "Conexión directa" : "Servicio de conexiones"}
                    </span>
                  </span>
                </div>
                <span style={{ fontSize: "14px", color: MUTED, lineHeight: "1.45", flexGrow: "1" }}>{d.description}</span>
                <button type="button" disabled={busy || blocked || (st === "on" && d.via === "mcp")} onClick={() => (st === "waiting" && d.via === "composio" ? action(load) : connect(d))}
                  aria-label={st === "on" ? `${d.name} conectada` : st === "waiting" ? `Comprobar la autorización de ${d.name}` : `Conectar ${d.name}`}
                  title={blocked ? (d.via === "composio" ? (noAccount ? NEEDS_ACCOUNT : UNAVAILABLE) : "Las conexiones directas solo funcionan en la aplicación de escritorio.") : undefined}
                  style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "7px", height: "38px", border: "0", padding: "0 16px", borderRadius: "999px", fontSize: "13px", fontWeight: "600", opacity: blocked ? 0.5 : 1,
                    background: st === "on" ? "#E1F4EC" : st === "waiting" ? "#FFF4D1" : INK, color: st === "on" ? "#0B5A3E" : st === "waiting" ? "#8A5A00" : "#FFFFFF" }}>
                  {st === "on" ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg> : null}
                  {st === "on" ? "Conectada" : st === "waiting" ? "Esperando autorización…" : "Conectar"}
                </button>
              </div>
            );
          })}
        </div>
        <span style={{ margin: "0 8px", fontSize: "13px", lineHeight: "1.5", color: FAINT }}>Al conectar se abre tu navegador para autorizar. Cuando termines, Colmena lo detecta solo; no hace falta actualizar.</span>

        {manual ? (
          <form onSubmit={(e) => { e.preventDefault(); if (manualUrl.trim()) connectMcp({ url: manualUrl.trim() }).then(() => { setManual(false); setManualUrl(""); }); }}
            style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "8px", padding: "20px", borderRadius: "26px", background: "#FFFFFF", animation: "rise .3s ease-out" }}>
            <label style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px", fontWeight: "500", color: MUTED }}>
              Dirección del servidor MCP (https)
              <input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://mcp.ejemplo.com/mcp" inputMode="url" autoFocus style={{ height: "48px", padding: "0 16px", background: "#F4F4F0", border: "0", borderRadius: "14px", fontSize: "15px", outline: "none" }} />
            </label>
            <button type="submit" disabled={busy || !manualUrl.trim()} style={{ ...pill(true), height: "48px", padding: "0 22px", opacity: busy || !manualUrl.trim() ? 0.5 : 1 }}>Conectar</button>
            <button type="button" onClick={() => setManual(false)} style={{ ...ghost, height: "48px" }}>Cancelar</button>
          </form>
        ) : (
          <button type="button" onClick={() => setManual(true)} disabled={!mcpOk} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", height: "46px", padding: "0 18px", border: "0", borderRadius: "999px", background: "transparent", boxShadow: "inset 0 0 0 1.5px rgba(18,19,26,.15)", fontSize: "14px", fontWeight: "600", color: INK }}>
            <Plug size={14} strokeWidth={2.2} aria-hidden="true" />¿Tu app no está? Conéctala con su dirección MCP
          </button>
        )}
      </section>
    </SettingsShell>
  );
}

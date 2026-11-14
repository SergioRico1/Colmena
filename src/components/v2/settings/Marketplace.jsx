import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Check, Clock, ExternalLink, Lock, Search } from "../../Icon.js";
import { del, get, post, put } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { useExpert } from "../../../lib/expert.js";
import { isCloud } from "../../../lib/cloud.js";
import AppLogo from "../../settings/AppLogo.jsx";
import { Alert, Chip, Confirm, Go, LINE, Term, btn, danger, field, h3, mono, srOnly } from "./v3.jsx";
import { C } from "../../../lib/theme.js";

// Ajustes › Apps › Marketplace (docs/CONNECTIONS.md › Marketplace): every app the bots can work
// with, from GET /api/mcp/catalog (server/mcp/catalog.mjs). The list: search, categories and one
// tile per app with its state. The detail (/ajustes/apps?app=<id>): what the bots can do, which
// actions are red lines, how it connects and the form for its kind:
//   oauth     one click (the vendor's own sign-in), for you or, an admin, for the company;
//   token     a key pasted from the vendor's settings;
//   mail      an address and an app password (IMAP/SMTP), tested before it is kept;
//   composio  your own Composio account: create it, paste its key (checked live), connect the app;
//   google    Colmena's own Google client: «Disponible pronto» until it exists.
// Honey only marks what waits for the person (a sign-in left half-way).

const STATUS = { beta: "Beta", preview: "Vista previa" };
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const quiet = { fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" };
const body = { fontSize: "var(--t-ui)", lineHeight: 1.55, color: "var(--c-text-2)" };
const input = { ...field, width: "100%", height: "40px", padding: "0 12px" };
/** A button that cannot be pressed yet looks like it (the shared btn() has no disabled style). */
const dim = (style, off) => (off ? { ...style, opacity: 0.5, cursor: "not-allowed" } : style);
const appHref = (id) => "/ajustes/apps?app=" + encodeURIComponent(id);
export const COMPOSIO_FREE = "El plan gratuito incluye 10.000 llamadas al mes.";

/** The marketplace's data: the catalogue with your connections, refreshed on demand. */
export function useMarketplace() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await get("/mcp/catalog")); setError(""); } catch (e) { setError(e.message || "No se pudo cargar el catálogo de apps."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { data, error, load };
}

/** Whether an app is connected for you (directly, or one of your Composio accounts). */
export function connectedOf(item, c) {
  if (item.auth === "composio") return item.toolkit ? (c.accounts || []).filter((a) => a.toolkit === item.toolkit) : [];
  return (item.servers || []).filter((s) => s.status === "connected");
}

function StateChip({ item, c }) {
  const on = connectedOf(item, c).length;
  const waiting = (item.servers || []).some((s) => s.status === "needs_auth") || (item.auth === "composio" && c.pending?.toolkit === item.toolkit);
  if (on) return <Chip tone="green"><Check size={12} weight="bold" style={{ marginRight: "4px" }} />Conectada</Chip>;
  if (waiting) return <Chip style={{ background: "var(--c-honey-soft)", color: "var(--c-honey-text)" }}>Falta tu permiso</Chip>;
  if (item.availability === "soon") return <Chip tone="quiet"><Clock size={12} style={{ marginRight: "4px" }} />Disponible pronto</Chip>;
  if (STATUS[item.status]) return <Chip tone="grey">{STATUS[item.status]}</Chip>;
  return null;
}

/** The list: search, categories, one tile per app. */
export function Marketplace({ market, c }) {
  const [expert] = useExpert();
  const [filter, setFilter] = useState("todas");
  const [text, setText] = useState("");
  const items = market.data?.items || [];
  const categories = market.data?.categories || {};
  const words = fold(text).split(/\s+/).filter(Boolean);
  const shown = items.filter((i) => (filter === "todas" ? true : filter === "conectadas" ? connectedOf(i, c).length : i.category === filter) && words.every((w) => fold(i.name + " " + i.vendor + " " + i.description).includes(w)));
  // Ready first, then «Disponible pronto»; your connected ones lead.
  const order = (i) => (connectedOf(i, c).length ? 0 : i.availability === "soon" ? 2 : 1);
  const list = [...shown].sort((a, b) => order(a) - order(b));
  const filters = [["todas", "Todas"], ["conectadas", "Conectadas"], ...Object.entries(categories)];
  return (
    <section id="conectar-app" data-setting="conectar-app" aria-labelledby="mk-t" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "14px", padding: "20px 22px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", scrollMarginTop: "24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px" }}>
        <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <h3 id="mk-t" style={h3}>Marketplace</h3>
          <span style={quiet}>Cada app con su conexión oficial. Leer nunca te pregunta; enviar, publicar, pagar o borrar, siempre.</span>
        </span>
        <label style={{ flex: "1 1 220px", maxWidth: "100%", display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 12px", borderRadius: "var(--r-md)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .12)" }}>
          <Search size={14} color={C.text3} />
          <span style={srOnly}>Buscar una app</span>
          <input className="c-bare" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar una app" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "var(--t-ui)", color: "var(--c-text)" }} />
        </label>
      </div>
      <div role="group" aria-label="Filtrar por tipo" className="c-chiprow">
        {filters.map(([id, label]) => {
          const sel = filter === id;
          return <button key={id} type="button" aria-pressed={sel} onClick={() => setFilter(id)} style={{ flex: "none", height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", background: sel ? "var(--c-btn)" : "var(--c-chip)", color: sel ? "var(--c-btn-text)" : "var(--c-text-2)", fontSize: "var(--t-meta)", fontWeight: 500, cursor: "pointer" }}>{label}</button>;
        })}
      </div>
      <Alert>{market.error}</Alert>
      <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(250px, 100%), 1fr))", gap: "8px" }}>
        {!market.data && !market.error ? Array.from({ length: 6 }, (_, i) => <li key={i} style={{ height: "76px", borderRadius: "var(--r-lg)", background: "linear-gradient(90deg, var(--c-hover), var(--c-chip), var(--c-hover))", backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite" }} />) : null}
        {market.data && !list.length ? <li style={{ gridColumn: "1 / -1", padding: "18px 0", textAlign: "center", ...body }}>{text ? `Ninguna app coincide con «${text}». En «Otras apps (Composio)» hay cientos más.` : filter === "conectadas" ? "Todavía no has conectado ninguna." : "No hay apps de este tipo."}</li> : null}
        {list.map((i) => (
          <li key={i.id}>
            <a href={appHref(i.id)} onClick={(e) => { e.preventDefault(); navigate(appHref(i.id)); }} className="c-tile"
              style={{ display: "flex", alignItems: "flex-start", gap: "12px", minHeight: "76px", padding: "12px", borderRadius: "var(--r-lg)", background: "var(--c-hover)", color: "var(--c-text)", textDecoration: "none" }}>
              <AppLogo id={i.icon || i.id} name={i.name} logo={i.logo} size={36} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" }}>
                  <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{i.name}</span>
                  <StateChip item={i} c={c} />
                </span>
                <span style={{ ...quiet, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i.description}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <span style={quiet}>¿Una herramienta propia o un servidor <Term tip="Model Context Protocol: una forma estándar de darle herramientas nuevas a un bot.">MCP</Term> que no está aquí? Va en {expert ? <Go to="/ajustes/avanzado#mcp">Servidores y claves</Go> : <Go to="/ajustes/general#modo-experto">Servidores y claves (modo experto)</Go>}.</span>
    </section>
  );
}

// ------------------------------------------------------------------ the detail

function Section({ title, children, id }) {
  const hid = useId();
  return (
    <section aria-labelledby={hid} id={id} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "18px 0", borderTop: LINE }}>
      <h3 id={hid} style={{ margin: 0, fontSize: "var(--t-body)", fontWeight: 600 }}>{title}</h3>
      {children}
    </section>
  );
}

function Steps({ steps }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", counterReset: "step" }}>
      {steps.map((s, n) => (
        <li key={n} style={{ display: "flex", gap: "10px", ...body }}>
          <span aria-hidden="true" style={{ flex: "none", width: "22px", height: "22px", borderRadius: "var(--r-circle)", background: "var(--c-chip)", display: "grid", placeItems: "center", fontSize: "var(--t-caption)", fontWeight: 600, color: "var(--c-text)", fontVariantNumeric: "tabular-nums" }}>{n + 1}</span>
          <span style={{ paddingTop: "1px" }}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** For whom a direct connection is (hosted, owners and admins): you, or the whole company. */
function ScopePick({ value, onPick }) {
  return (
    <span role="radiogroup" aria-label="Para quién" style={{ display: "inline-flex", padding: "2px", gap: "2px", borderRadius: "var(--r-sm)", background: "var(--c-chip)", alignSelf: "flex-start" }}>
      {[["mine", "Solo para mí"], ["company", "Para toda la empresa"]].map(([v, t]) => {
        const on = value === v;
        return <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onPick(v)} style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "var(--r-xs)", background: on ? "var(--c-selected)" : "transparent", boxShadow: on ? "var(--c-shadow-lift)" : "none", fontSize: "var(--t-meta)", fontWeight: on ? 600 : 500, color: on ? "var(--c-text)" : "var(--c-text-2)", cursor: "pointer" }}>{t}</button>;
      })}
    </span>
  );
}

/** Opens a tab synchronously (popup rules), then sends it to the sign-in once the server answers. */
async function openSignIn(getUrl) {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  try {
    const url = await getUrl();
    if (!url) { popup?.close(); return null; }
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) throw Error("Enlace de autorización no válido.");
    if (popup) popup.location.replace(u.href); else window.open(u.href, "_blank", "noopener");
    return u.href;
  } catch (e) { popup?.close(); throw e; }
}

function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const ref = useRef(false);
  const act = async (fn, ok = "") => {
    if (ref.current) return undefined;
    ref.current = true; setBusy(true); setError(""); setDone("");
    try { const r = await fn(); if (ok) setDone(ok); return r; } catch (e) { setError(e.message || "No se pudo completar."); return undefined; } finally { ref.current = false; setBusy(false); }
  };
  return { busy, error, done, act, setError };
}

function Done({ children }) {
  return children ? <p role="status" style={{ margin: 0, display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-ui)", color: "var(--c-ok-ink)" }}><Check size={14} weight="bold" />{children}</p> : null;
}

/** One connection of this app: its account, state, «Probar» and «Desconectar». */
function ConnectionRow({ s, reload, item }) {
  const a = useAct();
  const [asking, setAsking] = useState(false);
  const ok = s.status === "connected";
  const waiting = s.status === "needs_auth" || s.status === "connecting";
  const note = ok ? `${s.toolCount} ${s.toolCount === 1 ? "acción" : "acciones"}${s.scope === "company" && isCloud() ? " · de la empresa" : ""}` : waiting ? "Falta que des el permiso en la otra pestaña." : s.error || "Hay que volver a conectarla.";
  return (
    <li style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px", borderRadius: "var(--r-md)", background: waiting ? "var(--c-honey-soft)" : "var(--c-hover)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
        <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ fontSize: "var(--t-ui)", fontWeight: 600, overflowWrap: "anywhere" }}>{s.account || s.name}</span>
          <span style={{ ...quiet, color: waiting ? "var(--c-honey-text)" : !ok ? "var(--c-error)" : quiet.color }}>{note}</span>
        </span>
        {waiting ? (
          <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button type="button" disabled={a.busy} onClick={() => a.act(() => openSignIn(async () => { const out = await post("/mcp/connect", { catalogId: item.id, scope: s.scope }); await reload(); return out.authorizeUrl || null; }))} style={btn("dark", 32)}>Abrir de nuevo el permiso</button>
            <button type="button" disabled={a.busy} onClick={() => a.act(async () => { await del(`/mcp/servers/${encodeURIComponent(s.id)}`); await reload(); })} style={btn("ghost", 32)}>Cancelar</button>
          </span>
        ) : (
          <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button type="button" disabled={a.busy} onClick={() => a.act(async () => { const r = await post(`/mcp/servers/${encodeURIComponent(s.id)}/test`); await reload(); if (!r.ok) throw Error(r.error); }, "Funciona.")} style={btn("outline", 32)}>{a.busy ? "Probando…" : "Probar"}</button>
            {!asking ? <button type="button" disabled={a.busy} onClick={() => setAsking(true)} style={danger(32)}>Desconectar…</button> : null}
          </span>
        )}
      </div>
      {asking ? (
        <Confirm title={`¿Desconectar ${item.name}${s.account ? " (" + s.account + ")" : ""}?`} action="Desconectar" busy={a.busy} onCancel={() => setAsking(false)}
          onConfirm={() => a.act(async () => { await del(`/mcp/servers/${encodeURIComponent(s.id)}`); setAsking(false); await reload(); })}>
          {s.scope === "company" && isCloud() ? "Los bots de toda la empresa dejarán de usarla. " : "Tus bots dejarán de usarla. "}Colmena borra el permiso o la clave guardada; lo que ya hicieron en {item.name} se queda allí.
        </Confirm>
      ) : null}
      <Done>{a.done}</Done>
      <Alert>{a.error}</Alert>
    </li>
  );
}

/** One account connected through Composio: its name and «Desconectar». */
function ComposioRow({ account, item, c }) {
  const [asking, setAsking] = useState(false);
  const ok = account.status === "ACTIVE";
  return (
    <li style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px", borderRadius: "var(--r-md)", background: ok ? "var(--c-hover)" : "var(--c-honey-soft)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
        <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ fontSize: "var(--t-ui)", fontWeight: 600, overflowWrap: "anywhere" }}>{account.alias || item.name}</span>
          <span style={{ ...quiet, color: ok ? quiet.color : "var(--c-honey-text)" }}>{ok ? "Conectada con Composio" : "Falta que des el permiso en la otra pestaña."}</span>
        </span>
        {!asking ? <button type="button" disabled={c.busy} onClick={() => setAsking(true)} style={danger(32)}>Desconectar…</button> : null}
      </div>
      {asking ? (
        <Confirm title={`¿Desconectar ${account.alias || item.name}?`} action="Desconectar" busy={c.busy} onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); c.disconnect(account); }}>
          Tus bots dejarán de usar esta cuenta. Colmena quita el permiso en Composio; lo que ya hicieron en {item.name} se queda allí.
        </Confirm>
      ) : null}
    </li>
  );
}

function OAuthConnect({ item, admin, reload }) {
  const a = useAct();
  const [scope, setScope] = useState("mine");
  const [waiting, setWaiting] = useState(null);
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(async () => { const d = await reload(); const s = d?.items?.find((x) => x.id === item.id)?.servers?.find((x) => x.id === waiting); if (s && s.status !== "needs_auth" && s.status !== "connecting") { setWaiting(null); if (s.status === "error") a.setError(s.error || "No se pudo conectar."); } }, 3000);
    return () => clearInterval(t);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = () => a.act(() => openSignIn(async () => {
    const out = await post("/mcp/connect", { catalogId: item.id, ...(admin && !item.perPerson ? { scope } : {}) });
    await reload();
    if (out.authorizeUrl) setWaiting(out.server.id);
    return out.authorizeUrl || null;
  }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {admin && !item.perPerson && isCloud() ? <ScopePick value={scope} onPick={setScope} /> : null}
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
        <button type="button" disabled={a.busy} onClick={go} style={btn("dark", 40)}>{a.busy ? "Abriendo…" : `Conectar ${item.name}`}</button>
        <span style={quiet}>Se abre {item.vendor} en otra pestaña: entras allí y Colmena lo detecta sola.</span>
      </span>
      {waiting ? <p role="status" style={{ margin: 0, padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--c-honey-soft)", color: "var(--c-honey-text)", ...{ fontSize: "var(--t-ui)" } }}>Termina de dar el permiso en la otra pestaña. Esto se actualiza solo.</p> : null}
      <Alert>{a.error}</Alert>
    </div>
  );
}

function TokenConnect({ item, admin, reload }) {
  const a = useAct();
  const [token, setToken] = useState("");
  const [scope, setScope] = useState("mine");
  const id = useId();
  const submit = (e) => { e.preventDefault(); a.act(async () => { await post("/mcp/connect", { catalogId: item.id, token: token.trim(), ...(admin && !item.perPerson ? { scope } : {}) }); setToken(""); await reload(); }, `${item.name} conectado.`); };
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {admin && !item.perPerson && isCloud() ? <ScopePick value={scope} onPick={setScope} /> : null}
      <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-2)" }}>
        {item.token?.label}
        <input id={id} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Pégalo aquí" style={{ ...input, fontFamily: mono }} />
      </label>
      {item.token?.where ? <span style={quiet}>Dónde está: {item.token.where}</span> : null}
      <span><button type="submit" disabled={a.busy || token.trim().length < 8} style={dim(btn("dark", 40), token.trim().length < 8)}>{a.busy ? "Comprobando…" : "Comprobar y conectar"}</button></span>
      <Done>{a.done}</Done>
      <Alert>{a.error}</Alert>
    </form>
  );
}

const MAIL_PROVIDERS = [["", "Lo detecta Colmena"], ["gmail", "Gmail o Google Workspace"], ["icloud", "iCloud"], ["yahoo", "Yahoo"], ["fastmail", "Fastmail"], ["otro", "Otro proveedor…"]];

function MailConnect({ reload, another = false, steps = [], onCancel = null }) {
  const a = useAct();
  const [f, setF] = useState({ email: "", password: "", provider: "", imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const other = f.provider === "otro";
  const ids = { email: useId(), pass: useId(), prov: useId(), ih: useId(), ip: useId(), sh: useId(), sp: useId() };
  const submit = (e) => {
    e.preventDefault();
    a.act(async () => {
      const mail = { email: f.email.trim(), password: f.password, ...(f.provider && !other ? { provider: f.provider } : {}), ...(other ? { imap: { host: f.imapHost.trim(), port: Number(f.imapPort) }, smtp: { host: f.smtpHost.trim(), port: Number(f.smtpPort) } } : {}) };
      await post("/mcp/connect", { catalogId: "mail", mail });
      setF({ ...f, password: "" });
      await reload();
    }, "Buzón conectado. Colmena entró y comprobó que puede enviar; no ha enviado nada.");
  };
  const lab = { display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-2)", minWidth: 0 };
  return (
    <form onSubmit={submit} aria-label={another ? "Otro buzón" : undefined} style={{ display: "flex", flexDirection: "column", gap: "12px", ...(another ? { padding: "16px", borderRadius: "var(--r-md)", border: "1px solid var(--c-line)" } : {}) }}>
      {another ? <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>Otro buzón</span> : null}
      {another && steps.length ? <Steps steps={steps} /> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "12px" }}>
        <label htmlFor={ids.email} style={lab}>Tu dirección<input id={ids.email} type="email" autoComplete="email" value={f.email} onChange={set("email")} placeholder="tu@gmail.com" style={input} /></label>
        <label htmlFor={ids.pass} style={lab}>Contraseña de aplicación<input id={ids.pass} type="password" autoComplete="off" spellCheck={false} value={f.password} onChange={set("password")} placeholder="xxxx xxxx xxxx xxxx" style={{ ...input, fontFamily: mono }} /></label>
        <label htmlFor={ids.prov} style={lab}>Proveedor
          <select id={ids.prov} value={f.provider} onChange={set("provider")} style={{ ...input, padding: "0 10px" }}>
            {MAIL_PROVIDERS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
      </div>
      {other ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: "12px" }}>
          <label htmlFor={ids.ih} style={lab}>Servidor IMAP<input id={ids.ih} value={f.imapHost} onChange={set("imapHost")} placeholder="imap.tuempresa.com" style={input} /></label>
          <label htmlFor={ids.ip} style={lab}>Puerto IMAP<input id={ids.ip} inputMode="numeric" value={f.imapPort} onChange={set("imapPort")} style={{ ...input, fontVariantNumeric: "tabular-nums" }} /></label>
          <label htmlFor={ids.sh} style={lab}>Servidor de envío (SMTP)<input id={ids.sh} value={f.smtpHost} onChange={set("smtpHost")} placeholder="smtp.tuempresa.com" style={input} /></label>
          <label htmlFor={ids.sp} style={lab}>Puerto SMTP<input id={ids.sp} inputMode="numeric" value={f.smtpPort} onChange={set("smtpPort")} style={{ ...input, fontVariantNumeric: "tabular-nums" }} /></label>
        </div>
      ) : null}
      <span style={quiet}>Outlook, Hotmail y Microsoft 365 ya no aceptan contraseñas por IMAP: conéctalos con Composio. El puerto 25 no se puede usar.</span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button type="submit" disabled={a.busy || !f.email.trim() || f.password.replace(/\s+/g, "").length < 6} style={dim(btn("dark", 40), !f.email.trim() || f.password.replace(/\s+/g, "").length < 6)}>{a.busy ? "Probando el buzón…" : "Probar y conectar"}</button>
        {onCancel ? <button type="button" onClick={onCancel} style={btn("ghost", 40)}>Cancelar</button> : null}
      </span>
      <Done>{a.done}</Done>
      <Alert>{a.error}</Alert>
    </form>
  );
}

/** Composio: your own account (create it, paste its key, connect the app), or the company's. */
function ComposioConnect({ item, market, c }) {
  const a = useAct();
  const [key, setKey] = useState("");
  const [replace, setReplace] = useState(false);
  const id = useId();
  const status = market.data?.composio || {};
  const ready = !!status.configured && c.available;
  const save = (e) => { e.preventDefault(); a.act(async () => { await put("/mcp/composio", { key: key.trim() }); setKey(""); setReplace(false); await market.load(); await c.load(); }, "Clave comprobada y guardada solo para ti."); };
  const remove = () => a.act(async () => { await del("/mcp/composio"); await market.load(); await c.load(); }, "Tu clave de Composio se ha quitado.");
  const toolkit = item.toolkit;
  const step = (n, done, title, children) => (
    <li style={{ display: "flex", gap: "12px" }}>
      <span aria-hidden="true" style={{ flex: "none", width: "24px", height: "24px", borderRadius: "var(--r-circle)", background: done ? C.ok : "var(--c-chip)", color: done ? C.btnText : "var(--c-text)", display: "grid", placeItems: "center", fontSize: "var(--t-caption)", fontWeight: 600 }}>{done ? <Check size={12} weight="bold" /> : n}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "8px", paddingTop: "2px" }}>
        <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{title}{done ? <span style={srOnly}> (hecho)</span> : null}</span>
        {children}
      </span>
    </li>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "16px" }}>
        {step(1, ready, "Crea tu cuenta gratuita en Composio", (
          <span style={body}>
            <a href="https://composio.dev" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: "var(--c-accent-ink)" }}>composio.dev<ExternalLink size={12} style={{ marginLeft: "3px", verticalAlign: "-1px" }} /></a>. {COMPOSIO_FREE} Si ya tienes cuenta, pasa al siguiente paso.
          </span>
        ))}
        {step(2, ready, status.mine ? "Tu clave de Composio está guardada" : status.company ? "Tu empresa ya tiene una cuenta de Composio" : "Pega tu clave de API de Composio", (
          <>
            {status.mine || (status.company && !replace) ? (
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <span style={body}>{status.mine ? "Solo la usan tus bots. Tu empresa no la ve." : "Tus bots usan la de la empresa. Puedes usar una tuya si prefieres que tus cuentas sean solo tuyas."}</span>
                {status.mine && status.canRemove ? <button type="button" disabled={a.busy} onClick={remove} style={btn("ghost", 32)}>Quitar mi clave</button> : null}
                {!status.mine ? <button type="button" onClick={() => setReplace(true)} style={btn("outline", 32)}>Usar mi propia clave</button> : null}
              </span>
            ) : (
              <form onSubmit={save} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}>
                <label htmlFor={id} style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>
                  En composio.dev › Settings › API Keys
                  <input id={id} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="ak_…" style={{ ...input, fontFamily: mono }} />
                </label>
                <button type="submit" disabled={a.busy || key.trim().length < 10} style={dim(btn("dark", 40), key.trim().length < 10)}>{a.busy ? "Comprobando…" : "Comprobar y guardar"}</button>
              </form>
            )}
          </>
        ))}
        {toolkit ? step(3, connectedOf(item, c).length > 0, `Conectar ${item.name}`, (
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
            <button type="button" disabled={!ready || c.busy} onClick={() => c.connectComposio(toolkit)} style={dim(btn(ready ? "dark" : "outline", 40), !ready)}>{c.pending?.toolkit === toolkit ? "Comprobar la autorización" : `Conectar ${item.name}`}</button>
            <span style={quiet}>{ready ? "Se abre el permiso de " + (item.vendor === "Composio" ? "Google o la app" : item.vendor) + " en la app verificada de Composio: Colmena no registra nada." : "Primero, el paso 2."}</span>
          </span>
        )) : null}
      </ol>
      {item.thirdParty ? <p style={{ margin: 0, display: "flex", gap: "8px", ...quiet }}><Lock size={14} style={{ flex: "none", marginTop: "2px" }} />{item.thirdParty} Sus condiciones y su privacidad: composio.dev/terms.</p> : null}
      {!toolkit && ready ? <ComposioSearch c={c} /> : null}
      <Done>{a.done}</Done>
      <Alert>{a.error || c.error}</Alert>
    </div>
  );
}

/** «Otras apps»: Composio's own catalogue, searched live. */
function ComposioSearch({ c }) {
  const [text, setText] = useState("");
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const type = (v) => { setText(v); clearTimeout(t.current); t.current = setTimeout(() => c.search("todas", v), 300); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 12px", borderRadius: "var(--r-md)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .12)" }}>
        <Search size={14} color={C.text3} /><span style={srOnly}>Buscar en Composio</span>
        <input className="c-bare" type="search" value={text} onChange={(e) => type(e.target.value)} placeholder="Busca una app: Trello, Typeform, Xero…" style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontSize: "var(--t-ui)", color: "var(--c-text)" }} />
      </label>
      <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))", gap: "6px" }}>
        {(c.catalogue || []).slice(0, 24).map((d) => {
          const on = (c.accounts || []).some((a) => a.toolkit === d.slug && a.status === "ACTIVE");
          return (
            <li key={d.slug}>
              <button type="button" disabled={c.busy || on} onClick={() => c.connectComposio(d.slug)} aria-label={on ? d.name + " conectada" : "Conectar " + d.name} style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", minHeight: "48px", padding: "6px 10px", border: 0, borderRadius: "var(--r-md)", background: "var(--c-hover)", color: "var(--c-text)", textAlign: "left", cursor: on ? "default" : "pointer" }}>
                <AppLogo id={d.slug} name={d.name} logo={d.logo} size={28} />
                <span style={{ flex: 1, minWidth: 0, fontSize: "var(--t-ui)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                {on ? <Check size={14} weight="bold" color={C.okInk} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One app: what the bots can do, its red lines, how it connects, its form and your connections. */
export function AppDetail({ id, market, c }) {
  const item = market.data?.items?.find((i) => i.id === id);
  const head = useRef(null);
  const [more, setMore] = useState(false);
  const [expert] = useExpert();
  useEffect(() => { head.current?.focus({ preventScroll: false }); }, [id]);
  const back = <a href="/ajustes/apps#conectar-app" onClick={(e) => { e.preventDefault(); navigate("/ajustes/apps#conectar-app"); }} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", minHeight: "32px", margin: "-6px 0 0 -6px", padding: "0 6px", borderRadius: "var(--r-sm)", fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-accent-ink)", textDecoration: "none" }}><ArrowLeft size={14} />Marketplace</a>;
  if (!market.data) return <>{back}<Alert>{market.error}</Alert></>;
  if (!item) return <>{back}<p style={body}>Esa app ya no está en el catálogo.</p></>;
  const admin = ["owner", "admin"].includes(market.data.person?.role);
  const mine = item.auth === "composio" ? [] : item.servers || [];
  const accounts = connectedOf(item, c);
  const soon = item.availability === "soon";
  const live = mine.some((x) => x.status === "connected");
  // A sign-in left half-way has its own row («Abrir de nuevo el permiso»): no second «Conectar».
  const halfway = mine.some((x) => x.status === "needs_auth" || x.status === "connecting");
  const reload = async () => { await market.load(); return get("/mcp/catalog").catch(() => null); };
  const verified = new Date(item.verifiedAt + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  return (
    <article aria-labelledby="app-t" style={{ minWidth: 0, display: "flex", flexDirection: "column", padding: "20px 22px 6px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", animation: "fade .25s ease-out" }}>
      {back}
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "14px", padding: "16px 0 18px" }}>
        <AppLogo id={item.icon || item.id} name={item.name} logo={item.logo} size={52} />
        <span style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="app-t" ref={head} tabIndex={-1} style={{ margin: 0, font: "600 var(--t-title)/1.2 'Geist', sans-serif", letterSpacing: "-0.015em", outline: "none" }}>{item.name}</h2>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 8px" }}>
            <StateChip item={item} c={c} />
            <span style={quiet}>{item.vendor === "Colmena" ? "Incluido en Colmena" : item.auth === "composio" ? "A través de Composio" : "Conexión oficial de " + item.vendor} · Verificado el {verified}</span>
          </span>
          <p style={{ margin: 0, ...body, maxWidth: "62ch" }}>{item.description}</p>
        </span>
      </header>

      <Section title="Qué pueden hacer tus bots">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: "6px 14px", ...body }}>
          <dt style={{ fontWeight: 600, color: "var(--c-text)" }}>Leer</dt><dd style={{ margin: 0 }}>{item.can.read} Sin preguntarte.</dd>
          <dt style={{ fontWeight: 600, color: "var(--c-text)" }}>Cambiar</dt><dd style={{ margin: 0 }}>{item.can.write} {/^Nada/.test(item.can.write) ? "" : "Con tu OK, o sin preguntar si se lo permites en Autonomía y permisos."}</dd>
        </dl>
      </Section>

      <Section title="Líneas rojas">
        <p style={{ margin: 0, display: "flex", gap: "8px", ...body }}><Lock size={16} style={{ flex: "none", marginTop: "2px", color: "var(--c-text)" }} />Enviar, publicar, pagar y borrar siempre esperan tu OK, en esta app y en todas. Nada puede saltárselas.</p>
        {item.redLines.length ? <ul style={{ margin: 0, padding: "0 0 0 24px", display: "flex", flexDirection: "column", gap: "4px", ...body }}>{item.redLines.map((r) => <li key={r}>{r}</li>)}</ul> : <span style={quiet}>Esta app no tiene acciones de ese tipo.</span>}
      </Section>

      {soon ? (
        <Section title="Disponible pronto">
          <p style={{ margin: 0, display: "flex", gap: "8px", ...body }}><Clock size={16} style={{ flex: "none", marginTop: "2px" }} />{item.blocked || "Colmena está terminando su conexión verificada con Google. En cuanto esté, la conectarás aquí con un clic, con tu propia cuenta."}</p>
          {expert && item.scopes?.length ? <span style={quiet}>Permisos de Google que pedirá: {item.scopes.map((s) => s.split("/").pop()).join(", ")}.</span> : null}
        </Section>
      ) : (
        <Section title={item.auth === "composio" ? "Conectar con tu cuenta de Composio" : mine.length || accounts.length ? "Tus conexiones" : "Conectar"} id="conectar">
          {item.setup?.length && item.auth !== "composio" && !live ? <Steps steps={item.setup} /> : null}
          {item.notes ? <p style={{ margin: 0, ...quiet }}>{item.notes}</p> : null}
          {mine.length ? <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>{mine.map((s) => <ConnectionRow key={s.id} s={s} item={item} reload={reload} />)}</ul> : null}
          {item.auth === "composio" && accounts.length ? <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>{accounts.map((acc) => <ComposioRow key={acc.id} account={acc} item={item} c={c} />)}</ul> : null}
          {/* Connected: one more account (mail, a key) behind a button; a sign-in app needs no second one. */}
          {live && !more && ["mail", "token"].includes(item.auth) ? <span><button type="button" onClick={() => setMore(true)} style={btn("outline", 34)}>{item.auth === "mail" ? "Conectar otro buzón" : "Conectar con otra clave"}</button></span> : null}
          {(!live && !halfway) || more ? (
            <>
              {item.auth === "oauth" ? <OAuthConnect item={item} admin={admin} reload={reload} /> : null}
              {item.auth === "token" ? <TokenConnect item={item} admin={admin} reload={reload} /> : null}
              {item.auth === "mail" ? <MailConnect reload={reload} another={live} steps={item.setup || []} onCancel={live ? () => setMore(false) : null} /> : null}
              {item.auth === "google" ? <OAuthConnect item={{ ...item, vendor: "Google" }} admin={false} reload={reload} /> : null}
            </>
          ) : null}
          {item.auth === "composio" ? <ComposioConnect item={item} market={market} c={c} /> : null}
          
        </Section>
      )}

      <Section title="Fuentes">
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
          {item.sources.map((u) => <li key={u} style={{ minWidth: 0 }}><a href={u} target="_blank" rel="noopener noreferrer" style={{ fontSize: "var(--t-meta)", color: "var(--c-accent-ink)", overflowWrap: "anywhere" }}>{u.replace(/^https:\/\//, "")}</a></li>)}
        </ul>
      </Section>
    </article>
  );
}


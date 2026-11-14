import { useCallback, useEffect, useState } from "react";
import { Laptop } from "../../Icon.js";
import { del, get, patch, post } from "../../../lib/api.js";
import { isCloud } from "../../../lib/cloud.js";
import { useStore } from "../../../lib/store.jsx";
import { Alert, Chip, Confirm, anchorOf, btn, danger, mono } from "./v3.jsx";

const HONEY = { background: "var(--c-honey-soft, var(--c-chip))", color: "var(--c-honey-text)" };
const BLUE = { background: "var(--c-accent-soft)", color: "var(--c-accent-ink)" };

// Ajustes › «Tus dispositivos» (docs/CLOUD.md › Phase 5). Hosted: your computers, which are on
// now and what each lends your bots; approve a new one (compare its fingerprint on both
// screens), rename, remove. Inside the desktop app: this computer, added in one press and then
// approved here, and «Este ordenador», the local window where you choose what it lends (out of
// this page's reach on purpose). In the local desktop mode: «Usar Colmena en la nube».

const desktopCloud = () => (typeof window !== "undefined" ? window.colmenaWindow?.cloud || null : null);
const LENDS = [["navegador", "Navegador con tus sesiones"], ["ordenador", "Apps y programas"], ["contrasenas", "Gestor de contraseñas"], ["codigo", "Claude Code"]];
const ago = (iso) => {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "ahora mismo";
  if (m < 60) return "hace " + m + " min";
  const h = Math.round(m / 60);
  return h < 48 ? "hace " + h + " h" : new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
};

function lendsLine(lends = {}) {
  const parts = [];
  if (lends.folders?.length) parts.push(lends.folders.length === 1 ? "la carpeta «" + lends.folders[0].label + "»" : lends.folders.length + " carpetas");
  for (const [id, label] of LENDS) if (lends[id]) parts.push(label.toLowerCase());
  return parts.length ? "Presta " + parts.join(", ") + "." : "No presta nada todavía.";
}

function Device({ d, mine, onApprove, onRename, onRemove, busy }) {
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(null);
  const tone = d.status === "pending" ? "grey" : d.online ? "green" : "quiet";
  const status = d.status === "pending" ? "Esperando tu aprobación" : d.online ? "Encendido" : "Apagado · visto " + ago(d.lastSeenAt);
  const bots = new Map();
  for (const f of d.lends?.folders || []) for (const b of f.bots) bots.set(b, true);
  return (
    <li style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "18px 20px", borderTop: "1px solid var(--c-line)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px" }}>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: "40px", height: "40px", borderRadius: "var(--r-md)", background: "var(--c-chip)", color: "var(--c-text)" }}><Laptop size={20} /></span>
        <span style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-read)", fontWeight: 600 }}>
            {name !== null ? (
              <input aria-label="Nombre del dispositivo" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onRename(d, name); setName(null); } if (e.key === "Escape") setName(null); }} onBlur={() => { if (name.trim() && name !== d.name) onRename(d, name); setName(null); }} style={{ height: "32px", padding: "0 8px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-card)", color: "var(--c-text)", font: "inherit" }} />
            ) : d.name}
            {mine ? <Chip style={BLUE}>Este ordenador</Chip> : null}
            <Chip tone={tone} style={d.status === "pending" ? HONEY : null}>{status}</Chip>
          </span>
          <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>{d.status === "pending" ? <>Comprueba que ese ordenador muestra la huella <strong style={{ fontFamily: mono }}>{d.fingerprint}</strong> antes de aprobarlo.</> : lendsLine(d.lends)}</span>
          {d.status !== "pending" && bots.size ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Huella {d.fingerprint}</span> : null}
        </span>
        <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {d.status === "pending" ? <button type="button" disabled={busy} onClick={() => onApprove(d)} style={btn("dark", 38)}>Aprobar</button> : null}
          {d.status !== "pending" ? <button type="button" onClick={() => setName(d.name)} style={btn("outline", 38)}>Renombrar</button> : null}
          <button type="button" onClick={() => setConfirm(true)} style={danger(38)}>{d.status === "pending" ? "Rechazar" : "Quitar"}</button>
        </span>
      </div>
      {d.lends?.folders?.length ? (
        <ul aria-label={"Carpetas de " + d.name} style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {d.lends.folders.map((f) => <li key={f.id}><Chip tone="grey">{f.label} · {f.access === "escribe" ? "lee y escribe" : "lee"} · {f.bots.length} {f.bots.length === 1 ? "bot" : "bots"}</Chip></li>)}
        </ul>
      ) : null}
      {confirm ? (
        <Confirm title={d.status === "pending" ? "¿Rechazar este ordenador?" : "¿Quitar «" + d.name + "»?"} action={d.status === "pending" ? "Rechazar" : "Quitar"} busy={busy} onCancel={() => setConfirm(false)} onConfirm={async () => { await onRemove(d); setConfirm(false); }}>
          Tus bots dejarán de poder usarlo al momento. Para volver a usarlo, añádelo otra vez desde Colmena en ese ordenador.
        </Confirm>
      ) : null}
    </li>
  );
}

/** This computer, inside the desktop app in cloud mode: add it, approve it, choose what it lends. */
function ThisComputer({ devices, workspaceId, reload }) {
  const api = desktopCloud();
  const [me, setMe] = useState(null);
  const [agent, setAgent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!api) return undefined;
    api.identity().then(setMe).catch(() => {});
    api.agent().then((a) => setAgent(a?.state || null)).catch(() => {});
    return api.onEvent((e) => { if (e.type === "agent") { setAgent(e.state); reload(); } });
  }, [api, reload]);
  if (!api || !me) return null;
  const here = devices.find((d) => me.registration?.deviceId === d.id && me.registration?.workspaceId === workspaceId && d.status !== "revoked");
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const { device, workspace } = await post("/agent/devices", { name: me.name, publicKey: me.publicKey, platform: me.platform });
      await api.registered(workspace.id, device.id);
      setMe(await api.identity());
      reload();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const status = agent?.status === "online" ? "Conectado" : agent?.status === "pending" ? "Esperando tu aprobación" : agent?.status === "connecting" ? "Conectando…" : agent?.status === "revoked" ? "Quitado" : here ? "Sin conexión" : "Sin añadir";
  return (
    <section {...anchorOf("este-ordenador")} aria-label="Este ordenador" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "var(--r-md)", background: "var(--c-sunken)", scrollMarginTop: "24px" }}>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-read)", fontWeight: 600 }}>Este ordenador<Chip tone={agent?.status === "online" ? "green" : "quiet"} style={agent?.status !== "online" && here ? HONEY : null}>{status}</Chip></span>
      <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)", maxWidth: "64ch" }}>
        {here ? <>«{me.name}», huella <strong style={{ fontFamily: mono }}>{me.fingerprint}</strong>. Elige qué presta a tus bots en «Este ordenador»: solo se puede cambiar aquí, en este ordenador.</>
          : <>Añádelo para que tus bots de la nube puedan usar, cuando tú se lo pidas, lo que elijas de este ordenador: carpetas, el navegador con tus sesiones, tus apps, tus contraseñas sin verlas o Claude Code. Su huella es <strong style={{ fontFamily: mono }}>{me.fingerprint}</strong>.</>}
      </span>
      {error ? <Alert>{error}</Alert> : null}
      <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {!here ? <button type="button" disabled={busy} onClick={add} style={btn("dark", 40)}>{busy ? "Añadiendo…" : "Añadir este ordenador"}</button> : null}
        {here ? <button type="button" onClick={() => api.openAgentSettings()} style={btn(here.status === "approved" ? "dark" : "outline", 40)}>Elegir qué presta</button> : null}
        <button type="button" onClick={() => api.switchToLocal()} style={btn("ghost", 40)}>Usar solo en este ordenador…</button>
      </span>
    </section>
  );
}

function CloudDevices() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mineId, setMineId] = useState(null);
  const reload = useCallback(() => get("/agent/devices").then((r) => { setData(r); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 6000);
    desktopCloud()?.identity().then((i) => setMineId(i?.registration?.deviceId || null)).catch(() => {});
    return () => clearInterval(t);
  }, [reload]);
  const act = (fn) => async (...args) => {
    setBusy(true);
    try { await fn(...args); await reload(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const approve = act(async (d) => { await post("/agent/devices/" + d.id + "/approve"); desktopCloud()?.reconnect?.().catch(() => {}); });
  const rename = act((d, name) => patch("/agent/devices/" + d.id, { name }));
  const remove = act((d) => del("/agent/devices/" + d.id));
  const devices = (data?.devices || []).filter((d) => d.status !== "revoked");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <ThisComputer devices={data?.devices || []} workspaceId={data?.workspace?.id} reload={reload} />
      {error ? <Alert>{error}</Alert> : null}
      <section {...anchorOf("dispositivos")} aria-label="Tus dispositivos" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden", scrollMarginTop: "24px" }}>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>Tus ordenadores</span>
          <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)", maxWidth: "70ch" }}>Solo tus bots, y solo cuando tú les pides algo, usan tu ordenador; nunca un compañero. Lo que envía, paga o publica te pregunta aquí como siempre. Si un ordenador está apagado, el bot te lo dice.</span>
        </div>
        {data === null ? <p role="status" style={{ margin: 0, padding: "0 20px 18px", color: "var(--c-text-3)" }}>Cargando…</p>
          : devices.length ? <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{devices.map((d) => <Device key={d.id} d={d} mine={d.id === mineId} busy={busy} onApprove={approve} onRename={rename} onRemove={remove} />)}</ul>
          : <p style={{ margin: 0, padding: "0 20px 20px", color: "var(--c-text-3)" }}>Todavía no has añadido ningún ordenador. Abre la app de escritorio de Colmena en tu ordenador, elige «Usar Colmena en la nube» y añádelo desde aquí.</p>}
      </section>
    </div>
  );
}

/** The local desktop mode: where this Colmena lives, and the way to the cloud. */
function LocalMode() {
  const { settings = {} } = useStore();
  const api = typeof window !== "undefined" ? window.colmenaWindow?.mode || null : null;
  const [error, setError] = useState(null);
  return (
    <section {...anchorOf("modo")} aria-label="Colmena en la nube" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", scrollMarginTop: "24px" }}>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-read)", fontWeight: 600 }}>Solo en este ordenador<Chip tone="green">Ahora</Chip></span>
      <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)", maxWidth: "68ch" }}>
        {settings.userName ? settings.userName + ", tus" : "Tus"} bots, conversaciones y claves viven en este ordenador. Con «Usar Colmena en la nube» entras en el espacio de tu empresa con tu correo; este ordenador presta a tus bots lo que elijas, y tus datos de aquí se quedan sin tocar (luego puedes llevarlos con «Llevar mis datos a la nube»).
      </span>
      {error ? <Alert>{error}</Alert> : null}
      <span><button type="button" disabled={!api} onClick={() => api.switchToCloud().catch((e) => setError(e.message))} style={btn("dark", 40)}>Usar Colmena en la nube…</button></span>
    </section>
  );
}

export default function DevicesSection() {
  return isCloud() ? <CloudDevices /> : <LocalMode />;
}

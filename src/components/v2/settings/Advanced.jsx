import Select from "../../Select.jsx";
import { useEffect, useState } from "react";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { del, get, patch, post } from "../../../lib/api.js";
import { later, reversible, useHiddenVersion, isHidden } from "../../../lib/undoToast.js";
import { useExpert } from "../../../lib/expert.js";
import ApiKeysCard from "../../settings/ApiKeys.jsx";
import { runDiagnostics, useDiagnostics } from "./Diagnostics.jsx";
import { Alert, Card, INK, LINE, MUTED, Panel, Row, UNDO_MS, btn, field, mono, select } from "./v3.jsx";

// Ajustes › Avanzado (design/V3Ajustes.dc.html, only in expert mode): the MCP servers you add by
// address, the model on this computer (OpenAI compatible: Ollama, LM Studio…), the OpenAI API
// key, the keys your bots asked you for, a fixed model per family on Claude and OpenCode Go,
// and where Colmena keeps its data and listens.

const FAMILIES = [["astra", "Astra", "Coordina el equipo y lo más difícil"], ["sol", "Sol", "Programa, analiza e investiga"], ["luna", "Luna", "Redacta y ayuda en el día a día"]];
const value = { padding: "8px 12px", borderRadius: "10px", background: "#F6F6F3", font: `400 var(--t-meta)/1.2 ${mono}`, color: INK, overflowWrap: "anywhere", maxWidth: "100%" };
const input = { ...field, width: "auto", flex: "1 1 220px", fontFamily: mono, fontSize: "var(--t-ui)" };

function McpServers() {
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const act = useAction();
  useHiddenVersion();
  const load = () => get("/mcp/servers").then((d) => setList(d?.servers || [])).catch((e) => act.setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (e) => {
    e.preventDefault();
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    act.act(async () => {
      const out = await post("/mcp/connect", { url: url.trim() });
      await load();
      setAdding(false); setUrl("");
      if (!out.authorizeUrl) { popup?.close(); return; }
      const u = new URL(out.authorizeUrl);
      if (u.protocol !== "https:" || u.username || u.password) { popup?.close(); throw Error("Enlace de autorización no válido."); }
      if (popup) popup.location.replace(u.href); else window.open(u.href, "_blank", "noopener");
    }).catch(() => popup?.close());
  };
  const shown = (list || []).filter((s) => !isHidden("mcp:" + s.id));
  return (
    <Panel anchor="mcp" title="Servidores MCP" sub="Herramientas propias para tus bots: cualquier servidor MCP por su dirección. Las apps conocidas están en Apps y carpetas."
      aside={<button type="button" aria-expanded={adding} onClick={() => setAdding(!adding)} style={{ ...btn("outline", 36), fontSize: "var(--t-ui)", borderColor: "rgba(18,19,26,.16)" }}>{adding ? "Cancelar" : "Añadir servidor"}</button>}>
      {adding ? (
        <form onSubmit={add} style={{ display: "flex", flexWrap: "wrap", gap: "8px", animation: "fade .25s ease-out" }}>
          <input autoFocus aria-label="Dirección del servidor MCP" inputMode="url" placeholder="https://mcp.ejemplo.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} style={input} />
          <button type="submit" disabled={act.busy || !url.trim()} style={btn("dark", 40)}>{act.busy ? "Conectando…" : "Conectar"}</button>
        </form>
      ) : null}
      {list && !shown.length ? <p style={{ margin: 0, padding: "12px 0 0", borderTop: LINE, fontSize: "var(--t-ui)", color: MUTED }}>Ninguno todavía.</p> : null}
      {shown.map((s) => {
        const ok = s.status === "connected";
        const wait = s.status === "needs_auth" || s.status === "connecting";
        return (
          <div key={s.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", minHeight: "50px", borderTop: LINE }}>
            <span style={{ flex: "1 1 180px", font: `500 var(--t-ui)/1.3 ${mono}` }}>{s.name}</span>
            <span style={{ font: `400 var(--t-meta)/1.3 ${mono}`, color: MUTED, overflowWrap: "anywhere" }}>{s.url || s.command || ""}</span>
            <span title={s.error || undefined} style={{ fontSize: "var(--t-meta)", fontWeight: 600, color: ok ? "#0B6B4A" : wait ? "#8A5A00" : "#B4232A" }}>{ok ? `● ${s.toolCount} ${s.toolCount === 1 ? "herramienta" : "herramientas"}` : wait ? "◐ pendiente de autorizar" : "○ sin conexión"}</span>
            <button type="button" onClick={() => later({ id: "mcp:" + s.id, keys: ["mcp:" + s.id], ms: UNDO_MS, text: `${s.name} quitado`, error: "No se pudo quitar", run: () => del(`/mcp/servers/${encodeURIComponent(s.id)}`).then(load) })} style={{ ...btn("ghost", 30), padding: "0 6px" }}>Quitar</button>
          </div>
        );
      })}
      <Alert>{act.error}</Alert>
    </Panel>
  );
}

function LocalForm({ onDone }) {
  const act = useAction();
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434/v1");
  const [model, setModel] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); act.act(() => post("/auth/local", { baseUrl: baseUrl.trim(), model: model.trim() })).then((r) => r?.ok && onDone()); }} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 22px 14px", animation: "fade .25s ease-out" }}>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <input aria-label="Dirección del modelo" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={input} />
        <input aria-label="Nombre del modelo" placeholder="llama3.1" value={model} onChange={(e) => setModel(e.target.value)} style={{ ...input, flex: "0 1 180px" }} />
        <button type="submit" disabled={act.busy || !baseUrl.trim() || !model.trim()} style={btn("dark", 40)}>{act.busy ? "Comprobando…" : "Guardar"}</button>
      </span>
      <span style={{ fontSize: "var(--t-meta)", color: MUTED }}>Solo en este ordenador (localhost o 127.0.0.1). Lo usan de respaldo si lo eliges en Cuentas de IA.</span>
      <Alert>{act.error}</Alert>
    </form>
  );
}

function KeyForm({ onDone }) {
  const act = useAction();
  const [key, setKey] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); act.act(() => post("/auth/apikey", { key: key.trim() })).then((r) => r?.ok && onDone()); }} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 22px 14px", animation: "fade .25s ease-out" }}>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <input autoFocus type="password" autoComplete="off" spellCheck={false} aria-label="Clave de API de OpenAI" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} style={input} />
        <button type="submit" disabled={act.busy || key.trim().length < 20} style={btn("dark", 40)}>{act.busy ? "Comprobando…" : "Guardar"}</button>
      </span>
      <span style={{ fontSize: "var(--t-meta)", color: MUTED }}>Pago por uso en platform.openai.com, en lugar de tu plan de ChatGPT. Se guarda cifrada en este ordenador; también sirve para dictar.</span>
      <Alert>{act.error}</Alert>
    </form>
  );
}

function Families({ ai }) {
  const act = useAction();
  const { run } = useStore();
  const engines = (ai?.engines || []).filter((e) => e.connected && ai?.catalog?.[e.id]);
  if (!engines.length) return <p style={{ margin: 0, padding: "0 22px 14px", fontSize: "var(--t-meta)", color: MUTED }}>Conecta Claude u OpenCode Go para fijar sus modelos.</p>;
  const pick = (engine, family, slug) => {
    const own = ai.pins?.[engine] || {};
    const next = { ...own };
    if (slug) next[family] = slug; else delete next[family];
    act.act(() => patch("/ai/engines", { pins: { [engine]: next } })).then(() => reversible({ id: `pins:${engine}:${family}`, text: "Modelo por familia cambiado", ms: UNDO_MS, undo: () => run(() => patch("/ai/engines", { pins: { [engine]: own } })) }));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "0 22px 14px", animation: "fade .25s ease-out" }}>
      {engines.map((e) => FAMILIES.map(([family, name, sub]) => {
        const catalog = ai.catalog[e.id];
        const pinned = ai.pins?.[e.id]?.[family] || "";
        const auto = catalog.find((m) => m.families?.includes(family));
        return (
          <label key={e.id + family} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", minHeight: "44px", fontSize: "var(--t-ui)" }}>
            <span style={{ flex: "1 1 200px" }}><strong style={{ fontWeight: 600 }}>{`${name} en ${e.label}`}</strong><span style={{ color: MUTED }}>{" · " + sub}</span></span>
            <Select aria-label={`${name} en ${e.label}`} disabled={act.busy} value={pinned} onChange={(ev) => pick(e.id, family, ev.target.value || null)} style={{ ...select, width: "240px", height: "34px", fontSize: "var(--t-ui)" }} options={[["", "Automático" + (auto ? " · " + auto.label : "")], ...catalog.map((m) => [m.slug, m.label + (m.utility ? " (ligero)" : "")])]} />
          </label>
        );
      }))}
      <Alert>{act.error}</Alert>
    </div>
  );
}

export default function AdvancedSection() {
  const { ai, provider } = useStore();
  const [expert, setExpert] = useExpert();
  const { result } = useDiagnostics();
  const secrets = useResource(expert ? "/secrets" : null);
  const [open, setOpen] = useState(null); // "local" | "key" | "keys" | "families"
  const act = useAction();
  useEffect(() => { if (expert && !result) runDiagnostics(); }, [expert]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!expert) {
    return (
      <Card label="Avanzado">
        <Row first title="Avanzado está en el modo experto" sub="Servidores MCP, claves de API, modelos locales y la carpeta de datos. Enciéndelo y aparece la sección; no quita nada.">
          <button type="button" onClick={() => setExpert(true)} style={btn("dark", 40)}>Encender el modo experto</button>
        </Row>
      </Card>
    );
  }
  const toggle = (what) => setOpen(open === what ? null : what);
  const folder = result?.checks?.find((c) => c.id === "data:folder")?.text || "…";
  const keys = secrets.data?.secrets?.length || 0;
  const clear = (kind, text) => later({ id: "provider:" + kind, ms: UNDO_MS, text, error: "No se pudo quitar", run: () => act.act(() => del("/auth/provider?kind=" + kind)) });
  const pinsCount = Object.values(ai?.pins || {}).reduce((n, p) => n + Object.keys(p || {}).length, 0);
  return (
    <>
      <McpServers />
      <Card label="Más opciones">
        <Row first anchor="modelo-local" title="Modelo en este ordenador" sub="OpenAI compatible: Ollama, LM Studio…" min="64px">
          <span style={value}>{provider?.kind === "local" ? provider.label.replace(/^Modelo local · /, "") : ai?.local ? "configurado" : "sin configurar"}</span>
          <span style={{ display: "flex", gap: "6px" }}>
            <button type="button" aria-expanded={open === "local"} onClick={() => toggle("local")} style={btn("outline", 32)}>{ai?.local ? "Cambiar" : "Configurar"}</button>
            {ai?.local ? <button type="button" onClick={() => clear("local", "Modelo local quitado")} style={btn("ghost", 32)}>Quitar</button> : null}
          </span>
        </Row>
        {open === "local" ? <LocalForm onDone={() => setOpen(null)} /> : null}
        <Row anchor="clave-openai" title="Clave de API de OpenAI" sub="Pago por uso, en lugar de tu plan de ChatGPT." min="64px">
          <span style={value}>{provider?.kind === "apikey" ? provider.label.replace(/^Clave de OpenAI /, "") : "sin poner"}</span>
          <span style={{ display: "flex", gap: "6px" }}>
            <button type="button" aria-expanded={open === "key"} onClick={() => toggle("key")} style={btn("outline", 32)}>{provider?.kind === "apikey" ? "Cambiar" : "Poner"}</button>
            {provider?.kind === "apikey" ? <button type="button" onClick={() => clear("apikey", "Clave de OpenAI quitada")} style={btn("ghost", 32)}>Quitar</button> : null}
          </span>
        </Row>
        {open === "key" ? <KeyForm onDone={() => setOpen(null)} /> : null}
        <Row anchor="claves" title="Claves de API de tus bots" sub="Las que te pidieron para un servicio. Ningún bot las ve: Colmena las pone solo en sus sitios." min="64px">
          <span style={value}>{keys ? `${keys} ${keys === 1 ? "clave" : "claves"}` : "ninguna"}</span>
          <button type="button" aria-expanded={open === "keys"} onClick={() => toggle("keys")} style={btn("outline", 32)}>{open === "keys" ? "Ocultar" : "Gestionar"}</button>
        </Row>
        {open === "keys" ? <div style={{ padding: "0 10px 10px", animation: "fade .25s ease-out" }}><ApiKeysCard /></div> : null}
        <Row anchor="familias" title="Modelos por familia" sub="Colmena elige la familia por la función de cada bot; aquí fijas el modelo de cada una." min="64px">
          <span style={value}>{pinsCount ? `${pinsCount} ${pinsCount === 1 ? "fijado" : "fijados"}` : "automático"}</span>
          <button type="button" aria-expanded={open === "families"} onClick={() => toggle("families")} style={btn("outline", 32)}>{open === "families" ? "Ocultar" : "Cambiar"}</button>
        </Row>
        {open === "families" ? <Families ai={ai} /> : null}
        <Row anchor="carpeta-datos" title="Carpeta de datos" sub="Bots, chats y archivos" min="64px">
          <span style={value}>{folder}</span>
        </Row>
        <Row anchor="servicio-local" title="Servicio local" sub="Solo escucha en este ordenador" min="64px">
          <span style={value}>{typeof location !== "undefined" ? location.host : "127.0.0.1"}</span>
        </Row>
      </Card>
      <Alert>{act.error}</Alert>
    </>
  );
}

import Select from "../../Select.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import ProviderMark from "../ProviderMark.jsx";
import { Check, ExternalLink, Plus, Search } from "../../Icon.js";
import { useAction, useStore } from "../../../lib/store.jsx";
import { patch, post } from "../../../lib/api.js";
import { reversible } from "../../../lib/undoToast.js";
import { ENGINE_NAMES, KEY_ENGINES } from "../../../lib/engineNames.js";
import { LINE, UNDO_MS, anchorOf, btn, mono, select } from "./v3.jsx";

// Ajustes › Cuentas de IA › «Conectar otra IA»: Gemini, OpenRouter, DeepSeek, Kimi and a
// «Servidor propio» (any OpenAI-compatible server), each with one API key
// (server/providers/accounts.mjs). One flow for all: where to get the key, the key, the
// model, «Probar» (a tiny answer) and «Conectar». A connected one becomes its own account
// card above, whose «Gestionar» shows the same model picker and «Probar».

export const KEY_INFO = {
  gemini: { note: "Los modelos de Google, con capa gratuita.", site: "aistudio.google.com", url: "https://aistudio.google.com/apikey", placeholder: "AIza…" },
  openrouter: { note: "Cientos de modelos con una sola clave. Pagas por uso.", site: "openrouter.ai", url: "https://openrouter.ai/settings/keys", placeholder: "sk-or-v1-…" },
  deepseek: { note: "DeepSeek V4.1 Flash y V4 Pro. Pagas por uso.", site: "platform.deepseek.com", url: "https://platform.deepseek.com/api_keys", placeholder: "sk-…" },
  moonshot: { note: "Kimi K3.1 Pro, de Moonshot AI. Pagas por uso.", site: "platform.kimi.ai", url: "https://platform.kimi.ai/console/api-keys", placeholder: "sk-…" },
  custom: { note: "Ollama, LM Studio, vLLM o cualquier servidor compatible con OpenAI.", placeholder: "Solo si tu servidor la pide" },
};

const input = { width: "100%", minWidth: 0, height: "40px", padding: "0 14px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-md)", background: "var(--c-card)", font: "500 var(--t-ui)/1 'Geist Mono', monospace", color: "var(--c-text)", boxSizing: "border-box" };
const label = { fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-2)" };
const link = { color: "var(--c-text)", fontWeight: 600, textUnderlineOffset: "3px" };
// Pasting often brings a trailing space, a line break or an invisible character.
const clean = (v) => String(v).replace(/[​-‍⁠﻿­]/g, "").replace(/^[\s ]+|[\s ]+$/g, "");
const seconds = (ms) => (ms < 1000 ? "menos de un segundo" : (ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " s");
const contextWords = (n) => (!n ? null : n >= 1e6 ? `${(n / 1e6).toLocaleString("es-ES", { maximumFractionDigits: 1 })} M de contexto` : `${Math.round(n / 1000)} k de contexto`);
const price = (cost) => (Array.isArray(cost) && cost[0] != null ? (cost[0] === 0 && cost[1] === 0 ? "gratis" : `$${cost[0]}/$${cost[1]} por millón`) : null);

/** A searchable list of models (OpenRouter's hundreds, a server's few). */
function ModelSearch({ models, value, onPick, busy, name }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((m) => words.every((w) => (m.label + " " + m.id).toLowerCase().includes(w)));
  }, [models, q]);
  const cap = 80;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {models.length > 8 ? (
        <span style={{ position: "relative", display: "flex" }}>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", left: "12px", top: "12px", color: "var(--c-text-3)" }} />
          <input className="c-quiet" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={"Buscar un modelo de " + name} placeholder={`Busca entre ${models.length} modelos: claude, gemini, llama…`} style={{ ...input, paddingLeft: "36px", font: "400 var(--t-ui)/1 inherit" }} />
        </span>
      ) : null}
      <div role="listbox" aria-label={"Modelo de " + name} style={{ display: "flex", flexDirection: "column", maxHeight: "264px", overflowY: "auto", padding: "4px", borderRadius: "var(--r-lg)", background: "var(--c-sunken)" }}>
        {shown.slice(0, cap).map((m) => {
          const on = m.id === value;
          const meta = [m.vision ? "ve imágenes" : "solo texto", contextWords(m.context), price(m.cost)].filter(Boolean).join(" · ");
          return (
            <button key={m.id} type="button" role="option" aria-selected={on} disabled={busy} onClick={() => onPick(m)}
              style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "6px 12px", border: 0, borderRadius: "var(--r-md)", textAlign: "left", cursor: busy ? "wait" : "pointer", color: "var(--c-text)", background: on ? "var(--c-card)" : "transparent", boxShadow: on ? "var(--c-shadow-lift)" : "none", flex: "none" }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "var(--t-ui)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
                <span style={{ font: `400 var(--t-meta)/1.3 ${mono}`, color: "var(--c-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.id === "openrouter/auto" ? "OpenRouter elige el mejor para cada petición" : [m.id !== m.label ? m.id : null, meta].filter(Boolean).join(" · ")}</span>
              </span>
              {on ? <Check size={16} weight="bold" aria-hidden="true" style={{ flex: "none" }} /> : null}
            </button>
          );
        })}
        {!shown.length ? <span style={{ padding: "12px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>Ningún modelo coincide con «{q}».</span> : null}
        {shown.length > cap ? <span style={{ padding: "8px 12px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{`Y ${shown.length - cap} más: afina la búsqueda.`}</span> : null}
      </div>
    </div>
  );
}

/** «Probar» / «Conectar» answers: what worked, said once. */
function Result({ ok, error }) {
  if (error) return <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-error)" }}>{error}</p>;
  if (!ok) return null;
  return <p role="status" style={{ margin: 0, display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-ui)", color: "var(--c-ok-ink)" }}><Check size={16} weight="bold" aria-hidden="true" />{`Funciona: ${ok.label} contestó en ${seconds(ok.ms)}.`}</p>;
}

/**
 * The key, address and model of one provider. `mode` «connect» (a new account) or «manage»
 * (a connected one: only the model and «Probar»; the key stays where it is).
 */
export function KeyPanel({ engine, mode = "connect", info = null, catalog = [], onDone = () => {}, style = null }) {
  const act = useAction();
  const { run } = useStore();
  const k = KEY_INFO[engine];
  const name = ENGINE_NAMES[engine];
  const manage = mode === "manage";
  const dynamic = engine === "openrouter" || engine === "custom";
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(info?.baseUrl || "");
  const [model, setModel] = useState(manage ? info?.model || "" : engine === "openrouter" ? "openrouter/auto" : "");
  const [models, setModels] = useState(null);
  const [written, setWritten] = useState(""); // a server model typed by hand
  const [ok, setOk] = useState(null);
  const first = useRef(null);
  useEffect(() => { if (!manage) first.current?.focus(); }, [manage]);
  const typed = () => ({ ...(clean(key) ? { key: clean(key) } : {}), ...(engine === "custom" && !manage ? { baseUrl: baseUrl.trim() } : {}) });
  const body = () => ({ ...typed(), ...(model ? { model } : {}) });
  // OpenRouter's list is public: it is there before the key. A server's, when asked.
  const loadModels = () => act.act(async () => { const r = await post(`/ai/accounts/${engine}/models`, typed()); setModels(r?.models || []); });
  useEffect(() => { if (engine === "openrouter" || (engine === "custom" && manage)) loadModels(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const test = () => { setOk(null); act.act(async () => setOk(await post(`/ai/accounts/${engine}/test`, body()))); };
  const connect = () => { setOk(null); act.act(async () => {
    const r = await post(`/ai/accounts/${engine}`, body());
    if (r?.ok) onDone();
  }); };
  // In «Gestionar», a new model is saved at once («Deshacer» puts the old one back).
  const pin = info?.pinned || "";
  const choose = (next) => {
    setModel(next);
    if (!manage) return;
    const before = dynamic ? info?.model || null : pin || null;
    act.act(() => patch(`/ai/accounts/${engine}`, { model: next || null })).then((r) => r?.ok && reversible({ id: "ai-model:" + engine, text: `${name} piensa con ${next ? (catalog.find((m) => m.slug === next)?.label || models?.find((m) => m.id === next)?.label || next) : "el modelo automático"}`, ms: UNDO_MS, undo: () => run(() => patch(`/ai/accounts/${engine}`, { model: before })) }));
  };
  const auto = catalog.find((m) => m.families?.includes("sol"));
  const ready = manage || ((clean(key) || engine === "custom") && (engine !== "custom" || (baseUrl.trim() && model)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", animation: "rise .25s ease-out", ...style }}>
      {!manage ? (
        <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.6, color: "var(--c-text-3)" }}>
          {engine === "custom"
            ? "La dirección de tu servidor, normalmente acabada en /v1. En tu ordenador o tu red vale http://; fuera de ella, https://. Colmena solo llama a esa dirección."
            : <>Crea una clave en <a href={k.url} target="_blank" rel="noopener noreferrer" style={link}>{k.site}</a>. Se guarda cifrada en este ordenador y solo se ven sus últimos 4 caracteres.</>}
        </p>
      ) : null}
      {engine === "custom" && !manage ? (
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={label}>Dirección</span>
          <input ref={first} className="c-quiet" type="url" inputMode="url" autoComplete="off" spellCheck="false" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setModels(null); }} placeholder="http://localhost:11434/v1" style={input} />
        </label>
      ) : null}
      {!manage ? (
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "8px" }}>
            <span style={label}>{engine === "custom" ? "Clave (si la pide)" : "Clave de API"}</span>
            {k.url ? <a href={k.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "var(--t-meta)", color: "var(--c-text-2)", textUnderlineOffset: "3px" }}>Dónde consigo la clave<ExternalLink size={13} aria-hidden="true" /></a> : null}
          </span>
          <input ref={engine === "custom" ? null : first} className="c-quiet" type="password" autoComplete="off" spellCheck="false" value={key} onChange={(e) => setKey(e.target.value)} placeholder={k.placeholder} style={input} />
        </label>
      ) : null}

      {!dynamic && catalog.length ? (
        <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <span style={{ ...label, flex: "1 1 200px" }}>Modelo<span style={{ display: "block", fontWeight: 400, color: "var(--c-text-3)" }}>Automático elige uno por bot según su trabajo.</span></span>
          <Select aria-label={"Modelo de " + name} disabled={act.busy} value={manage ? pin : model} onChange={(e) => choose(e.target.value)} style={{ ...select, width: "260px" }}
            options={[["", "Automático" + (auto ? " · " + auto.label : "")], ...catalog.map((m) => [m.slug, m.label + (m.utility && !m.families?.length ? " (ligero)" : "")])]} />
        </label>
      ) : null}
      {dynamic ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <span style={label}>Modelo{manage && info?.modelLabel ? <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>{" · ahora " + info.modelLabel}</span> : null}</span>
            {engine === "custom" ? <button type="button" disabled={act.busy || (!manage && !baseUrl.trim())} onClick={loadModels} style={btn("ghost")}>{models ? "Volver a leer" : "Ver sus modelos"}</button> : null}
          </span>
          {models?.length ? <ModelSearch models={models} value={model} onPick={(m) => { setWritten(""); choose(m.id); }} busy={act.busy} name={name} /> : null}
          {engine === "custom" ? (
            <input className="c-quiet" type="text" autoComplete="off" spellCheck="false" aria-label="Nombre del modelo" value={written} onChange={(e) => { setWritten(e.target.value); setModel(e.target.value.trim()); }} onBlur={() => manage && written.trim() && written.trim() !== info?.model && choose(written.trim())} placeholder={models?.length ? "O escribe su nombre" : "Nombre del modelo, por ejemplo qwen3-coder:30b"} style={input} />
          ) : null}
        </div>
      ) : null}

      <Result ok={ok} error={act.error} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <button type="button" disabled={act.busy || !ready} onClick={test} style={{ ...btn("outline", 40), opacity: !ready ? 0.5 : 1 }}>{act.busy && !ok ? "Probando…" : "Probar"}</button>
        {!manage ? <button type="button" disabled={act.busy || !ready} onClick={connect} style={{ ...btn("dark", 40), opacity: !ready ? 0.5 : 1, cursor: act.busy ? "wait" : "pointer" }}>Conectar</button> : null}
        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{manage ? "Probar pide una respuesta de unas pocas palabras." : "Probar pide una respuesta de unas pocas palabras; Conectar la guarda."}</span>
      </div>
    </div>
  );
}

/** «Conectar otra IA»: the providers not connected yet, one open at a time. */
export function ConnectOther({ engines = [], catalog = {} }) {
  const left = KEY_ENGINES.filter((id) => !engines.find((e) => e.id === id)?.connected);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(null);
  if (!left.length) return null;
  const pick = chosen && left.includes(chosen) ? chosen : null;
  return (
    <section {...anchorOf("otra-ia")} aria-labelledby="otra-ia-t" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", scrollMarginTop: "24px", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", padding: "18px 20px" }}>
        <span aria-hidden="true" style={{ width: "44px", height: "44px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: "var(--c-chip)" }}><Plus size={22} /></span>
        <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <h3 id="otra-ia-t" style={{ margin: 0, fontSize: "var(--t-read)", fontWeight: 600 }}>Conectar otra IA</h3>
          <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>Gemini, OpenRouter, DeepSeek, Kimi o tu propio servidor, con una clave.</span>
        </span>
        <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); setChosen(null); }} style={btn(open ? "outline" : "dark", 40)}>{open ? "Cerrar" : "Elegir"}</button>
      </div>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px 20px 20px 80px", borderTop: LINE, animation: "fade .25s ease-out" }}>
          <div role="radiogroup" aria-label="Qué IA conectar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(250px, 100%), 1fr))", gap: "4px", padding: "6px", borderRadius: "var(--r-xl)", background: "var(--c-sunken)" }}>
            {left.map((id) => {
              const on = pick === id;
              return (
                <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setChosen(on ? null : id)}
                  style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "60px", padding: "8px 12px", border: 0, borderRadius: "var(--r-lg)", cursor: "pointer", textAlign: "left", color: "var(--c-text)", background: on ? "var(--c-card)" : "transparent", boxShadow: on ? "var(--c-shadow-lift)" : "none", transition: "background .2s ease" }}>
                  <ProviderMark engine={id} size={32} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                    <strong style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{ENGINE_NAMES[id]}</strong>
                    <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.35, color: "var(--c-text-3)" }}>{KEY_INFO[id].note}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {pick ? <KeyPanel key={pick} engine={pick} catalog={catalog[pick] || []} onDone={() => { setChosen(null); setOpen(false); }} /> : <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>Elige una para pegar su clave. Podrás usarla como principal, de respaldo o solo para algunos bots.</span>}
        </div>
      ) : null}
    </section>
  );
}

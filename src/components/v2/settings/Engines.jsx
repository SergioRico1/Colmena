import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import ProviderMark from "../ProviderMark.jsx";
import { useAction } from "../../../lib/store.jsx";
import { post } from "../../../lib/api.js";

// Ajustes › Inteligencia (v2): the accounts Colmena thinks with besides ChatGPT — Claude,
// connected the three ways OpenClaw offers, and OpenCode Go — plus which one the team
// uses and what takes over when it fails. Rows, one quiet panel at a time, nothing else.

const INK = "#12131A";
const MUTED = "#5C606C";
const FAINT = "#6B6F7A";
const LINE = "1px solid rgba(18,19,26,.06)";
const GREEN = "#0B6B4A";

export const pill = (dark) => ({ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600, flex: "none", background: dark ? INK : "rgba(18,19,26,.06)", color: dark ? "#FFFFFF" : INK });

function Command({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch {} };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "32px", padding: "0 4px 0 12px", borderRadius: "10px", background: "#F4F4F0", font: "500 13px/1 'Geist Mono', monospace", color: INK, verticalAlign: "middle" }}>
      {text}
      <button type="button" onClick={copy} aria-label={done ? "Copiado" : "Copiar " + text} title={done ? "Copiado" : "Copiar"} style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", border: 0, borderRadius: "8px", background: "transparent", cursor: "pointer", color: done ? GREEN : FAINT }}>
        {done ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={14} strokeWidth={2.2} aria-hidden="true" />}
      </button>
    </span>
  );
}

const field = { flex: "1 1 260px", minWidth: 0, height: "46px", padding: "0 16px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "14px", background: "#FFFFFF", font: "500 14px/1 'Geist Mono', monospace", color: INK, outline: "none" };

// Pasting often brings a trailing space, a line break or an invisible character.
const clean = (v) => String(v).replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "").replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, "");

function SecretForm({ placeholder, label, busy, onSubmit }) {
  const [value, setValue] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (clean(value)) onSubmit(clean(value)).then((ok) => ok && setValue("")); }} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <input ref={ref} type="password" autoComplete="off" spellCheck="false" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} style={field} />
      <button type="submit" disabled={busy || !clean(value)} style={{ ...pill(true), opacity: busy || !clean(value) ? 0.5 : 1, cursor: busy ? "wait" : "pointer" }}>{busy ? "Comprobando…" : "Conectar"}</button>
    </form>
  );
}

// OpenClaw's Anthropic choices (extensions/anthropic/openclaw.plugin.json), in its order.
const CLAUDE_WAYS = [
  { id: "cli", title: "Claude Code de este ordenador", sub: "Usa la sesión de Claude Code que ya tienes iniciada aquí." },
  { id: "token", title: "Token de suscripción", sub: "Un token creado con «claude setup-token» en tu terminal." },
  { id: "api_key", title: "Clave de API", sub: "Pago por uso desde la consola de Anthropic." },
];
const PLAN_NOTE = "Con tu suscripción, lo que hacen Claude Code y las apps de terceros descuenta de los límites de tu plan, y Anthropic puede cambiar estas condiciones. Para un uso continuo o compartido, la clave de API es la vía más predecible.";

export function ClaudePanel({ onDone, style = null }) {
  const act = useAction();
  const [way, setWay] = useState("cli");
  const connect = (body) => act.act(() => post("/auth/anthropic", body)).then((r) => { if (r?.ok) onDone(); return !!r?.ok; });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "2px 20px 20px 76px", borderBottom: LINE, animation: "rise .25s ease-out", ...style }}>
      <div role="radiogroup" aria-label="Cómo conectar Claude" style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "6px", borderRadius: "18px", background: "#F4F4F0" }}>
        {CLAUDE_WAYS.map((w) => {
          const on = way === w.id;
          return (
            <button key={w.id} type="button" role="radio" aria-checked={on} onClick={() => { act.setError(null); setWay(w.id); }} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "56px", padding: "8px 14px", border: 0, borderRadius: "14px", cursor: "pointer", textAlign: "left", color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.12)" : "none", transition: "background .2s ease" }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                <strong style={{ fontSize: "15px", fontWeight: 600 }}>{w.title}</strong>
                <span style={{ fontSize: "13px", color: MUTED }}>{w.sub}</span>
              </span>
              <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? INK : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
                <Check size={11} strokeWidth={3.4} color="#FFFFFF" style={{ opacity: on ? 1 : 0 }} />
              </span>
            </button>
          );
        })}
      </div>
      {way === "cli" ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px" }}>
          <span style={{ flex: "1 1 280px", fontSize: "14px", lineHeight: 1.6, color: MUTED }}>
            Si aún no has entrado, abre una terminal y escribe <Command text="claude auth login" />
          </span>
          <button type="button" disabled={act.busy} onClick={() => connect({ method: "cli" })} style={{ ...pill(true), cursor: act.busy ? "wait" : "pointer" }}>{act.busy ? "Comprobando…" : "Conectar"}</button>
        </div>
      ) : null}
      {way === "token" ? (
        <>
          <span style={{ fontSize: "14px", lineHeight: 1.6, color: MUTED }}>
            En una terminal, escribe <Command text="claude setup-token" /> y pega aquí el token que empieza por <span style={{ font: "500 13px 'Geist Mono', monospace", color: INK }}>sk-ant-oat01-</span>.
          </span>
          <SecretForm label="Token de suscripción de Claude" placeholder="sk-ant-oat01-…" busy={act.busy} onSubmit={(secret) => connect({ method: "token", secret })} />
        </>
      ) : null}
      {way === "api_key" ? (
        <>
          <span style={{ fontSize: "14px", lineHeight: 1.6, color: MUTED }}>
            Créala en <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: INK, fontWeight: 600 }}>console.anthropic.com</a>. Se guarda cifrada en este ordenador.
          </span>
          <SecretForm label="Clave de API de Anthropic" placeholder="sk-ant-api03-…" busy={act.busy} onSubmit={(secret) => connect({ method: "api_key", secret })} />
        </>
      ) : null}
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
      {way !== "api_key" ? (
        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.55, color: FAINT }}>
          {PLAN_NOTE}{" "}
          <a href="https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan" target="_blank" rel="noopener noreferrer" style={{ color: FAINT, fontWeight: 600 }}>Condiciones de Anthropic</a>
        </p>
      ) : null}
    </div>
  );
}

export function OpenCodePanel({ onDone, style = null }) {
  const act = useAction();
  const connect = (key) => act.act(() => post("/auth/opencode", { key })).then((r) => { if (r?.ok) onDone(); return !!r?.ok; });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "2px 20px 20px 76px", borderBottom: LINE, animation: "rise .25s ease-out", ...style }}>
      <span style={{ fontSize: "14px", lineHeight: 1.6, color: MUTED }}>
        Pega la clave de <a href="https://opencode.ai/auth" target="_blank" rel="noopener noreferrer" style={{ color: INK, fontWeight: 600 }}>opencode.ai/auth</a>. OpenCode Go es una suscripción aparte; la misma clave sirve para OpenCode Zen.
      </span>
      <SecretForm label="Clave de OpenCode" placeholder="Tu clave de OpenCode" busy={act.busy} onSubmit={connect} />
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
    </div>
  );
}

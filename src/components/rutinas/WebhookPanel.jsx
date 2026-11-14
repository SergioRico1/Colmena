import { useCallback, useEffect, useState } from "react";
import { del, get, post, put } from "../../lib/api.js";
import { ago } from "../../lib/format.js";
import { isCloud } from "../../lib/cloud.js";

// «Cuando avise otra app» in the routine builder (server/webhooks.mjs): which service, how its
// requests are signed, the filters, and — once the routine is saved — its secret address at
// the mailbox with copy, change and cancel, the shared secret, and the last requests.
// Same fields and tones as the other trigger editors of RutinasV2; no honey here.

const INK = "#12131A";
const MUTED = "#4A4D57";
const sel = (on) => (on ? INK : "rgba(18,19,26,.1)");
const label = { fontSize: "var(--t-meta)", fontWeight: 500, color: "var(--c-text-2)" };
const input = { height: "44px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .1)", borderRadius: "var(--r-md)", background: "var(--c-card)", fontSize: "var(--t-body)", color: "var(--c-text)", minWidth: 0 };
const pill = (on) => ({ minWidth: "44px", height: "38px", padding: "0 14px", border: `1.5px solid ${sel(on)}`, borderRadius: "var(--r-md)", background: "var(--c-card)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: on ? 600 : 500, color: "var(--c-text)" });
const quiet = (busy) => ({ height: "38px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-text)", cursor: busy ? "wait" : "pointer" });

/** The presets as the server gives them; these stand in until they load (same ids and settings). */
export const HOOK_DEFAULT = { servicio: "generico", firma: "ninguna", cabeceraFirma: "", cabeceraEvento: "", eventos: "", filtros: [], asuntoRuta: "" };
const SERVICES = [["github_pr", "GitHub: pull request"], ["github_check", "GitHub: falla una comprobación"], ["sentry", "Sentry: error nuevo"], ["generico", "Otra app"]];
const SIGNATURES = [["ninguna", "Sin firma"], ["github", "GitHub"], ["stripe", "Stripe"], ["hmac", "HMAC-SHA256"]];
const STATUS = {
  disparado: ["Puesta en marcha", "#E3F4EC", "#0B6B4A"], sumado: ["Sumado", "#E3F4EC", "#0B6B4A"], resumen: ["Para un resumen", "#EEF0F4", "#1F4FD1"],
  recibido: ["Recibido", "#F1F1EC", MUTED], filtrado: ["No encajaba", "#F1F1EC", MUTED], duplicado: ["Repetido", "#F1F1EC", MUTED],
  limitado: ["Limitado", "#FBE9EA", "#B4232A"], frenado: ["Frenado", "#FBE9EA", "#B4232A"], rechazado: ["Rechazado", "#FBE9EA", "#B4232A"],
};

function Pills({ title, items, value, onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={label}>{title}</span>
      <div role="radiogroup" aria-label={title} style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {items.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onPick(v)} style={pill(value === v)}>{text}</button>)}
      </div>
    </div>
  );
}
function Field({ title, value, onChange, placeholder, type = "text", flex = "1 1 220px" }) {
  return (
    <label style={{ flex, display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
      <span style={label}>{title}</span>
      <input className="c-quiet" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} style={input} />
    </label>
  );
}

/**
 * `hook`: the trigger's settings (HOOK_DEFAULT shape); `onChange(patch)` marks the «when» as
 * touched. `ruleId`: the saved routine (null while new); `onCreate()` saves it paused so it
 * gets its address.
 */
export default function WebhookPanel({ hook, onChange, ruleId, onCreate, busy }) {
  const [presets, setPresets] = useState(null);
  useEffect(() => { let on = true; get("/webhooks/presets").then((d) => { if (on) setPresets(d?.presets || []); }).catch(() => {}); return () => { on = false; }; }, []);
  const preset = (presets || []).find((p) => p.id === hook.servicio) || null;
  const pickService = (id) => {
    const p = (presets || []).find((x) => x.id === id);
    onChange(p ? { servicio: id, ...p.config } : { servicio: id });
  };
  const filtros = hook.filtros || [];
  const setFilter = (i, patch) => onChange({ filtros: filtros.map((f, n) => (n === i ? { ...f, ...patch } : f)) });

  return (
    <>
      <Pills title="Qué app avisa" items={SERVICES} value={hook.servicio} onPick={pickService} />
      <Pills title="Cómo firma sus avisos" items={SIGNATURES} value={hook.firma} onPick={(v) => onChange({ firma: v })} />
      {hook.firma === "hmac" ? <Field title="Cabecera que trae la firma" value={hook.cabeceraFirma} onChange={(v) => onChange({ cabeceraFirma: v.trim() })} placeholder="X-Signature" flex="none" /> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <Field title="Cabecera con el tipo de aviso (vacío: cualquiera)" value={hook.cabeceraEvento} onChange={(v) => onChange({ cabeceraEvento: v.trim() })} placeholder="X-GitHub-Event" />
        <Field title="Tipos que te interesan, separados por comas" value={hook.eventos} onChange={(v) => onChange({ eventos: v })} placeholder="pull_request, push" />
      </div>
      <div role="group" aria-label="Filtros" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={label}>{isCloud() ? "Solo si (se comprueba en Colmena, sin gastar IA)" : "Solo si (se comprueba en tu ordenador, sin gastar IA)"}</span>
        {filtros.map((f, i) => (
          <div key={i} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <input className="c-quiet" type="text" aria-label={`Campo del filtro ${i + 1}`} value={f.ruta} onChange={(e) => setFilter(i, { ruta: e.target.value })} placeholder="pull_request.base.ref" spellCheck={false} style={{ ...input, flex: "1 1 180px", height: "38px" }} />
            {[["igual", "es"], ["contiene", "contiene"]].map(([op, text]) => <button key={op} type="button" aria-pressed={f.op === op} onClick={() => setFilter(i, { op })} style={pill(f.op === op)}>{text}</button>)}
            <input className="c-quiet" type="text" aria-label={`Valor del filtro ${i + 1}`} value={f.valor} onChange={(e) => setFilter(i, { valor: e.target.value })} placeholder="main" spellCheck={false} style={{ ...input, flex: "1 1 140px", height: "38px" }} />
            <button type="button" onClick={() => onChange({ filtros: filtros.filter((_, n) => n !== i) })} aria-label={`Quitar el filtro ${i + 1}`} style={quiet(false)}>Quitar</button>
          </div>
        ))}
        {filtros.length < 5 ? <button type="button" onClick={() => onChange({ filtros: [...filtros, { ruta: "", op: "igual", valor: "" }] })} style={{ ...quiet(false), alignSelf: "flex-start" }}>Añadir un filtro</button> : null}
      </div>
      {ruleId ? <Address ruleId={ruleId} signed={hook.firma !== "ninguna"} steps={preset?.steps || []} /> : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "var(--c-card)", fontSize: "var(--t-ui)", lineHeight: 1.45 }}>
          <span style={{ flex: "1 1 280px", color: "var(--c-text-2)" }}>La dirección secreta que pegarás en esa app se crea al guardar la rutina. Se guarda en pausa hasta que la actives.</span>
          <button type="button" onClick={onCreate} disabled={busy} style={quiet(busy)}>Crear la dirección</button>
        </div>
      )}
    </>
  );
}

/** The saved routine's address, secret and last requests (GET /automations/:id/webhook, looked at every few seconds). */
function Address({ ruleId, signed, steps }) {
  const path = `/automations/${encodeURIComponent(ruleId)}/webhook`;
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState(null);
  const load = useCallback(() => get(path).then((d) => { setView(d); return d; }).catch((e) => setError(e.message)), [path]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);
  const run = async (fn) => {
    setWorking(true);
    setError(null);
    try { setView(await fn()); } catch (e) { setError(e.message); } finally { setWorking(false); setConfirm(null); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(view.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError("No se pudo copiar. Selecciona la dirección y cópiala a mano."); }
  };
  if (!view) return <span role="status" style={{ fontSize: "var(--t-ui)", color: error ? "var(--c-error)" : "var(--c-text-3)" }}>{error || "Preparando la dirección…"}</span>;
  const revoked = view.state === "revocada";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px", borderRadius: "var(--r-lg)", background: "var(--c-card)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={label}>Dirección para pegar en esa app</span>
        {view.url ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <input className="c-quiet" type="text" readOnly aria-label="Dirección del aviso" value={view.url} onFocus={(e) => e.target.select()} style={{ ...input, flex: "1 1 320px", font: "500 var(--t-meta)/1 'Geist Mono', monospace" }} />
            <button type="button" onClick={copy} style={quiet(false)}>{copied ? "Copiada" : "Copiar"}</button>
          </div>
        ) : (
          <span role="status" style={{ fontSize: "var(--t-ui)", lineHeight: 1.45, color: view.error ? "var(--c-error)" : "var(--c-text-2)" }}>{revoked ? "Anulaste la dirección: ahora no llega nada. Crea otra cuando quieras." : view.error || "Preparando la dirección…"}</span>
        )}
        <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{isCloud()
          ? "Quien tenga esta dirección puede poner en marcha la rutina, así que no la compartas. Colmena la atiende en la nube de tu empresa, aunque nadie la tenga abierta."
          : "Quien tenga esta dirección puede poner en marcha la rutina, así que no la compartas. El buzón de Colmena cifra cada aviso para este ordenador nada más llegar y lo guarda 3 días como mucho, hasta que Colmena esté abierta."}</span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          {confirm ? (
            <>
              <span style={{ flex: "1 1 240px", fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>{confirm === "rotate" ? "La dirección de ahora dejará de funcionar y tendrás que pegar la nueva en esa app." : "Dejará de llegar todo hasta que crees otra dirección."}</span>
              <button type="button" disabled={working} onClick={() => run(() => post(`${path}/${confirm}`, {}))} style={{ ...quiet(working), background: "var(--c-btn)", color: "var(--c-btn-text)", border: 0 }}>{confirm === "rotate" ? "Sí, cambiarla" : "Sí, anularla"}</button>
              <button type="button" disabled={working} onClick={() => setConfirm(null)} style={quiet(working)}>No</button>
            </>
          ) : revoked || !view.url ? (
            view.state === "sin-buzon" ? null : <button type="button" disabled={working} onClick={() => run(() => post(`${path}/rotate`, {}))} style={quiet(working)}>{revoked ? "Crear otra dirección" : "Volver a intentarlo"}</button>
          ) : (
            <>
              <button type="button" onClick={() => setConfirm("rotate")} style={quiet(false)}>Cambiar la dirección</button>
              <button type="button" onClick={() => setConfirm("revoke")} style={quiet(false)}>Anular la dirección</button>
            </>
          )}
        </div>
      </div>

      {signed ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={label}>Secreto de la firma {view.secret ? "(guardado)" : "(falta: sin él se rechaza todo)"}</span>
          {view.canKeepSecret ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
              <input className="c-quiet" type="password" aria-label="Secreto de la firma" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={view.secret ? "Escribe otro para cambiarlo" : "El mismo que pusiste en esa app"} autoComplete="new-password" style={{ ...input, flex: "1 1 260px" }} />
              <button type="button" disabled={working || !secret.trim()} onClick={() => run(async () => { const v = await put(`${path}/secret`, { value: secret }); setSecret(""); return v; })} style={quiet(working)}>Guardar</button>
              {view.secret ? <button type="button" disabled={working} onClick={() => run(() => del(`${path}/secret`))} style={quiet(working)}>Quitar</button> : null}
            </div>
          ) : <span style={{ fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{isCloud() ? "Ahora no puedo guardar el secreto de forma segura, así que no puedo comprobar firmas." : "En este ordenador no puedo guardar el secreto de forma segura, así que no puedo comprobar firmas."}</span>}
          <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{isCloud() ? "Se guarda cifrado en la nube de tu empresa y no sale de ella: la firma se comprueba allí." : "Se guarda cifrado en este ordenador y no sale de él: la firma se comprueba aquí."}</span>
        </div>
      ) : (
        <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>Sin firma, cualquiera que conozca la dirección puede mandar un aviso. Si esa app sabe firmarlos, elige cómo arriba.</span>
      )}

      {steps.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={label}>Qué hacer en esa app</span>
          <ol style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-text)" }}>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ ...label, marginBottom: "6px" }}>Últimos avisos</span>
        {view.deliveries.length ? view.deliveries.slice(0, 10).map((d, i) => {
          const [text, bg, fg] = STATUS[d.status] || STATUS.recibido;
          return (
            <div key={d.at + i} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", minHeight: "40px", padding: "4px 0", borderTop: i ? "1px solid rgb(var(--c-ink-rgb) / .06)" : 0, fontSize: "var(--t-ui)" }}>
              <span style={{ flex: "none", width: "92px", color: "var(--c-text-3)" }}>{ago(d.at)}</span>
              <span style={{ flex: "none", height: "24px", padding: "0 9px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: bg, color: fg, fontSize: "var(--t-meta)", fontWeight: 600 }}>{text}{d.count > 1 ? ` · ${d.count}` : ""}</span>
              <span style={{ flex: "1 1 200px", minWidth: 0, color: "var(--c-text-2)" }}>{[d.event, d.detail].filter(Boolean).join(" · ")}</span>
            </div>
          );
        }) : <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>Aún no ha llegado ninguno.</span>}
      </div>
      {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</span> : null}
    </div>
  );
}

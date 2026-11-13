import { useEffect, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import NotFound from "./NotFound.jsx";
import { Shape, srOnly } from "../components/v3/dia/parts.jsx";
import { useStore } from "../lib/store.jsx";
import { patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { roomUrl, time } from "../lib/format.js";
import { cancel, schedule, useUndoable } from "../lib/undoable.js";
import { later } from "../lib/undoToast.js";
import { useExpert } from "../lib/expert.js";
import HoldButton from "../components/HoldButton.jsx";
import { useApprovalCard } from "../components/ApprovalParts.jsx";

// Colmena 3 · «Revisa antes de enviar» (design/V3Revisar.dc.html): the mail as a form you can
// change in place (recipients, subject, text; attachments can be taken out), beside why it
// asks you, what its bot checked and whom it affects. «Guardar sin enviar» keeps it pending;
// «Mantén para enviar» saves what you changed and waits 10 s with «Deshacer»; «No enviar» goes
// with a 5 s notice. The verbs, the undo line and what happens at expiry come from
// lib/approvalCard.js, the same as on every other surface. Other requests (permissions, plans, memories…) use the same page.
const isMail = (v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v || "").trim());
const first = (e) => { const local = String(e).split("@")[0].replace(/[._]/g, " ").split(" ")[0]; return local.charAt(0).toUpperCase() + local.slice(1); };
const EXT = { PDF: ["#FBE9EA", "#B4232A"], XLS: ["#E3F4EC", "#0B6B4A"], CSV: ["#E3F4EC", "#0B6B4A"], PPT: ["#FFE6F1", "#9C1F5C"], DOC: ["#E3EAFB", "#1F3F99"] };
const extOf = (name) => (String(name).split(".").pop() || "").toUpperCase().slice(0, 3);
const sizeOf = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace(".", ",")} MB`);
const fromEmail = (e) => ({ to: [...(e?.to || [])], cc: [...(e?.cc || [])], cco: [...(e?.cco || [])], subject: e?.subject || "", body: e?.body || "", files: (e?.attachments || []).map((f) => (typeof f === "string" ? { name: f } : { ...f })) });
const KIND_TITLE = { send: "Revisa antes de enviar", permission: "Revisa antes de dar permiso", plan: "Revisa el plan", question: "Una pregunta para ti", secret: "Te pide una clave", memory: "Revisa lo que quiere recordar", skill: "Revisa la habilidad nueva", soul: "Revisa el cambio de instrucciones", write: "Revisa antes de guardar" };
const KIND_LEAD = { send: "Puedes cambiar lo que quieras. Nada sale hasta que lo apruebes tú.", plan: "El equipo empieza cuando le des el OK en la sala.", question: "Respóndela en su chat o desde Inicio." };
const day = (iso) => { const d = new Date(iso); const diff = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 864e5); return diff === 0 ? "hoy" : diff === 1 ? "mañana" : diff === -1 ? "ayer" : d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" }); };

export default function Revisar({ params = {} }) {
  const store = useStore();
  const { approvals, bots, missions, ready } = store;
  const [expert] = useExpert();
  const a = approvals.find((r) => r.id === params.id) || null;
  const bot = bots.find((b) => b.id === a?.botId) || null;
  const mission = missions.find((m) => m.id === a?.missionId) || null;
  const key = "approval:" + params.id;
  const undo = useUndoable(key);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [extra, setExtra] = useState(false); // CC · CCO open
  const [inputs, setInputs] = useState({ to: "", cc: "", cco: "" });
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const onFail = (e) => { if (e.detail?.id === key) { setSent(null); setError(e.detail.message || "No se pudo enviar."); } };
    window.addEventListener("colmena:undo-failed", onFail);
    return () => window.removeEventListener("colmena:undo-failed", onFail);
  }, [key]);
  const isSend = a?.kind === "send" && !!a?.email;
  const data = isSend ? fromEmail(a.email) : null;
  const d = draft || data;
  let changes = 0;
  if (draft && data) {
    for (const k of ["to", "cc", "cco", "files"]) if (JSON.stringify(draft[k]) !== JSON.stringify(data[k])) changes++;
    if (draft.subject !== data.subject) changes++;
    if (draft.body !== data.body) changes++;
  }
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !changes && !e.target.closest?.("input,textarea")) navigate("/"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changes]);

  // The same verbs, undo line and expiry line as on Inicio, in the chat and in a room.
  const model = useApprovalCard(a?.status === "pending" ? a : null, bot?.name);

  if (!ready) return <Shell active="inicio"><div /></Shell>;
  if (!a || (a.status !== "pending" && !sent && !undo.waiting)) {
    return <NotFound title="Esta solicitud ya no está" text="Ya se resolvió o caducó. No se ha perdido nada de lo tuyo." />;
  }
  const set = (fn) => setDraft((old) => { const next = JSON.parse(JSON.stringify(old || data)); fn(next); return next; });
  const add = (field) => { const v = inputs[field].trim(); if (!isMail(v)) return; set((n) => { if (!n[field].includes(v)) n[field].push(v); }); setInputs({ ...inputs, [field]: "" }); };

  // Saves what you changed; returns the request as it is now (with its new revision).
  const save = async () => {
    const view = await store.run(() => patch(`/approvals/${a.id}/email`, { revision: a.revision, to: d.to, cc: d.cc, cco: d.cco, subject: d.subject, body: d.body, attachments: d.files.map((f) => ({ name: f.name, ...(f.size != null ? { size: f.size } : {}) })) }));
    setDraft(null);
    setInputs({ to: "", cc: "", cco: "" });
    return view;
  };
  const fail = (e) => setError(e.status === 409 ? "El bot cambió el envío mientras lo editabas. Vuelve a abrirlo para ver la versión nueva." : e.message);
  const keep = async () => {
    setBusy(true);
    setError(null);
    try { await save(); setSaved(true); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const approve = async () => {
    setSaved(false);
    setError(null);
    let revision = a.revision;
    if (changes) {
      setBusy(true);
      try { revision = (await save())?.revision || revision; } catch (e) { fail(e); setBusy(false); return; }
      setBusy(false);
    }
    const copy = (d?.cc || []).length ? ` ${first(d.cc[0])} recibe una copia.` : "";
    schedule(key, async () => {
      await post(`/approvals/${a.id}`, { decision: "approved", revision });
      setSent(isSend ? `Enviado.${copy}` : `Aprobado a las ${time(new Date())}.`);
    });
  };
  // Only what is approved on this page gets the approve button (a plan, a key and a question are not).
  const canApprove = model?.primary?.action === "approve";
  const denyLabel = model?.secondary.find((s) => s.id === "deny")?.label || "No permitir";
  const deny = () => {
    later({ id: "deny:" + a.id, keys: [key], text: model?.denyToast || "No se permite", error: "No se pudo descartar", run: () => post(`/approvals/${a.id}`, { decision: "denied", revision: a.revision }) });
    navigate("/");
  };

  const where = mission ? (mission.conversation ? "en el chat" : <>{"en "}<a href={roomUrl(mission)} style={{ color: "var(--c-accent-ink)" }}>{mission.title || "#" + mission.room}</a></>) : null;
  const outside = a.external || a.redLine || a.impact?.tone === "external";
  const why = isSend
    ? outside ? <>{"Enviar algo fuera de Colmena es una "}<strong style={{ fontWeight: "600" }}>{"línea roja"}</strong>{": siempre necesita tu OK, aunque el bot actúe solo en lo demás."}</> : "Todo lo que sale en tu nombre espera tu OK. Puedes cambiarlo en Ajustes › Permisos y autonomía."
    : a.redLine ? <>{"Es una "}<strong style={{ fontWeight: "600" }}>{"línea roja"}</strong>{" (dinero, publicar, borrar o salir de tu empresa): siempre te pregunta."}</>
      : a.kind === "plan" ? "El equipo no empieza un trabajo grande sin que veas cómo lo va a hacer."
        : `${bot?.name || "El bot"} no puede hacer esto sin ti con los permisos que le diste.`;
  const people = isSend ? d.to.length + d.cc.length + d.cco.length : 0;
  const affects = a.impact?.headline || (isSend ? `${people === 1 ? "1 persona" : people + " personas"}${d.cc.length ? `, ${d.cc.length} en copia` : ""}.` : null);
  const card = { display: "flex", flexDirection: "column", gap: "10px", padding: "20px", borderRadius: "var(--r-xl)", background: "var(--c-card)" };
  const h2 = { margin: "0", fontSize: "var(--t-body)", fontWeight: "600" };
  const p = { margin: "0", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)" };
  const chip = (field, e, i) => (
    <span key={e + i} style={{ height: "30px", padding: "0 6px 0 12px", display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "var(--r-pill)", background: "var(--c-chip)", fontSize: "var(--t-ui)" }}>
      {e}{field === "cc" ? " (CC)" : field === "cco" ? " (CCO)" : ""}
      <button type="button" aria-label={`Quitar ${e}`} onClick={() => set((n) => n[field].splice(i, 1))} style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "var(--r-circle)", background: "transparent", color: "var(--c-text-3)", cursor: "pointer" }}>{"×"}</button>
    </span>
  );
  const adder = (field, label) => (
    <label key={"add" + field} style={{ display: "inline-flex", alignItems: "center" }}>
      <span style={srOnly}>{label}</span>
      <input className="c-bare" type="email" value={inputs[field]} placeholder="Añadir" onChange={(e) => setInputs({ ...inputs, [field]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(field); } }} onBlur={() => add(field)}
        style={{ width: "180px", height: "30px", padding: "0 10px", border: "0", background: "transparent", fontSize: "var(--t-ui)", color: "var(--c-text)" }} />
    </label>
  );
  const row = { display: "flex", alignItems: "center", gap: "12px", padding: "14px 22px", borderBottom: "1px solid rgb(var(--c-ink-rgb) / .07)" };
  const label = { flex: "none", width: "64px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" };
  const pill = (dark) => ({ height: "46px", padding: dark ? "0 22px" : "0 18px", border: dark ? "0" : "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: dark ? "var(--c-btn)" : "var(--c-card)", color: dark ? "var(--c-btn-text)" : "var(--c-text)", fontSize: "var(--t-body)", fontWeight: dark ? "600" : "500", cursor: "pointer" });
  const crumb = isSend && data.subject ? `Enviar «${data.subject}»` : a.title;

  return (
    <Shell active="inicio">
      <main style={{ maxWidth: "1120px", margin: "0 auto", padding: "36px clamp(20px, 4vw, 52px) 64px", display: "flex", flexDirection: "column", gap: "26px" }}>
        <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", color: "var(--c-text-3)", minWidth: 0 }}>
          <a href="/" style={{ color: "var(--c-text-3)" }}>{"Inicio"}</a><span aria-hidden="true">{"›"}</span><span>{"Te necesita"}</span><span aria-hidden="true">{"›"}</span>
          <span style={{ color: "var(--c-text)", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{crumb}</span>
        </nav>

        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Shape bot={bot} size={22} />
              <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}><strong style={{ color: "var(--c-text)", fontWeight: "600" }}>{bot?.name || "Un bot"}</strong>{isSend ? " lo preparó " : " lo pide "}{where}{" · " + day(a.createdAt) + " " + time(a.createdAt)}</span>
            </div>
            <h1 style={{ margin: "0", font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{KIND_TITLE[a.kind] || "Revisa antes de aprobar"}</h1>
            <p style={{ margin: "0", fontSize: "var(--t-read)", color: "var(--c-text-2)" }}>{KIND_LEAD[a.kind] || "Nada cambia hasta que pulses «Aprobar»."}</p>
          </div>
          {sent ? null : <span style={{ height: "30px", padding: "0 12px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-honey)", color: "var(--c-honey-ink)", fontSize: "var(--t-meta)", fontWeight: "600" }}>{"Te necesita"}</span>}
        </header>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
          {isSend ? (
            <section aria-label="Correo" style={{ flex: "999 1 520px", minWidth: "0", display: "flex", flexDirection: "column", background: "var(--c-card)", borderRadius: "var(--r-2xl)", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 56px -32px rgba(18,19,26,.3)", overflow: "hidden" }}>
              <div style={row}>
                <span style={label}>{"Para"}</span>
                <div style={{ flex: "1", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                  {d.to.map((e, i) => chip("to", e, i))}
                  {!extra ? d.cc.map((e, i) => chip("cc", e, i)) : null}
                  {!extra ? d.cco.map((e, i) => chip("cco", e, i)) : null}
                  {adder("to", "Añadir destinatario")}
                </div>
                <button type="button" aria-expanded={extra ? "true" : "false"} onClick={() => setExtra(!extra)} style={{ flex: "none", height: "30px", padding: "0 8px", border: "0", background: "transparent", fontSize: "var(--t-ui)", color: "var(--c-text-2)", cursor: "pointer" }}>{"CC · CCO"}</button>
              </div>
              {extra ? ["cc", "cco"].map((f) => (
                <div key={f} style={{ ...row, animation: "fade .25s ease-out" }}>
                  <span style={label}>{f === "cc" ? "CC" : "CCO"}</span>
                  <div style={{ flex: "1", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>{d[f].map((e, i) => chip(f, e, i))}{adder(f, f === "cc" ? "Añadir en copia" : "Añadir en copia oculta")}</div>
                </div>
              )) : null}
              <label className="c-ring-in" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 22px", borderBottom: "1px solid rgb(var(--c-ink-rgb) / .07)" }}>
                <span style={label}>{"Asunto"}</span>
                <input className="c-bare" type="text" value={d.subject} onChange={(e) => set((n) => { n.subject = e.target.value; })} style={{ flex: "1", minWidth: "0", height: "52px", border: "0", background: "transparent", fontSize: "var(--t-read)", fontWeight: "600" }} />
              </label>
              <label className="c-ring-in" style={{ display: "flex", flexDirection: "column", padding: "18px 22px" }}>
                <span style={srOnly}>{"Cuerpo del mensaje"}</span>
                <textarea className="c-bare" rows="12" value={d.body} onChange={(e) => set((n) => { n.body = e.target.value; })} style={{ width: "100%", border: "0", resize: "vertical", background: "transparent", fontSize: "var(--t-read)", lineHeight: "1.65", color: "var(--c-text)" }} />
              </label>
              {d.files.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "14px 22px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .07)", background: "var(--c-sunken)" }}>
                  {d.files.map((f, i) => {
                    const e = extOf(f.name);
                    const [bg, fg] = EXT[e] || ["#EEF0F4", "#4A4F5C"];
                    return (
                      <span key={f.name + i} style={{ height: "44px", padding: "0 6px 0 8px", display: "inline-flex", alignItems: "center", gap: "10px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid rgb(var(--c-ink-rgb) / .08)", fontSize: "var(--t-ui)" }}>
                        <span aria-hidden="true" style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: bg, color: fg, fontSize: "var(--t-micro)", fontWeight: "700" }}>{e}</span>
                        {f.name}{f.size != null ? <span style={{ color: "var(--c-text-3)" }}>{"· " + sizeOf(f.size)}</span> : null}
                        <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => set((n) => n.files.splice(i, 1))} style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", padding: "0", border: "0", borderRadius: "var(--r-circle)", background: "transparent", color: "var(--c-text-3)", cursor: "pointer" }}>{"×"}</button>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : (
            <section aria-label="Qué pide" style={{ flex: "999 1 520px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px", padding: "24px", background: "var(--c-card)", borderRadius: "var(--r-2xl)", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 56px -32px rgba(18,19,26,.3)" }}>
              <h2 style={{ margin: "0", font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{a.title}</h2>
              {a.summary && a.summary !== a.title ? <p style={{ margin: "0", fontSize: "var(--t-read)", lineHeight: "1.65", whiteSpace: "pre-wrap" }}>{a.summary}</p> : null}
              {a.context ? <p style={{ margin: "0", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{a.context}</p> : null}
              {a.kind === "plan" && mission ? <a href={`/sala/${mission.id}#plan`} style={{ alignSelf: "flex-start", fontSize: "var(--t-body)", fontWeight: "600", color: "var(--c-accent-ink)" }}>{"Ver el plan en la sala"}</a> : null}
              {a.kind === "question" && mission ? <a href={roomUrl(mission)} style={{ alignSelf: "flex-start", fontSize: "var(--t-body)", fontWeight: "600", color: "var(--c-accent-ink)" }}>{"Responder en el chat"}</a> : null}
            </section>
          )}

          <aside style={{ flex: "1 1 300px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={card}>
              <h2 style={h2}>{"Por qué te pregunta"}</h2>
              <p style={{ ...p, color: "var(--c-text-2)" }}>{why}</p>
            </div>
            {a.reviewNote ? (
              <div style={card}>
                <h2 style={h2}>{`${bot?.name || "El bot"} comprobó`}</h2>
                {String(a.reviewNote).split(/\n+|(?<=\.)\s+(?=[A-ZÁÉÍÓÚ])/).filter(Boolean).slice(0, 4).map((k, i) => (
                  <div key={i} style={{ display: "flex", gap: "10px", fontSize: "var(--t-ui)", lineHeight: "1.45" }}><span aria-hidden="true" style={{ color: "var(--c-ok-ink)", fontWeight: "600" }}>{"✓"}</span><span>{k}</span></div>
                ))}
              </div>
            ) : null}
            {affects || a.impact?.details?.length ? (
              <div style={card}>
                <h2 style={h2}>{"A quién afecta"}</h2>
                {affects ? <p style={p}>{affects}</p> : null}
                {(a.impact?.details || []).slice(0, 4).map((t, i) => <p key={i} style={{ ...p, fontSize: "var(--t-ui)" }}>{typeof t === "string" ? t : t.text || t.label}</p>)}
              </div>
            ) : null}
            <details open={expert || undefined} style={{ padding: "16px 20px", borderRadius: "var(--r-xl)", background: "var(--c-card)", fontSize: "var(--t-ui)" }}>
              <summary style={{ cursor: "pointer", fontWeight: "600" }}>{"Detalles técnicos"}</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "10px", font: "400 var(--t-meta)/1.6 'Geist Mono', monospace", color: "var(--c-text-2)", overflowWrap: "anywhere" }}>
                <span>{[a.kind, a.app, a.scopeLabel].filter(Boolean).join(" · ")}</span>
                <span>{`${a.id} · ${a.status === "pending" ? "esperando OK" : a.status}${a.edited ? " · editado" : ""}`}</span>
                {a.revision ? <span>{"contenido ligado: sha256 " + String(a.revision).slice(0, 4) + "…" + String(a.revision).slice(-4)}</span> : null}
                {a.computer ? <span>{"en este ordenador"}</span> : null}
              </div>
            </details>
          </aside>
        </div>

        <div style={{ position: "sticky", bottom: "16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "12px 12px 12px 20px", borderRadius: "var(--r-xl)", background: "var(--c-card)", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 20px 40px -20px rgba(18,19,26,.35)" }}>
          {error ? <span role="alert" style={{ flexBasis: "100%", fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</span> : null}
          {sent ? (
            <>
              <span role="status" style={{ flex: "1", display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-body)", fontWeight: "500", color: "var(--c-ok-ink)" }}>
                <span aria-hidden="true" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "#0B8A5F", animation: "pop .4s ease-out" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                </span>
                {sent}
              </span>
              <a href="/" style={{ ...pill(true), display: "inline-flex", alignItems: "center" }}>{"Volver a Inicio"}</a>
            </>
          ) : undo.waiting ? (
            <>
              <span role="status" style={{ flex: "1", fontSize: "var(--t-body)", fontWeight: "500" }}>{`${isSend ? "Se envía" : "Se aprueba"} en ${undo.secs} s.${isSend && d.cc.length ? ` ${first(d.cc[0])} recibirá una copia.` : ""}`}</span>
              <button type="button" onClick={() => cancel(key)} style={pill(true)}>{"Deshacer"}</button>
            </>
          ) : (
            <>
              <span style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--t-ui)", lineHeight: "1.4", color: "var(--c-text-3)" }}>
                <span role="status">
                  {saved && !changes ? "Cambios guardados. Aún no se ha enviado." : changes ? (changes === 1 ? "1 cambio sin guardar. " : `${changes} cambios sin guardar. `) + (canApprove ? "Al aprobar se guardan. " + model.undoLine : "") : canApprove ? model.undoLine : ""}
                </span>
                {model?.expiryLine ? <span role="timer" aria-live="off" style={{ color: model.expiryLine.urgent ? "var(--c-error)" : "var(--c-text-3)" }}>{model.expiryLine.text}</span> : null}
              </span>
              <button type="button" disabled={busy} onClick={deny} style={{ height: "46px", padding: "0 14px", border: "0", background: "transparent", fontSize: "var(--t-body)", fontWeight: "500", color: "var(--c-text-2)", cursor: "pointer" }}>{denyLabel}</button>
              {isSend ? <button type="button" disabled={busy || !changes || !d.to.length} onClick={keep} style={{ ...pill(false), opacity: changes && d.to.length ? 1 : 0.55, cursor: changes ? "pointer" : "default" }}>{busy ? "Guardando…" : "Guardar sin enviar"}</button> : null}
              {!canApprove ? null
                : model.primary.hold ? <HoldButton disabled={busy || (isSend && !d.to.length)} onConfirm={approve} plainLabel={model.primary.plain} style={pill(true)}>{model.primary.label}</HoldButton>
                : <button type="button" disabled={busy || (isSend && !d.to.length)} onClick={approve} style={pill(true)}>{model.primary.label}</button>}
            </>
          )}
        </div>
      </main>
    </Shell>
  );
}

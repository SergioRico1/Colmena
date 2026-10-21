import { useEffect, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import NotFound from "./NotFound.jsx";
import { useStore } from "../lib/store.jsx";
import { patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { greeting, time } from "../lib/format.js";
import { cancel, schedule, useUndoable } from "../lib/undoable.js";
import { needsCount } from "../components/v2/needs.js";

// Colmena 2.0 · 26 «Revisar y editar envío» (design/V2Revisar.dc.html): a sheet over Hoy with
// exactly what goes out. «Editar» turns it into a form in place; «Guardar cambios» keeps it
// pending («Cambios guardados. Aún no se ha enviado.»); «Aprobar y enviar» waits 10 s with
// «Deshacer». Other requests (permissions, files, memories…) use the same sheet.
const isMail = (v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v || "").trim());
const person = (e) => { const local = String(e).split("@")[0].replace(/[._]/g, " "); return { n: local.charAt(0).toUpperCase() + local.slice(1), e }; };
const EXT = { PDF: ["#FBE7DF", "#8E2A1F"], XLS: ["#E1F4EC", "#0B6B4A"], CSV: ["#E1F4EC", "#0B6B4A"], PPT: ["#FFE6F1", "#9C1F5C"], DOC: ["#E3EAFB", "#1F3F99"] };
const extOf = (name) => (String(name).split(".").pop() || "").toUpperCase().slice(0, 3);
const sizeOf = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace(".", ",")} MB`);
const fromEmail = (e) => ({ to: [...(e?.to || [])], cc: [...(e?.cc || [])], cco: [...(e?.cco || [])], subject: e?.subject || "", body: e?.body || "", files: (e?.attachments || []).map((f) => (typeof f === "string" ? { name: f } : { ...f })) });
const x = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

export default function Revisar({ params = {} }) {
  const store = useStore();
  const { approvals, bots, missions, ready } = store;
  const a = approvals.find((r) => r.id === params.id) || null;
  const bot = bots.find((b) => b.id === a?.botId) || null;
  const mission = missions.find((m) => m.id === a?.missionId) || null;
  const key = "approval:" + params.id;
  const undo = useUndoable(key);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [bccOpen, setBccOpen] = useState(false);
  const [inputs, setInputs] = useState({ to: "", cc: "", cco: "" });
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const onFail = (e) => { if (e.detail?.id === key) { setSent(null); setError(e.detail.message || "No se pudo enviar."); } };
    window.addEventListener("colmena:undo-failed", onFail);
    return () => window.removeEventListener("colmena:undo-failed", onFail);
  }, [key]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !draft) navigate("/"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  if (!ready) return <Shell active="hoy"><div /></Shell>;
  if (!a || (a.status !== "pending" && !sent && !undo.waiting)) {
    return <NotFound title="Esta solicitud ya no está" text="Ya se resolvió o caducó. No se ha perdido nada de lo tuyo." />;
  }
  const isSend = a.kind === "send" && a.email;
  const data = isSend ? fromEmail(a.email) : null;
  const editing = !!draft;
  const d = editing ? draft : data;
  const set = (fn) => setDraft((old) => { const next = JSON.parse(JSON.stringify(old)); fn(next); return next; });
  let changes = 0;
  if (editing) {
    for (const k of ["to", "cc", "cco", "files"]) if (JSON.stringify(draft[k]) !== JSON.stringify(data[k])) changes++;
    if (draft.subject !== data.subject) changes++;
    if (draft.body !== data.body) changes++;
  }
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await store.run(() => patch(`/approvals/${a.id}/email`, { revision: a.revision, to: draft.to, cc: draft.cc, cco: draft.cco, subject: draft.subject, body: draft.body, attachments: draft.files.map((f) => ({ name: f.name, ...(f.size != null ? { size: f.size } : {}) })) }));
      setDraft(null);
      setSaved(true);
      setInputs({ to: "", cc: "", cco: "" });
    } catch (e) {
      setError(e.status === 409 ? "El bot cambió el envío mientras lo editabas. Ciérralo y vuelve a abrirlo para ver la versión nueva." : e.message);
    } finally {
      setBusy(false);
    }
  };
  const approve = () => {
    setSaved(false);
    setError(null);
    const copy = (a.email?.cc || []).length ? ` ${person(a.email.cc[0]).n} recibe una copia.` : "";
    schedule(key, async () => {
      await post(`/approvals/${a.id}`, { decision: "approved", revision: a.revision });
      setSent(isSend ? `Enviado.${copy}` : `Aprobado a las ${time(new Date())}.`);
    });
  };
  const deny = async () => {
    setBusy(true);
    try { await store.run(() => post(`/approvals/${a.id}`, { decision: "denied", revision: a.revision })); navigate("/"); }
    catch (e) { setError(e.message); setBusy(false); }
  };

  const row = { display: "grid", gridTemplateColumns: "72px 1fr", gap: "12px", alignItems: "center", minHeight: "58px", padding: "8px 0", borderBottom: "1px solid rgba(18,19,26,.07)" };
  const chip = (field, e, i) => {
    const c = person(e);
    return (
      <span key={e + i} style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 6px 0 14px", borderRadius: "999px", background: "#F2F2EE", fontSize: "14px" }}>
        <strong style={{ fontWeight: "600" }}>{c.n}</strong>
        <span style={{ color: "#6B6F7A" }}>{c.e}</span>
        {editing ? <button type="button" onClick={() => set((n) => n[field].splice(i, 1))} aria-label={"Quitar a " + c.n} style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#5C606C" }}>{x}</button> : <span style={{ width: "8px" }} />}
      </span>
    );
  };
  const adder = (field, label, placeholder) => editing ? (
    <label style={{ flex: "1 1 200px", display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{label}</span>
      <input type="text" value={inputs[field]} onChange={(e) => setInputs({ ...inputs, [field]: e.target.value })} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter" && isMail(inputs[field])) { e.preventDefault(); set((n) => n[field].push(inputs[field].trim())); setInputs({ ...inputs, [field]: "" }); } }}
        style={{ flex: "1", minWidth: "0", height: "36px", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
      {isMail(inputs[field]) ? <button type="button" onClick={() => { set((n) => n[field].push(inputs[field].trim())); setInputs({ ...inputs, [field]: "" }); }} style={{ height: "32px", padding: "0 12px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>{"Añadir"}</button> : null}
    </label>
  ) : null;
  const pending = needsCount(store);
  const footer = { position: "sticky", bottom: "0", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "18px 26px 18px 40px", background: "rgba(255,255,255,.88)", WebkitBackdropFilter: "blur(16px)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(18,19,26,.07)", borderRadius: "0 0 34px 34px" };
  const pill = (bg, fg) => ({ height: "50px", padding: "0 22px", border: "0", borderRadius: "999px", background: bg, color: fg, cursor: "pointer", fontSize: "15px", fontWeight: "600" });

  return (
    <Shell active="hoy">
      <div style={{ position: "relative", minHeight: "100%", paddingBottom: "40px" }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" }}>
          <div style={{ maxWidth: "1060px", margin: "0 auto", padding: "76px 48px", filter: "blur(7px)", opacity: ".45" }}>
            <span style={{ fontSize: "15px", color: "#6B6F7A" }}>{new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</span>
            <p style={{ margin: "14px 0 0", font: "600 76px/0.98 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>
              {greeting()}<br /><span style={{ color: "#9A9DA6" }}>{pending === 1 ? "Una cosa te espera." : `${pending} cosas te esperan.`}</span>
            </p>
            <div style={{ marginTop: "60px", height: "92px", borderRadius: "30px", background: "#FFFFFF" }} />
          </div>
        </div>
        <section role="dialog" aria-modal="true" aria-labelledby="rev-t" style={{ position: "relative", zIndex: "2", maxWidth: "880px", margin: "44px auto 0", background: "#FFFFFF", borderRadius: "34px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.5), 0 2px 6px rgba(18,19,26,.06)", animation: "sheet .5s cubic-bezier(.2,.8,.2,1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "22px 26px 0" }}>
            <BotPresence bot={bot} size={28} state="rest" />
            <span style={{ flex: "1", fontSize: "14px", color: "#5C606C" }}>
              <strong style={{ color: "#12131A", fontWeight: "600" }}>{bot?.name || "Un bot"}</strong>
              {" lo preparó" + (mission && !mission.conversation ? ` en #${mission.room || mission.title}` : "") + " · " + time(a.createdAt)}
            </span>
            <a href="/" aria-label="Cerrar" style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", borderRadius: "50%", background: "rgba(18,19,26,.06)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </a>
          </div>
          <div style={{ padding: "18px 40px 6px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <h1 id="rev-t" style={{ margin: "0", font: "600 34px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.035em" }}>{editing ? "Editar envío" : isSend && data.subject ? `Enviar «${data.subject}»` : a.title}</h1>
            {saved && !editing && !undo.waiting && !sent ? (
              <span role="status" style={{ display: "flex", alignItems: "center", gap: "8px", height: "36px", padding: "0 14px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "13px", fontWeight: "500", animation: "rise .35s ease-out" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFC93C" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                {"Cambios guardados. Aún no se ha enviado."}
              </span>
            ) : null}
          </div>

          {isSend ? (
            <div style={{ padding: "10px 40px 0" }}>
              <div style={row}>
                <span style={{ fontSize: "14px", color: "#6B6F7A" }}>{"Para"}</span>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                  {d.to.map((e, i) => chip("to", e, i))}
                  {adder("to", "Añadir destinatario", "Añadir persona o correo")}
                  {editing && !bccOpen && !d.cco.length ? <span style={{ marginLeft: "auto", display: "flex", gap: "4px" }}><button type="button" onClick={() => setBccOpen(true)} style={{ height: "32px", padding: "0 10px", border: "0", borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>{"Añadir CCO"}</button></span> : null}
                </div>
              </div>
              {d.cc.length || editing ? (
                <div style={{ ...row, animation: "fade .3s ease-out" }}>
                  <span style={{ fontSize: "14px", color: "#6B6F7A" }}>{"CC"}</span>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>{d.cc.map((e, i) => chip("cc", e, i))}{adder("cc", "Añadir en copia", "Añadir en copia")}</div>
                </div>
              ) : null}
              {d.cco.length || (editing && bccOpen) ? (
                <div style={{ ...row, animation: "fade .3s ease-out" }}>
                  <span style={{ fontSize: "14px", color: "#6B6F7A" }}>{"CCO"}</span>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>{d.cco.map((e, i) => chip("cco", e, i))}{adder("cco", "Añadir en copia oculta", "Añadir en copia oculta")}</div>
                </div>
              ) : null}
              <div style={{ ...row, minHeight: "62px" }}>
                <label htmlFor="rev-subj" style={{ fontSize: "14px", color: "#6B6F7A" }}>{"Asunto"}</label>
                {editing
                  ? <input id="rev-subj" type="text" value={d.subject} onChange={(e) => set((n) => { n.subject = e.target.value; })} style={{ width: "100%", height: "44px", padding: "0 14px", marginLeft: "-14px", border: "0", borderRadius: "12px", outline: "none", background: "#F6F6F3", fontSize: "17px", fontWeight: "600" }} />
                  : <strong id="rev-subj" style={{ fontSize: "17px", fontWeight: "600" }}>{d.subject}</strong>}
              </div>
              <div style={{ padding: "22px 0 8px" }}>
                {editing ? (
                  <label style={{ display: "block" }}>
                    <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Cuerpo del mensaje"}</span>
                    <textarea rows="13" value={d.body} onChange={(e) => set((n) => { n.body = e.target.value; })} style={{ width: "100%", padding: "16px 18px", marginLeft: "-18px", marginRight: "-18px", border: "0", borderRadius: "18px", outline: "none", background: "#F6F6F3", fontSize: "17px", lineHeight: "1.65", resize: "vertical", color: "#1E2029", boxSizing: "content-box" }} />
                  </label>
                ) : <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.65", whiteSpace: "pre-wrap", color: "#1E2029" }}>{d.body}</p>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", padding: "12px 0 28px" }}>
                {d.files.map((f, i) => {
                  const e = extOf(f.name);
                  const [bg, fg] = EXT[e] || ["#EEF0F4", "#4A4F5C"];
                  return (
                    <span key={f.name + i} style={{ display: "flex", alignItems: "center", gap: "12px", height: "64px", padding: "0 10px", borderRadius: "18px", background: "#F6F6F3", animation: "fade .3s ease-out" }}>
                      <span aria-hidden="true" style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", borderRadius: "12px", font: "600 10px/1 'Geist Mono', monospace", background: bg, color: fg }}>{e}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: "3px", paddingRight: "8px" }}>
                        <strong style={{ fontSize: "14px", fontWeight: "600" }}>{f.name}</strong>
                        {f.size != null ? <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{sizeOf(f.size)}</span> : null}
                      </span>
                      {editing ? <button type="button" onClick={() => set((n) => n.files.splice(i, 1))} aria-label={"Quitar " + f.name} style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "#FFFFFF", cursor: "pointer" }}>{x}</button> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ padding: "10px 40px 28px", display: "flex", flexDirection: "column", gap: "14px" }}>
              {a.summary ? <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.65", color: "#1E2029", whiteSpace: "pre-wrap" }}>{a.summary}</p> : null}
              {a.context ? <p style={{ margin: "0", fontSize: "14px", color: "#6B6F7A" }}>{a.context}</p> : null}
              {a.kind === "plan" && mission ? <a href={`/sala/${mission.id}#plan`} style={{ alignSelf: "flex-start", fontSize: "15px", fontWeight: "600", color: "#1F4FD1" }}>{"Ver el plan en la sala"}</a> : null}
            </div>
          )}

          <div style={footer}>
            {error ? <span role="alert" style={{ flexBasis: "100%", fontSize: "14px", color: "#B4372A" }}>{error}</span> : null}
            {sent ? (
              <>
                <span role="status" style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: "500", color: "#0B6B4A" }}>
                  <span aria-hidden="true" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#0B8A5F", animation: "pop .4s ease-out" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                  </span>
                  {sent}
                </span>
                <a href="/" style={{ display: "flex", alignItems: "center", height: "50px", padding: "0 26px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "15px", fontWeight: "600" }}>{"Volver a Hoy"}</a>
              </>
            ) : undo.waiting ? (
              <>
                <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span role="status" style={{ fontSize: "15px", fontWeight: "500" }}>{(isSend ? "Se envía en " : "Se aprueba en ") + undo.secs + " s"}</span>
                  <span style={{ height: "4px", borderRadius: "2px", background: "rgba(18,19,26,.08)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", background: "#12131A", transition: "width .25s linear", width: Math.round(undo.fraction * 100) + "%" }} />
                  </span>
                </span>
                <button type="button" onClick={() => cancel(key)} style={{ ...pill("#12131A", "#FFFFFF"), padding: "0 26px" }}>{"Deshacer"}</button>
              </>
            ) : editing ? (
              <>
                <span role="status" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#5C606C" }}>
                  <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: changes ? "#FFC93C" : "#C9CBD1" }} />
                  {changes === 0 ? "Sin cambios" : changes === 1 ? "1 cambio sin guardar" : `${changes} cambios sin guardar`}
                </span>
                <span style={{ display: "flex", gap: "10px" }}>
                  <button type="button" onClick={() => { setDraft(null); setInputs({ to: "", cc: "", cco: "" }); }} style={pill("transparent", "#12131A")}>{"Cancelar"}</button>
                  <button type="button" disabled={busy || !changes || !draft.to.length} onClick={save} style={{ ...pill("#12131A", "#FFFFFF"), padding: "0 26px", opacity: changes && draft.to.length ? 1 : 0.5 }}>{busy ? "Guardando…" : "Guardar cambios"}</button>
                </span>
              </>
            ) : (
              <>
                <span style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: "13px", color: a.impact?.tone === "external" || a.impact?.tone === "money" || a.impact?.tone === "delete" ? "#8A5A00" : "#5C606C" }}>
                  {a.impact?.headline ? <span>{a.impact.headline}</span> : null}
                  {a.reviewNote ? <span>{a.reviewNote}</span> : null}
                </span>
                <span style={{ display: "flex", gap: "10px" }}>
                  {isSend ? <button type="button" onClick={() => { setDraft(JSON.parse(JSON.stringify(data))); setSaved(false); }} style={pill("rgba(18,19,26,.06)", "#12131A")}>{"Editar"}</button>
                    : <button type="button" disabled={busy} onClick={deny} style={pill("rgba(18,19,26,.06)", "#12131A")}>{"Denegar"}</button>}
                  {a.kind === "plan" || a.kind === "secret" || a.kind === "question" ? null : (
                    <button type="button" onClick={approve} style={{ ...pill("#FFC93C", "#12131A"), padding: "0 26px", boxShadow: "0 10px 24px -10px rgba(201,138,0,.8)" }}>{isSend ? "Aprobar y enviar" : "Aprobar"}</button>
                  )}
                </span>
              </>
            )}
          </div>
        </section>
      </div>
    </Shell>
  );
}

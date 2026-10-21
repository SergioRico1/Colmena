import { useEffect, useRef, useState } from "react";
import { css } from "../design/css/EditarEnvio.js";
import Sidebar from "../components/Sidebar.jsx";
import { Avatar } from "../components/home/shared.jsx";
import { useStore } from "../lib/store.jsx";
import { patch, pickTextFiles, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { botById } from "../lib/bots.js";
import ApprovalConflict from "../components/room/ApprovalConflict.jsx";

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
const ERROR = { fontSize: "13px", color: "#B4372A", fontWeight: "600" };
const FIELDS = { to: "newTo", cc: "newCc", cco: "newCco" };

function fileInfo(f) {
  const name = typeof f === "string" ? f : f?.name || "archivo";
  const ext = (name.split(".").pop() || "").toLowerCase();
  const image = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  const kind = ext === "pdf" ? "PDF" : image ? "IMG" : (ext || "DOC").slice(0, 4).toUpperCase();
  const size = typeof f === "object" && f?.size ? (f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`) : null;
  const label = ext === "pdf" ? "PDF" : image ? "Imagen" : "Archivo";
  const colors = kind === "PDF" ? { bg: "#FDE7E7", fg: "#A3201B" } : kind === "IMG" ? { bg: "#FFE6F1", fg: "#8A1550" } : { bg: "#EEF0F4", fg: "#4A4F5C" };
  return { name, kind, meta: f?.meta || [label, size].filter(Boolean).join(" · "), ...colors };
}

function fromEmail(e) {
  return {
    to: [...(e?.to || [])],
    cc: [...(e?.cc || [])],
    cco: [...(e?.cco || [])],
    subject: e?.subject || "",
    body: e?.body || "",
    files: (e?.attachments || []).map((f) => (typeof f === "string" ? { name: f } : { ...f })),
  };
}

export default function EditarEnvio({ params = {}, query = {} }) {
  const { approvals, bots, settings, ready, run } = useStore();
  const approval = approvals.find((a) => a.id === params.id) || null;
  const bot = botById(bots, approval?.botId);
  const name = bot?.name || "El bot";
  const fromConfirm = query.ver === "confirmar";

  const [view, setView] = useState(fromConfirm ? "confirmar" : "editar");
  const [draft, setDraft] = useState(null);
  const [showCc, setShowCc] = useState(true);
  const [showCco, setShowCco] = useState(false);
  const [inputs, setInputs] = useState({ newTo: "", newCc: "", newCco: "" });
  const [invalid, setInvalid] = useState({}); // field -> mensaje
  const [toast, setToast] = useState(false);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(false); // 409: the content changed since you opened it, or it expired
  const [askNote, setAskNote] = useState(null);
  const body = useRef(null);

  const saved = approval?.email ? fromEmail(approval.email) : null;
  useEffect(() => {
    if (saved && !draft) {
      setDraft(saved);
      setShowCco(saved.cco.length > 0);
    }
  }, [saved, draft]);

  const missing = ready && (!approval || approval.kind !== "send" || !approval.email);
  if (!draft || missing) {
    return (
      <>
        <style>{css}</style>
        <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
          <Sidebar variant="compact" active="bandeja" />
          <main style={{ flex: "999 1 560px", minWidth: "0", padding: "24px clamp(16px, 3vw, 40px) 56px", display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ width: "100%", maxWidth: "880px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "10px" }}>
              <p style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#4A4F5C" }}>
                <a href="/bandeja" style={{ fontWeight: "600", color: "#1F4FD1" }}>Bandeja</a>
                <span aria-hidden="true">/</span>
                <span>Envío</span>
              </p>
              <h1 style={{ margin: "0", font: "800 34px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{missing ? "Este envío ya no está aquí" : "Editar envío"}</h1>
            </div>
            {missing ? (
              <section style={{ width: "100%", maxWidth: "880px", margin: "0 auto", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "20px", padding: "20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <span style={{ fontSize: "15px", lineHeight: "1.5", color: "#4A4F5C" }}>Puede que ya lo hayas aprobado o rechazado, o que el bot lo haya retirado. Nada se ha enviado desde aquí.</span>
                <a href="/bandeja" style={{ display: "flex", alignItems: "center", height: "48px", padding: "0 22px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", fontWeight: "700", fontSize: "15px" }}>Volver a la Bandeja</a>
              </section>
            ) : null}
          </main>
        </div>
      </>
    );
  }

  const d = draft;
  const patchDraft = (p) => setDraft((cur) => ({ ...cur, ...p }));
  const fail = async (e, fallback) => {
    setError(e.message || fallback);
    setConflict(e.status === 409);
    if (e.status === 409) await run(async () => null).catch(() => {});
  };
  const expired = approval.status === "expired";
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const isEdit = view === "editar";
  const noTo = d.to.length === 0 && !EMAIL.test(inputs.newTo.trim());

  const addAddress = (field) => {
    const key = FIELDS[field];
    const v = (inputs[key] || "").trim().replace(/[,;]$/, "");
    if (!v) return true;
    if (!EMAIL.test(v)) {
      setInvalid((x) => ({ ...x, [field]: `«${v}» no parece una dirección de correo.` }));
      return false;
    }
    setInvalid((x) => ({ ...x, [field]: null }));
    setDraft((cur) => (cur[field].includes(v) ? cur : { ...cur, [field]: [...cur[field], v] }));
    setInputs((x) => ({ ...x, [key]: "" }));
    return true;
  };
  const adder = (field) => ({
    value: inputs[FIELDS[field]],
    change: (e) => {
      setInputs((x) => ({ ...x, [FIELDS[field]]: e.target.value }));
      if (invalid[field]) setInvalid((x) => ({ ...x, [field]: null }));
    },
    key: (e) => {
      if (e.key === "Enter" || e.key === "," || e.key === ";") {
        e.preventDefault();
        addAddress(field);
      } else if (e.key === "Backspace" && !e.target.value && d[field].length) {
        patchDraft({ [field]: d[field].slice(0, -1) });
      }
    },
    blur: () => addAddress(field),
  });
  const chips = (field) => d[field].map((addr) => ({
    addr,
    bad: !EMAIL.test(addr),
    aria: "Quitar " + addr,
    remove: () => patchDraft({ [field]: d[field].filter((x) => x !== addr) }),
  }));

  const files = d.files.map((f) => ({ ...fileInfo(f), aria: "Quitar " + fileInfo(f).name, remove: () => patchDraft({ files: d.files.filter((x) => x !== f) }) }));
  const savedFiles = saved.files.map(fileInfo);
  const fileCount = d.files.length === 1 ? "1 archivo" : d.files.length + " archivos";
  const footNote = (!conflict && error) || (dirty ? "Al cancelar se descartan los cambios. Nada se envía desde aquí." : "Nada se envía desde aquí: volverás a la confirmación.");

  const reopen = () => {
    setDraft(fromEmail(approval.email));
    setView("editar");
    setToast(false);
    setError(null);
  };
  const cancel = () => {
    if (!fromConfirm) return navigate("/bandeja");
    setDraft(fromEmail(approval.email));
    setInputs({ newTo: "", newCc: "", newCco: "" });
    setInvalid({});
    setView("confirmar");
    setToast(false);
  };
  const save = async () => {
    // Pending text in the inputs counts if it is a valid address.
    let next = d;
    for (const field of ["to", "cc", "cco"]) {
      const v = (inputs[FIELDS[field]] || "").trim().replace(/[,;]$/, "");
      if (!v) continue;
      if (!EMAIL.test(v)) {
        setInvalid((x) => ({ ...x, [field]: `«${v}» no parece una dirección de correo.` }));
        return;
      }
      if (!next[field].includes(v)) next = { ...next, [field]: [...next[field], v] };
    }
    if (next.to.length === 0) return;
    const bad = [...next.to, ...next.cc, ...next.cco].find((x) => !EMAIL.test(x));
    if (bad) {
      setError(`Revisa «${bad}»: no parece una dirección de correo.`);
      return;
    }
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await run(() => patch(`/approvals/${approval.id}/email`, {
        revision: approval.revision,
        to: next.to,
        cc: next.cc,
        cco: next.cco,
        subject: next.subject,
        body: next.body,
        attachments: next.files,
      }));
      setDraft(next);
      setInputs({ newTo: "", newCc: "", newCco: "" });
      if (!fromConfirm) return navigate("/bandeja");
      setEdited(true);
      setView("confirmar");
      setToast(true);
    } catch (e) {
      await fail(e, "No se pudieron guardar los cambios.");
    } finally {
      setBusy(false);
    }
  };
  const decide = async (decision) => {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      // Bound to exactly what is on screen: if the bot changed it meanwhile, the server answers 409.
      await run(() => post(`/approvals/${approval.id}`, { decision, revision: approval.revision }));
      navigate("/bandeja");
    } catch (e) {
      await fail(e, "No se pudo completar.");
    } finally {
      setBusy(false);
    }
  };

  const renew = async () => {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await run(() => post(`/approvals/${approval.id}/renew`, { revision: approval.revision }));
      navigate("/bandeja");
    } catch (e) {
      await fail(e, `No se pudo avisar a ${name}.`);
    } finally {
      setBusy(false);
    }
  };

  const ask = async (instruction) => {
    setAskNote(null);
    if (!approval.missionId) {
      setAskNote({ error: true, text: `Este envío no viene de una sala, así que ${name} no puede reescribirlo desde aquí. Puedes editar el texto tú mismo.` });
      return;
    }
    try {
      await run(() => post(`/missions/${approval.missionId}/messages`, {
        text: `Sobre el correo «${d.subject}» pendiente de enviar: ${instruction}. Mantén los destinatarios y vuelve a dejarlo en la Bandeja para que lo apruebe.\n\nBorrador actual:\n${d.body}`,
      }));
      setAskNote({ error: false, text: `Se lo he pedido a ${name} en la sala. Cuando lo tenga, el envío volverá a la Bandeja.` });
    } catch (e) {
      setAskNote({ error: true, text: e.message || `No se pudo avisar a ${name}.` });
    }
  };

  const format = (kind) => {
    const el = body.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const sel = value.slice(s, e);
    let insert;
    if (kind === "b") insert = `**${sel || "texto"}**`;
    else if (kind === "i") insert = `_${sel || "texto"}_`;
    else if (kind === "list") insert = (sel || "elemento").split("\n").map((l) => (l.startsWith("– ") ? l : "– " + l)).join("\n");
    else insert = `[${sel || "texto"}](https://)`;
    const next = value.slice(0, s) + insert + value.slice(e);
    patchDraft({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s, s + insert.length);
    });
  };

  const addFiles = async () => {
    try {
      const picked = await pickTextFiles();
      patchDraft({ files: [...d.files.filter((f) => !picked.some((p) => p.name === f.name)), ...picked] });
    } catch (e) {
      setError(e.message);
    }
  };

  const contextTail = (approval.context || "").split(" · ").slice(1).filter((x) => !/^hace |^ahora$/.test(x)).join(" · ");
  const userName = settings.userName || "Tu cuenta";
  const v = { to: adder("to"), cc: adder("cc"), cco: adder("cco") };

  const chip = (c) => (
    <span key={c.addr} style={{ display: "flex", alignItems: "center", gap: "4px", height: "34px", padding: "0 4px 0 12px", background: c.bad ? "#FDE7E7" : "#EEF0F4", borderRadius: "17px", fontSize: "14px" }} title={c.bad ? "No parece una dirección de correo" : undefined}>
      {c.addr}
      <button type="button" aria-label={c.aria} onClick={c.remove} style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "50%", cursor: "pointer" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </span>
  );

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" active="bandeja" />
        <main style={{ flex: "999 1 560px", minWidth: "0", padding: "24px clamp(16px, 3vw, 40px) 56px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ width: "100%", maxWidth: "880px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "10px" }}>
            <p style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#4A4F5C" }}>
              <a href="/bandeja" style={{ fontWeight: "600", color: "#1F4FD1" }}>Bandeja</a>
              <span aria-hidden="true">/</span>
              <span>{`Envío de ${name}`}</span>
              {isEdit ? (
                <>
                  <span aria-hidden="true">/</span>
                  <span style={{ color: "#12131A", fontWeight: "600" }}>Editar</span>
                </>
              ) : null}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <h1 style={{ margin: "0", font: "800 34px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{isEdit ? "Editar envío" : approval.title || "Enviar el correo"}</h1>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "15px", fontSize: "13px", fontWeight: "600" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /></svg>
                  {{ pending: "Sin enviar", expired: "Caducado · sin enviar", denied: "Rechazado", approved: "Enviado", done: "Enviado" }[approval.status] || "Sin enviar"}
                </span>
                {edited || approval.edited ? (
                  <span style={{ display: "flex", alignItems: "center", height: "30px", padding: "0 12px", background: "#EEE8FF", borderRadius: "15px", fontSize: "13px", fontWeight: "600", color: "#3E1FA3" }}>Editado por ti</span>
                ) : null}
                {isEdit && dirty ? (
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 12px", background: "#FFF4D1", border: "1px solid #F2D27A", borderRadius: "15px", fontSize: "13px", fontWeight: "600" }}>
                    <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#C98A00" }} />
                    Cambios sin guardar
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {isEdit ? (
            <form aria-label="Editar envío" onSubmit={(e) => { e.preventDefault(); save(); }} style={{ width: "100%", maxWidth: "880px", margin: "0 auto", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "20px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 20px", background: "#F7F8FA", borderBottom: "1px solid #E6E8EE", fontSize: "14px" }}>
                <Avatar bot={bot} size={28} style={{ font: "800 12px/1 'Bricolage Grotesque', sans-serif" }} />
                <span style={{ flex: "1", lineHeight: "1.4" }}>
                  <strong>De:</strong>{` ${userName} `}
                  <span style={{ color: "#4A4F5C" }}>{`· lo envía ${name} en tu nombre`}</span>
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", alignItems: "start", gap: "12px", padding: "12px 20px", borderBottom: "1px solid #E6E8EE" }}>
                <label htmlFor="campo-para" style={{ paddingTop: "11px", fontSize: "14px", fontWeight: "600" }}>Para</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", minHeight: "44px" }}>
                    {chips("to").map(chip)}
                    <input id="campo-para" type="email" value={v.to.value} onChange={v.to.change} onKeyDown={v.to.key} onBlur={v.to.blur} placeholder="Añadir y pulsar Intro" aria-invalid={invalid.to ? "true" : undefined} style={{ flex: "1 1 180px", minWidth: "0", height: "40px", border: "0", outline: "none", background: "transparent", fontSize: "15px" }} />
                    <span style={{ display: "flex", gap: "4px" }}>
                      {!showCc ? <button type="button" onClick={() => setShowCc(true)} style={{ height: "34px", padding: "0 10px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>CC</button> : null}
                      {!showCco ? <button type="button" onClick={() => setShowCco(true)} style={{ height: "34px", padding: "0 10px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>CCO</button> : null}
                    </span>
                  </div>
                  {invalid.to ? <span role="alert" style={ERROR}>{invalid.to}</span> : null}
                  {noTo ? <span role="alert" style={ERROR}>Añade al menos un destinatario para poder guardar.</span> : null}
                </div>
              </div>
              {showCc ? (
                <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", alignItems: "start", gap: "12px", padding: "12px 20px", borderBottom: "1px solid #E6E8EE" }}>
                  <label htmlFor="campo-cc" style={{ paddingTop: "11px", fontSize: "14px", fontWeight: "600" }}>CC</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", minHeight: "44px" }}>
                      {chips("cc").map(chip)}
                      <input id="campo-cc" type="email" value={v.cc.value} onChange={v.cc.change} onKeyDown={v.cc.key} onBlur={v.cc.blur} placeholder="En copia: lo verán todos" aria-invalid={invalid.cc ? "true" : undefined} style={{ flex: "1 1 180px", minWidth: "0", height: "40px", border: "0", outline: "none", background: "transparent", fontSize: "15px" }} />
                    </div>
                    {invalid.cc ? <span role="alert" style={ERROR}>{invalid.cc}</span> : null}
                  </div>
                </div>
              ) : null}
              {showCco ? (
                <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", alignItems: "start", gap: "12px", padding: "12px 20px", borderBottom: "1px solid #E6E8EE" }}>
                  <label htmlFor="campo-cco" style={{ paddingTop: "11px", fontSize: "14px", fontWeight: "600" }}>CCO</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", minHeight: "44px" }}>
                      {chips("cco").map(chip)}
                      <input id="campo-cco" type="email" value={v.cco.value} onChange={v.cco.change} onKeyDown={v.cco.key} onBlur={v.cco.blur} placeholder="Copia oculta: nadie más lo verá" aria-invalid={invalid.cco ? "true" : undefined} style={{ flex: "1 1 180px", minWidth: "0", height: "40px", border: "0", outline: "none", background: "transparent", fontSize: "15px" }} />
                    </div>
                    {invalid.cco ? <span role="alert" style={ERROR}>{invalid.cco}</span> : null}
                  </div>
                </div>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", alignItems: "center", gap: "12px", padding: "12px 20px", borderBottom: "1px solid #E6E8EE" }}>
                <label htmlFor="campo-asunto" style={{ fontSize: "14px", fontWeight: "600" }}>Asunto</label>
                <input id="campo-asunto" type="text" value={d.subject} onChange={(e) => patchDraft({ subject: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} style={{ width: "100%", height: "44px", padding: "0 12px", border: "1px solid #C9CED8", borderRadius: "10px", fontSize: "16px", fontWeight: "600", background: "#FFFFFF" }} />
              </div>
              <div style={{ padding: "14px 20px 18px", display: "flex", flexDirection: "column", gap: "10px", borderBottom: "1px solid #E6E8EE" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                  <label htmlFor="campo-cuerpo" style={{ fontSize: "14px", fontWeight: "600" }}>Mensaje</label>
                  <div role="toolbar" aria-label="Formato" style={{ display: "flex", gap: "2px", padding: "3px", background: "#F4F5F8", borderRadius: "10px" }}>
                    <button type="button" aria-label="Negrita" onClick={() => format("b")} style={{ width: "36px", height: "34px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "7px", cursor: "pointer", fontWeight: "800" }}>B</button>
                    <button type="button" aria-label="Cursiva" onClick={() => format("i")} style={{ width: "36px", height: "34px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "7px", cursor: "pointer", fontStyle: "italic", fontFamily: "Georgia, serif" }}>I</button>
                    <button type="button" aria-label="Lista" onClick={() => format("list")} style={{ width: "36px", height: "34px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "7px", cursor: "pointer" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>
                    </button>
                    <button type="button" aria-label="Enlace" onClick={() => format("link")} style={{ width: "36px", height: "34px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "7px", cursor: "pointer" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
                    </button>
                  </div>
                </div>
                <textarea ref={body} id="campo-cuerpo" rows="12" value={d.body} onChange={(e) => patchDraft({ body: e.target.value })} style={{ width: "100%", padding: "14px 16px", border: "1px solid #C9CED8", borderRadius: "12px", fontSize: "16px", lineHeight: "1.6", resize: "vertical", background: "#FFFFFF" }} />
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#4A4F5C" }}>
                    <Avatar bot={bot} size={20} />
                    {`Pedir a ${name}:`}
                  </span>
                  {[["Más corto", "hazlo más corto"], ["Más formal", "hazlo más formal"], ["Revisar ortografía", "revisa la ortografía sin cambiar el contenido"]].map(([label, instruction]) => (
                    <button key={label} type="button" onClick={() => ask(instruction)} style={{ height: "32px", padding: "0 10px", background: "transparent", border: "1px dashed #A9AEBB", borderRadius: "16px", cursor: "pointer", fontSize: "13px" }}>{label}</button>
                  ))}
                </div>
                {askNote ? <span role="status" style={askNote.error ? ERROR : { fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}>{askNote.text}</span> : null}
              </div>
              <div style={{ padding: "14px 20px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>
                  {"Adjuntos "}
                  <span style={{ fontWeight: "500", color: "#4A4F5C" }}>{"· "}{fileCount}</span>
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {files.map((f) => (
                    <span key={f.name} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "52px", padding: "6px 6px 6px 8px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px" }}>
                      <span aria-hidden="true" style={{ width: "36px", height: "40px", borderRadius: "6px", display: "grid", placeItems: "center", font: "700 9px/1 'Geist Mono', monospace", background: f.bg, color: f.fg }}>{f.kind}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <strong style={{ fontSize: "14px" }}>{f.name}</strong>
                        <span style={{ fontSize: "12px", color: "#4A4F5C" }}>{f.meta}</span>
                      </span>
                      <button type="button" aria-label={f.aria} onClick={f.remove} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "#4A4F5C" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={addFiles}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const dropped = [...(e.dataTransfer?.files || [])];
                      try {
                        if (dropped.length + d.files.length > 5) throw Error("Máximo cinco archivos.");
                        const read = [];
                        for (const file of dropped) {
                          if (file.size > 200000) throw Error(`«${file.name}» supera 200 KB.`);
                          read.push({ name: file.name, size: file.size, content: await file.text() });
                        }
                        patchDraft({ files: [...d.files.filter((f) => !read.some((r) => r.name === f.name)), ...read] });
                      } catch (err) {
                        setError(err.message);
                      }
                    }}
                    style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "52px", padding: "0 16px", background: "#F7F8FA", border: "1.5px dashed #A9AEBB", borderRadius: "12px", cursor: "pointer", fontSize: "14px" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7L10.4 16.5a1.7 1.7 0 0 1-2.4-2.4L15 7" /></svg>
                    Añadir archivo o arrastrarlo aquí
                  </button>
                </div>
              </div>
              <div style={{ position: "sticky", bottom: "0", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "14px 20px", background: "#FFFFFF", borderTop: "1px solid #E6E8EE" }}>
                {conflict ? <ApprovalConflict error={error} conflict style={{ flexBasis: "100%" }} /> : null}
                <span role={error && !conflict ? "alert" : undefined} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: error && !conflict ? "#B4372A" : "#4A4F5C", fontWeight: error && !conflict ? "600" : undefined }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /></svg>
                  {fromConfirm || (error && !conflict) ? footNote : dirty ? "Al cancelar se descartan los cambios. Nada se envía desde aquí." : "Nada se envía desde aquí: volverás a la Bandeja."}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" onClick={cancel} style={{ height: "48px", padding: "0 18px", background: "#FFFFFF", border: "1px solid #C9CED8", borderRadius: "12px", cursor: "pointer", fontSize: "15px" }}>Cancelar</button>
                  <button type="submit" disabled={noTo || busy} style={{ height: "48px", padding: "0 22px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", cursor: busy ? "progress" : "pointer", fontWeight: "700", fontSize: "15px", opacity: noTo || busy ? "0.45" : "1" }}>Guardar cambios</button>
                </div>
              </div>
            </form>
          ) : (
            <div style={{ width: "100%", maxWidth: "880px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
              {toast ? (
                <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "14px 18px", background: "#E1F4EC", border: "1.5px solid #0B8A5F", borderRadius: "14px", fontSize: "15px", animation: "toastin .25s ease-out" }}>
                  <span aria-hidden="true" style={{ width: "26px", height: "26px", flex: "none", borderRadius: "50%", background: "#0B8A5F", color: "#FFFFFF", display: "grid", placeItems: "center" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                  </span>
                  <span style={{ flex: "1 1 280px" }}>
                    <strong>Cambios guardados.</strong>
                    {" Todavía no se ha enviado nada: revisa y aprueba cuando quieras."}
                  </span>
                  <button type="button" onClick={reopen} style={{ height: "38px", padding: "0 12px", background: "transparent", border: "1px solid #0B8A5F", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Seguir editando</button>
                </div>
              ) : null}
              {conflict ? <ApprovalConflict error={error} conflict /> : null}
              {expired && !conflict ? <ApprovalConflict error="Han pasado más de 30 minutos desde que se preparó: este envío ha caducado." conflict /> : null}
              <section aria-label="Vista previa del envío" style={{ background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "20px", boxShadow: "8px 8px 0 #FFC93C", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 20px", background: "#F7F8FA", borderBottom: "1px solid #E6E8EE" }}>
                  <Avatar bot={bot} size={32} />
                  <span style={{ flex: "1", fontSize: "14px", lineHeight: "1.4" }}>
                    <strong>{name}</strong>
                    {" quiere enviar este correo en tu nombre "}
                    {contextTail ? <span style={{ color: "#4A4F5C" }}>{`· ${contextTail}`}</span> : null}
                  </span>
                  <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>Lo que se enviará</span>
                </div>
                <div style={{ padding: "6px 20px", display: "flex", flexDirection: "column", fontSize: "15px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: "12px", padding: "10px 0", borderBottom: "1px solid #E6E8EE" }}>
                    <span style={{ color: "#4A4F5C" }}>Para</span>
                    <span>{saved.to.join(", ")}</span>
                  </div>
                  {saved.cc.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: "12px", padding: "10px 0", borderBottom: "1px solid #E6E8EE" }}>
                      <span style={{ color: "#4A4F5C" }}>CC</span>
                      <span>{saved.cc.join(", ")}</span>
                    </div>
                  ) : null}
                  {saved.cco.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: "12px", padding: "10px 0", borderBottom: "1px solid #E6E8EE" }}>
                      <span style={{ color: "#4A4F5C" }}>CCO</span>
                      <span>{saved.cco.join(", ")}</span>
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: "12px", padding: "10px 0", borderBottom: "1px solid #E6E8EE" }}>
                    <span style={{ color: "#4A4F5C" }}>Asunto</span>
                    <strong>{saved.subject}</strong>
                  </div>
                </div>
                <div style={{ padding: "18px 20px 20px", fontSize: "16px", lineHeight: "1.65", whiteSpace: "pre-line" }}>{saved.body}</div>
                {savedFiles.length ? (
                  <div style={{ padding: "0 20px 20px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {savedFiles.map((f) => (
                      <span key={f.name} style={{ display: "flex", alignItems: "center", gap: "10px", height: "48px", padding: "0 14px 0 8px", border: "1px solid #DCE0E8", borderRadius: "12px" }}>
                        <span aria-hidden="true" style={{ width: "32px", height: "36px", borderRadius: "6px", display: "grid", placeItems: "center", font: "700 9px/1 'Geist Mono', monospace", background: f.bg, color: f.fg }}>{f.kind}</span>
                        <span style={{ fontSize: "14px", fontWeight: "600" }}>{f.name}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "16px 20px", background: "#F7F8FA", borderTop: "1px solid #E6E8EE" }}>
                  <span role={error && !conflict ? "alert" : undefined} style={error && !conflict ? { fontSize: "13px", color: "#B4372A", fontWeight: "600", maxWidth: "340px", lineHeight: "1.45" } : { fontSize: "13px", color: "#4A4F5C", maxWidth: "340px", lineHeight: "1.45" }}>
                    {(!conflict && error) || (expired ? `Pide a ${name} que lo vuelva a preparar con los datos de ahora.` : `${name} tendrá en cuenta tus cambios la próxima vez que prepare un envío parecido.`)}
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    <button type="button" disabled={busy} onClick={() => decide("denied")} style={{ height: "48px", padding: "0 14px", background: "transparent", border: "0", borderRadius: "12px", cursor: "pointer", fontSize: "15px", color: "#4A4F5C" }}>{expired ? "Descartar" : "Rechazar"}</button>
                    {expired ? null : <button type="button" onClick={reopen} style={{ height: "48px", padding: "0 18px", background: "#FFFFFF", border: "1px solid #12131A", borderRadius: "12px", cursor: "pointer", fontWeight: "600", fontSize: "15px" }}>Editar</button>}
                    {expired ? (
                      <button type="button" disabled={busy} onClick={renew} style={{ display: "flex", alignItems: "center", height: "48px", padding: "0 22px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", cursor: busy ? "progress" : "pointer", fontWeight: "700", fontSize: "15px", opacity: busy ? "0.6" : "1" }}>Volver a preparar</button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => decide("approved")} style={{ display: "flex", alignItems: "center", height: "48px", padding: "0 22px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", cursor: busy ? "progress" : "pointer", fontWeight: "700", fontSize: "15px", opacity: busy ? "0.6" : "1" }}>Aprobar y enviar</button>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

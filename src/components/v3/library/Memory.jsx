import { useState } from "react";
import { shapeOf } from "../../v2/Presence.jsx";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { del, patch, post } from "../../../lib/api.js";
import { later } from "../../../lib/undoToast.js";
import DocHistory from "../../v2/team/DocHistory.jsx";

// Biblioteca › Memoria (design/V3Memoria.dc.html): what your bots know about you. A box to tell
// them something; what they deduced from mail, webs or apps waits in «Por revisar» and is not
// used until you say it is right; the rest grouped by who knows it, each one editable or
// forgettable (10 s «Deshacer»). Your summarised profile (USER.md) keeps every version.

const UNDO_MS = 10000;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "");
/** «Lo dijiste tú · 2 oct», «Lo dedujo Vera · confirmado»… from what the server knows. */
function sourceOf(m, bot) {
  const d = day(m.createdAt);
  const tail = (s) => [s, d].filter(Boolean).join(" · ");
  if (m.source === "dijiste") return tail(m.botId && bot ? `Se lo dijiste a ${bot.name}` : "Lo dijiste tú");
  if (m.source === "importado") return tail("De ChatGPT");
  if (m.source === "documento") return tail("De un documento");
  if (m.source === "acuerdo") return tail("Lo acordasteis");
  if (m.source === "dedujo") return [bot ? `Lo aprendió ${bot.name}` : "Lo dedujeron", m.review ? null : "confirmado"].filter(Boolean).join(" · ");
  return m.sourceLabel || tail("Lo recuerdan");
}
const Mark = ({ bot }) => (bot
  ? <span aria-hidden="true" style={{ flex: "none", width: "12px", height: "12px", background: bot.color || "#C9CBD1", clipPath: shapeOf(bot).clip, borderRadius: shapeOf(bot).radius }} />
  : null);

function Known({ m, bot, expert }) {
  const act = useAction();
  const [draft, setDraft] = useState(null);
  const forget = () => later({ id: "memory:" + m.id, keys: ["memory:" + m.id], ms: UNDO_MS, text: "Recuerdo olvidado", error: "No se pudo olvidar", run: () => act.act(() => del(`/memories/${encodeURIComponent(m.id)}`)) });
  const save = async () => {
    const text = (draft || "").trim();
    if (!text || text === m.text) { setDraft(null); return; }
    const r = await act.act(() => patch(`/memories/${encodeURIComponent(m.id)}`, { text }));
    if (r !== undefined) setDraft(null);
  };
  const btn = { height: "32px", padding: "0 10px", border: "0", background: "transparent", fontSize: "13px", color: "#4A4D57", cursor: "pointer" };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", minHeight: "56px", padding: "8px 20px", borderTop: "1px solid rgba(18,19,26,.05)", animation: "fade .3s ease-out" }}>
      {draft !== null ? (
        <input type="text" autoFocus aria-label="Corregir el recuerdo" value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setDraft(null); }} onBlur={save}
          style={{ flex: "1 1 300px", minWidth: 0, height: "40px", padding: "0 12px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "12px", background: "#FFFFFF", fontSize: "15px" }} />
      ) : <span style={{ flex: "1 1 300px", fontSize: "15px", lineHeight: "1.4" }}>{m.text}</span>}
      <span style={{ fontSize: "12.5px", color: "#5C606C" }}>
        {sourceOf(m, bot)}
        {expert ? <span style={{ font: "500 11.5px/1 'Geist Mono', monospace", marginLeft: "8px" }}>{[m.scope, m.nature, m.origin].filter(Boolean).join(" · ")}</span> : null}
      </span>
      {draft === null ? <button type="button" onClick={() => setDraft(m.text)} style={btn}>{"Editar"}</button> : null}
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={forget} style={btn}>{"Olvidar"}</button>
      {act.error ? <span role="alert" style={{ flexBasis: "100%", fontSize: "13px", color: "#B4232A" }}>{act.error}</span> : null}
    </div>
  );
}

export default function Memory({ memories, bots, expert }) {
  const { run } = useStore();
  const act = useAction();
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState({});
  const [versions, setVersions] = useState(false);
  const profile = useResource("/user-profile/versions");
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const review = memories.filter((m) => m.review);
  const answered = Object.values(answers);
  const known = memories.filter((m) => !m.review).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  // Grouped by who knows it: the whole team first, then each bot's own.
  const groups = [];
  const team = known.filter((m) => m.scope === "equipo" || !m.botId);
  if (team.length) groups.push({ key: "equipo", title: "Lo sabe todo el equipo", items: team });
  for (const b of bots) {
    const own = known.filter((m) => m.scope !== "equipo" && m.botId === b.id);
    if (own.length) groups.push({ key: b.id, title: "Solo lo sabe " + b.name, bot: b, items: own });
  }
  const orphan = known.filter((m) => m.scope !== "equipo" && m.botId && !botOf(m.botId));
  if (orphan.length) groups.push({ key: "otros", title: "Otros", items: orphan });

  const tell = async () => {
    if (!text.trim()) return;
    const ok = await act.act(() => post("/memories", { text: text.trim(), scope: "equipo" }));
    if (ok !== undefined) setText("");
  };
  const yes = async (m) => {
    setAnswers((a) => ({ ...a, [m.id]: { m, kind: "yes" } }));
    const r = await act.act(() => patch(`/memories/${encodeURIComponent(m.id)}`, { review: false }));
    if (r === undefined) setAnswers((a) => { const n = { ...a }; delete n[m.id]; return n; });
  };
  const no = (m) => {
    setAnswers((a) => ({ ...a, [m.id]: { m, kind: "no" } }));
    later({ id: "memory:" + m.id, keys: ["memory:" + m.id], ms: UNDO_MS, text: "Recuerdo descartado", error: "No se pudo descartar",
      undone: () => setAnswers((a) => { const n = { ...a }; delete n[m.id]; return n; }),
      run: () => run(() => del(`/memories/${encodeURIComponent(m.id)}`)) });
  };
  const openReview = review.filter((m) => !answers[m.id]);
  const nVersions = Array.isArray(profile.data) ? profile.data.length : 0;

  return (
    <>
      <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 8px 8px 20px", borderRadius: "22px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 44px -30px rgba(18,19,26,.4)" }}>
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Cuéntales algo para que lo recuerden"}</span>
        <input type="text" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") tell(); }} placeholder="Cuéntales algo para que lo recuerden: «Los viernes salgo a las 15:00»" style={{ flex: "1", minWidth: "0", height: "50px", border: "0", outline: "none", background: "transparent", fontSize: "16px" }} />
        <button type="button" onClick={tell} disabled={!text.trim() || act.busy} style={{ height: "44px", padding: "0 18px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "14.5px", fontWeight: "600", cursor: text.trim() ? "pointer" : "default" }}>{"Guardar"}</button>
      </label>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4232A" }}>{act.error}</p> : null}

      {openReview.length || answered.length ? (
        <section aria-labelledby="rev-t" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "22px", background: "#FFF6DC" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2 id="rev-t" style={{ margin: "0", fontSize: "16px", fontWeight: "600" }}>{"Por revisar · "}{String(openReview.length)}</h2>
            <span style={{ fontSize: "13.5px", color: "#4A4D57" }}>{"Lo dedujeron leyendo correos, webs o apps. No lo usan hasta que digas que es correcto."}</span>
          </div>
          {[...openReview.map((m) => ({ m, kind: null })), ...answered].map(({ m, kind }) => {
            const bot = botOf(m.botId);
            const src = [bot ? `Lo dedujo ${bot.name}` + (m.origin === "externo" ? " de una web, un correo o una app" : "") : m.sourceLabel, day(m.createdAt)].filter(Boolean).join(" · ");
            return (
              <div key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "14px 16px", borderRadius: "16px", background: "#FFFFFF" }}>
                <span style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "3px" }}>
                  <span style={{ fontSize: "15px", fontWeight: "500" }}>{m.text}</span>
                  <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{src}</span>
                </span>
                {!kind ? (
                  <>
                    <button type="button" onClick={() => no(m)} style={{ height: "38px", padding: "0 14px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", cursor: "pointer" }}>{"No es así"}</button>
                    <button type="button" onClick={() => yes(m)} style={{ height: "38px", padding: "0 16px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>{"Es correcto"}</button>
                  </>
                ) : <span role="status" style={{ fontSize: "13.5px", fontWeight: "500", color: kind === "yes" ? "#0B6B4A" : "#4A4D57" }}>{kind === "yes" ? "✓ Guardado: ya lo usan" : "Descartado y olvidado"}</span>}
              </div>
            );
          })}
        </section>
      ) : null}

      <section aria-labelledby="know-t" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <h2 id="know-t" style={{ margin: "0", font: "600 22px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Lo que saben de ti"}</h2>
          <button type="button" aria-expanded={versions} onClick={() => setVersions((x) => !x)} style={{ height: "36px", padding: "0 14px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "999px", background: versions ? "#F1F1EC" : "#FFFFFF", fontSize: "13.5px", cursor: "pointer" }}>{nVersions ? `Versiones del perfil · ${nVersions}` : "Versiones del perfil"}</button>
        </div>
        {versions ? (
          <div style={{ display: "flex", flexDirection: "column", borderRadius: "20px", background: "#FFFFFF", overflow: "hidden", animation: "rise .2s ease-out" }}>
            <h3 style={{ margin: "0", padding: "14px 20px 0", fontSize: "13px", fontWeight: "600", color: "#5C606C" }}>{"Tu perfil (USER.md): el resumen de lo que saben de ti. Puedes volver a cualquier versión."}</h3>
            <div style={{ padding: "4px 0 6px" }}><DocHistory doc="user" empty="Todavía no hay un perfil resumido: Colmena lo prepara cuando sabe lo suficiente de ti." /></div>
          </div>
        ) : null}
        {!groups.length ? <p style={{ margin: 0, padding: "18px 20px", borderRadius: "20px", background: "#FFFFFF", fontSize: "15px", color: "#5C606C" }}>{"Todavía no saben nada de ti. Cuéntales algo arriba o tráelo de ChatGPT."}</p> : null}
        {groups.map((g) => (
          <div key={g.key} style={{ display: "flex", flexDirection: "column", borderRadius: "20px", background: "#FFFFFF", overflow: "hidden" }}>
            <h3 style={{ margin: "0", padding: "14px 20px 6px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: "600", color: "#5C606C" }}><Mark bot={g.bot} />{g.title}</h3>
            {g.items.map((m) => <Known key={m.id} m={m} bot={botOf(m.botId)} expert={expert} />)}
          </div>
        ))}
      </section>
      <p style={{ margin: "0", fontSize: "13.5px", color: "#5C606C" }}>
        {"Lo que hablas en un chat privado no se guarda aquí. Para borrarlo todo de una vez: "}
        <a href="/ajustes/privacidad" style={{ color: "#1F4FD1" }}>{"Privacidad y datos"}</a>
        {"."}
      </p>
    </>
  );
}

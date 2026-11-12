import { useState } from "react";
import { Archive, CircleHelp, Download, Globe, Handshake, Pin, PinOff, UserRound } from "lucide-react";
import { shapeOf } from "../../v2/Presence.jsx";
import { hrefOf } from "../dia/activityLog.js";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { del, patch, post } from "../../../lib/api.js";
import { later } from "../../../lib/undoToast.js";
import DocHistory from "../../v2/team/DocHistory.jsx";

// Biblioteca › Memoria (design/V3Memoria.dc.html): what your bots know about you. A box to tell
// them something; what they deduced from mail, webs or apps waits in «Por revisar» and is not
// used until you say it is right; the rest grouped by who knows it, each one editable or
// forgettable (10 s «Deshacer»). Your summarised profile (USER.md) keeps every version.
// Two places (server/memory.mjs): «Siempre presentes» is what every conversation starts with,
// and has a limit; «Archivo» has none and comes back when it is about what you ask. Each
// memory says how far it is trusted and where it comes from, and can be pinned or archived.

const UNDO_MS = 10000;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "");
const chipStyle = { flex: "none", display: "inline-flex", alignItems: "center", gap: "5px", height: "24px", padding: "0 9px", borderRadius: "999px", background: "#F1F1EC", color: "#3D404A", fontSize: "12px", fontWeight: "500", whiteSpace: "nowrap" };
/**
 * How far a memory is trusted, from its provenance (server/memory.mjs memoryProvenance):
 * `trust` 'doubt' contradicts what you said; outside content and documents are «de fuera»;
 * the rest by who it comes from (`source`, `origin`).
 */
function TrustChip({ m, bot }) {
  const icon = { size: 13, strokeWidth: 2, "aria-hidden": true };
  if (m.trust === "doubt") return <span style={chipStyle}><CircleHelp {...icon} />{"En duda"}</span>;
  if (m.origin === "externo" || m.source === "documento") return <span style={chipStyle}><Globe {...icon} />{m.source === "documento" ? "De un documento" : "De fuera"}</span>;
  if (m.source === "importado") return <span style={chipStyle}><Download {...icon} />{"De ChatGPT"}</span>;
  if (m.source === "acuerdo") return <span style={chipStyle}><Handshake {...icon} />{"Lo acordasteis"}</span>;
  if (m.source === "dedujo" && m.origin !== "persona") return <span style={chipStyle}><Mark bot={bot} />{bot ? `Lo dedujo ${bot.name}` : "Lo dedujeron"}</span>;
  return <span style={chipStyle}><UserRound {...icon} />{"Lo dijiste tú"}</span>;
}
/** «2 oct · en «Informe Q3»», the conversation as a link when it still exists. */
function Origin({ m, mission }) {
  const href = hrefOf(mission);
  const d = day(m.createdAt);
  if (!d && !href) return null;
  return (
    <span style={{ fontSize: "12.5px", color: "#5C606C" }}>
      {d}
      {href ? <>{d ? " · en " : "En "}<a href={href} style={{ color: "#1F4FD1" }}>{mission.title || "la conversación"}</a></> : null}
    </span>
  );
}
const Mark = ({ bot }) => (bot
  ? <span aria-hidden="true" style={{ flex: "none", width: "12px", height: "12px", background: bot.color || "#C9CBD1", clipPath: shapeOf(bot).clip, borderRadius: shapeOf(bot).radius }} />
  : null);

function Known({ m, bot, mission, expert }) {
  const act = useAction();
  const place = (body) => act.act(() => patch(`/memories/${encodeURIComponent(m.id)}`, body));
  const inArchive = m.tier === "archive";
  const [draft, setDraft] = useState(null);
  const forget = () => later({ id: "memory:" + m.id, keys: ["memory:" + m.id], ms: UNDO_MS, text: "Recuerdo olvidado", error: "No se pudo olvidar", run: () => act.act(() => del(`/memories/${encodeURIComponent(m.id)}`)) });
  const save = async () => {
    const text = (draft || "").trim();
    if (!text || text === m.text) { setDraft(null); return; }
    const r = await act.act(() => patch(`/memories/${encodeURIComponent(m.id)}`, { text }));
    if (r !== undefined) setDraft(null);
  };
  const btn = { height: "32px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "5px", border: "0", background: "transparent", fontSize: "13px", color: "#4A4D57", cursor: "pointer" };
  const icon = { size: 14, strokeWidth: 2, "aria-hidden": true };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", minHeight: "56px", padding: "8px 20px", borderTop: "1px solid rgba(18,19,26,.05)", animation: "fade .3s ease-out" }}>
      {draft !== null ? (
        <input className="c-quiet" type="text" autoFocus aria-label="Corregir el recuerdo" value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setDraft(null); }} onBlur={save}
          style={{ flex: "1 1 300px", minWidth: 0, height: "40px", padding: "0 12px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "12px", background: "#FFFFFF", fontSize: "15px" }} />
      ) : (
        <span style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "5px", minWidth: 0 }}>
          <span style={{ fontSize: "15px", lineHeight: "1.4" }}>{m.text}</span>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" }}>
            <TrustChip m={m} bot={bot} />
            {m.pinned ? <span style={chipStyle}><Pin {...icon} size={13} />{"Fijado"}</span> : null}
            <Origin m={m} mission={mission} />
            {expert ? <span style={{ font: "500 11.5px/1 'Geist Mono', monospace", color: "#5C606C" }}>{[m.scope, m.nature, m.origin, m.uses ? `${m.uses} usos` : null].filter(Boolean).join(" · ")}</span> : null}
          </span>
        </span>
      )}
      {m.pinned
        ? <button type="button" onClick={() => place({ pinned: false })} disabled={act.busy} title="Deja de estar fijado: puede pasar al archivo si hace falta sitio" style={btn}><PinOff {...icon} />{"Soltar"}</button>
        : <button type="button" onClick={() => place({ pinned: true })} disabled={act.busy} title="Siempre presente: nunca pasa al archivo" style={btn}><Pin {...icon} />{"Fijar"}</button>}
      {!inArchive ? <button type="button" onClick={() => place({ tier: "archive" })} disabled={act.busy} title="Lo guardan en el archivo y lo recuerdan cuando viene a cuento" style={btn}><Archive {...icon} />{"Archivar"}</button> : null}
      {draft === null ? <button type="button" onClick={() => setDraft(m.text)} style={btn}>{"Editar"}</button> : null}
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={forget} style={btn}>{"Olvidar"}</button>
      {act.error ? <span role="alert" style={{ flexBasis: "100%", fontSize: "13px", color: "#B4232A" }}>{act.error}</span> : null}
    </div>
  );
}

export default function Memory({ memories, bots, missions = [], expert }) {
  const { run } = useStore();
  const act = useAction();
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState({});
  const [versions, setVersions] = useState(false);
  const [tier, setTier] = useState("core");
  const missionOf = (id) => (id ? missions.find((x) => x.id === id) || null : null);
  const profile = useResource("/user-profile/versions");
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const review = memories.filter((m) => m.review);
  const answered = Object.values(answers);
  const settled = memories.filter((m) => !m.review);
  const count = { core: settled.filter((m) => m.tier !== "archive").length, archive: settled.filter((m) => m.tier === "archive").length };
  const known = settled.filter((m) => (m.tier === "archive") === (tier === "archive")).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
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
  // «Es correcto» / «Valen las dos» keep what you had said; «Cambiarlo» puts this one in its place.
  const yes = async (m, replaces = false) => {
    setAnswers((a) => ({ ...a, [m.id]: { m, kind: replaces ? "swap" : "yes" } }));
    const r = await act.act(() => patch(`/memories/${encodeURIComponent(m.id)}`, replaces ? { review: false, replaces: true } : { review: false }));
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
        <input className="c-bare" type="text" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") tell(); }} placeholder="Cuéntales algo para que lo recuerden: «Los viernes salgo a las 15:00»" style={{ flex: "1", minWidth: "0", height: "50px", border: "0", background: "transparent", fontSize: "16px" }} />
        <button type="button" onClick={tell} disabled={!text.trim() || act.busy} style={{ height: "44px", padding: "0 18px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "14.5px", fontWeight: "600", cursor: text.trim() ? "pointer" : "default" }}>{"Guardar"}</button>
      </label>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4232A" }}>{act.error}</p> : null}

      {openReview.length || answered.length ? (
        <section aria-labelledby="rev-t" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "22px", background: "#FFF6DC" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2 id="rev-t" style={{ margin: "0", fontSize: "16px", fontWeight: "600" }}>{"Por revisar · "}{String(openReview.length)}</h2>
            <span style={{ fontSize: "13.5px", color: "#4A4D57" }}>{"Lo dedujeron ellos, o lo leyeron en correos, webs o apps. Lo que viene de fuera o está en duda no lo usan hasta que digas que es correcto."}</span>
          </div>
          {[...openReview.map((m) => ({ m, kind: null })), ...answered].map(({ m, kind }) => {
            const bot = botOf(m.botId);
            const doubt = m.trust === "doubt";
            const mine = doubt ? memories.find((x) => x.id === m.contradicts) : null;
            const pill = { height: "38px", padding: "0 14px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", cursor: "pointer" };
            const main = { height: "38px", padding: "0 16px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "14px", fontWeight: "600", cursor: "pointer" };
            return (
              <div key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "14px 16px", borderRadius: "16px", background: "#FFFFFF" }}>
                <span style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "3px" }}>
                  <span style={{ fontSize: "15px", fontWeight: "500" }}>{m.text}</span>
                  {mine ? <span style={{ fontSize: "13.5px", color: "#3D404A" }}>{"Tú dijiste: «"}{mine.text}{"». De momento vale lo tuyo."}</span> : null}
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", marginTop: "2px" }}>
                    <TrustChip m={m} bot={bot} />
                    {doubt && bot ? <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{`Lo dedujo ${bot.name}`}</span> : null}
                    <Origin m={m} mission={missionOf(m.missionId)} />
                  </span>
                </span>
                {!kind ? (
                  <>
                    <button type="button" onClick={() => no(m)} style={pill}>{"No es así"}</button>
                    {mine ? <button type="button" onClick={() => yes(m)} style={pill}>{"Valen las dos"}</button> : null}
                    <button type="button" onClick={() => yes(m, !!mine)} style={main}>{mine ? "Cambiarlo" : "Es correcto"}</button>
                  </>
                ) : <span role="status" style={{ fontSize: "13.5px", fontWeight: "500", color: kind === "no" ? "#4A4D57" : "#0B6B4A" }}>{kind === "swap" ? "✓ Cambiado: ya usan esto" : kind === "yes" ? "✓ Guardado: ya lo usan" : "Descartado y olvidado"}</span>}
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
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
          <div role="group" aria-label="Qué recuerdos ver" style={{ display: "flex", gap: "6px" }}>
            {[["core", "Siempre presentes"], ["archive", "Archivo"]].map(([id, label]) => {
              const on = tier === id;
              return <button key={id} type="button" aria-pressed={on} onClick={() => setTier(id)} style={{ height: "36px", padding: "0 13px", border: "0", borderRadius: "999px", background: on ? "#12131A" : "#FFFFFF", color: on ? "#FFFFFF" : "#3D404A", fontSize: "13.5px", fontWeight: "500", cursor: "pointer" }}>{label}{" · "}{String(count[id])}</button>;
            })}
          </div>
          <span style={{ fontSize: "13.5px", color: "#5C606C" }}>{tier === "core" ? "Lo tienen delante en cada conversación. Si se llena, lo que menos se usa pasa al archivo." : "No lo llevan siempre encima: lo recuerdan cuando viene a cuento."}</span>
        </div>
        {!groups.length ? <p style={{ margin: 0, padding: "18px 20px", borderRadius: "20px", background: "#FFFFFF", fontSize: "15px", color: "#5C606C" }}>{tier === "archive" ? "El archivo está vacío. Aquí llega lo que ya no cabe entre lo siempre presente, y lo que tú archives." : "Todavía no saben nada de ti. Cuéntales algo arriba o tráelo de ChatGPT."}</p> : null}
        {groups.map((g) => (
          <div key={g.key} style={{ display: "flex", flexDirection: "column", borderRadius: "20px", background: "#FFFFFF", overflow: "hidden" }}>
            <h3 style={{ margin: "0", padding: "14px 20px 6px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: "600", color: "#5C606C" }}><Mark bot={g.bot} />{g.title}</h3>
            {g.items.map((m) => <Known key={m.id} m={m} bot={botOf(m.botId)} mission={missionOf(m.missionId)} expert={expert} />)}
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

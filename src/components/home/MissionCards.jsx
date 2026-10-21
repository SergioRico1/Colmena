import { navigate } from "../../lib/router.jsx";
import { botById } from "../../lib/bots.js";
import { needsYou, plural, roomUrl, shortDate, time } from "../../lib/format.js";
import { AvatarStack, isToday, joinNames, tint } from "./shared.jsx";

// The three mission card types of design/Main.dc.html («Misiones en marcha»).

const CARD = { background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" };
const KICKER = { font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" };
const TITLE = { font: "700 20px/1.2 'Bricolage Grotesque', sans-serif" };
const MONO = { font: "500 13px/1 'Geist Mono', monospace", color: "#555A68" };

const DOT_RUN = { width: "8px", height: "8px", borderRadius: "50%", background: "#0B8A5F", boxShadow: "0 0 0 4px #D6F0E4" };
const DOT_WAIT = { width: "8px", height: "8px", borderRadius: "2px", background: "#C98A00" };
const DOT_IDLE = { width: "8px", height: "8px", borderRadius: "50%", border: "1.5px solid #555A68" };
const DOT_BLOCKED = { width: "8px", height: "8px", borderRadius: "2px", background: "#B4372A" };

function dotFor(m) {
  if (m.status === "running" || m.status === "planning") return DOT_RUN;
  if (needsYou(m)) return DOT_WAIT;
  if (m.status === "blocked") return DOT_BLOCKED;
  if (m.status === "paused" || m.status === "queued") return DOT_IDLE;
  return DOT_RUN;
}

function Header({ m, kicker, bots }) {
  const names = bots.map((b) => b.name);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={KICKER}>{kicker}</span>
        <a href={roomUrl(m)} style={TITLE}>{m.title || m.prompt}</a>
      </div>
      {bots.length ? (
        <div aria-label={`${bots.length === 1 ? "Bot en esta misión" : "Bots en esta misión"}: ${joinNames(names)}`} style={{ display: "flex" }}>
          <AvatarStack bots={bots} size={32} />
        </div>
      ) : null}
    </div>
  );
}

function StatusLine({ m }) {
  return (
    <p style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", fontSize: "15px" }}>
      <span style={dotFor(m)} />
      {m.activityLine || m.statusLabel || ""}
    </p>
  );
}

function Meta({ m }) {
  const questions = m.questionCount || 0;
  const pending = m.pendingCount || 0;
  const chip = questions
    ? `${plural(questions, "pregunta", "preguntas")} para ti`
    : pending
      ? `${pending} ${pending === 1 ? "cosa espera" : "cosas esperan"} tu OK`
      : null;
  const due = m.dueAt ? `Entrega ${isToday(m.dueAt) ? "" : shortDate(m.dueAt) + " "}${time(m.dueAt)}` : null;
  if (!chip && !due) return <span style={MONO}>Sin preguntas</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
      {chip ? <span style={{ fontSize: "13px", padding: "6px 10px", background: "#FFF4D1", borderRadius: "8px", fontWeight: "600" }}>{chip}</span> : null}
      {due ? <span style={MONO}>{due}</span> : null}
    </div>
  );
}

const SEG = {
  done: { height: "8px", borderRadius: "4px", background: "#FFC93C", outline: "1.5px solid #12131A", outlineOffset: "-1.5px" },
  run: { height: "8px", borderRadius: "4px", background: "#12131A" },
  wait: { height: "8px", borderRadius: "4px", background: "repeating-linear-gradient(135deg, #12131A 0 4px, #8C91A0 4px 8px)" },
  todo: { height: "8px", borderRadius: "4px", background: "#DCE0E8" },
};

function segments(m) {
  const total = Math.max(0, m.progress?.total || 0);
  const done = Math.min(total, Math.max(0, m.progress?.done || 0));
  const running = m.status === "running" || m.status === "planning";
  const waiting = needsYou(m);
  if (!total) return [waiting ? "wait" : running ? "run" : "todo"];
  const out = [];
  for (let i = 0; i < done; i++) out.push("done");
  if (running && out.length < total) out.push("run");
  if (waiting && out.length < total) out.push("wait");
  while (out.length < total) out.push("todo");
  return out;
}

function segmentLabel(segs) {
  const n = (k) => segs.filter((s) => s === k).length;
  const parts = [];
  if (n("done")) parts.push(n("done") === 1 ? "1 paso hecho" : `${n("done")} pasos hechos`);
  if (n("run")) parts.push(`${n("run")} en curso`);
  if (n("wait")) parts.push(`${n("wait")} te ${n("wait") === 1 ? "espera" : "esperan"}`);
  if (n("todo")) parts.push(`${n("todo")} ${n("todo") === 1 ? "pendiente" : "pendientes"}`);
  return "Progreso: " + (joinNames(parts) || "sin pasos todavía");
}

export function TeamCard({ m, bots }) {
  const atlas = botById(bots, "atlas");
  const ids = [...new Set([...(m.botIds || []), ...(m.chosenBotIds || [])])].filter((id) => id !== "atlas");
  const team = [atlas, ...ids.map((id) => botById(bots, id))].filter(Boolean);
  const segs = segments(m);
  return (
    <article className="c-lift" style={{ ...CARD, cursor: "pointer" }} onClick={(e) => { if (!e.target.closest("a,button,input,textarea,select")) navigate(roomUrl(m)); }}>
      <Header m={m} kicker={`Equipo · coordina ${atlas?.name || "Atlas"}`} bots={team} />
      <div aria-label={segmentLabel(segs)} style={{ display: "grid", gridTemplateColumns: `repeat(${segs.length}, minmax(0, 1fr))`, gap: "6px" }}>
        {segs.map((s, i) => <span key={i} className="c-seg-fill" style={SEG[s]} />)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <StatusLine m={m} />
        <Meta m={m} />
      </div>
    </article>
  );
}

const LETTERS = "ABCDEFGH";

export function DebateCard({ m, bots }) {
  const team = (m.botIds || []).map((id) => botById(bots, id)).filter(Boolean);
  const choose = m.status === "awaiting_choice";
  return (
    <article className="c-lift" style={{ ...CARD, cursor: "pointer" }} onClick={(e) => { if (!e.target.closest("a,button,input,textarea,select")) navigate(roomUrl(m)); }}>
      <Header m={m} kicker={`Debate · ${plural(team.length, "propuesta", "propuestas")}`} bots={team} />
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, team.length)}, minmax(0, 1fr))`, gap: "10px" }}>
        {team.map((b, i) => {
          const t = tint(b);
          return (
            <div key={b.id} style={{ aspectRatio: "16 / 9", borderRadius: "10px", background: t.bg, border: `1px solid ${t.border}`, display: "grid", placeItems: "center", font: "600 13px/1.2 'Geist', sans-serif", color: t.fg, textAlign: "center", padding: "8px" }}>
              {`Propuesta ${LETTERS[i] || i + 1} · ${b.name}`}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        {choose ? (
          <>
            <p style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", fontSize: "15px" }}>
              <span style={DOT_WAIT} />
              Ya se han criticado entre ellos. Te toca elegir.
            </p>
            <a href={roomUrl(m)} style={{ display: "flex", alignItems: "center", height: "44px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", borderRadius: "12px", fontWeight: "600", fontSize: "14px" }}>Comparar y elegir</a>
          </>
        ) : (
          <>
            <StatusLine m={m} />
            <Meta m={m} />
          </>
        )}
      </div>
    </article>
  );
}

export function SoloCard({ m, bots }) {
  const bot = botById(bots, m.botIds?.[0]) || botById(bots, "nora");
  const total = m.progress?.total || 0;
  const done = Math.min(total, m.progress?.done || 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const where = bot?.location === "nube" ? "en la nube" : "en este ordenador";
  return (
    <article className="c-lift" style={{ ...CARD, cursor: "pointer" }} onClick={(e) => { if (!e.target.closest("a,button,input,textarea,select")) navigate(roomUrl(m)); }}>
      <Header m={m} kicker={`Un bot · ${where}`} bots={bot ? [bot] : []} />
      <div aria-label={total ? `Progreso: ${done} de ${total}` : "Progreso: sin pasos todavía"} style={{ height: "8px", borderRadius: "4px", background: "#DCE0E8", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: "#12131A", borderRadius: "4px" }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <StatusLine m={m} />
        <Meta m={m} />
      </div>
    </article>
  );
}

export function MissionCard({ m, bots }) {
  if (m.mode === "debate") return <DebateCard m={m} bots={bots} />;
  if (m.mode === "solo") return <SoloCard m={m} bots={bots} />;
  return <TeamCard m={m} bots={bots} />;
}

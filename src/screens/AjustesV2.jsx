import { useEffect, useState } from "react";
import { Calendar, FileText, Folder, Mail, MessageSquare, Volume2 } from "lucide-react";
import { playNoticeSound } from "../lib/noticeSounds.js";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import { del, patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { formatTokens } from "../components/settings/format.jsx";
import { EngineRow, EngineChoices } from "../components/v2/settings/Engines.jsx";
import ProviderMark, { WithMark } from "../components/v2/ProviderMark.jsx";
import { updates, useUpdates } from "../lib/updates.js";
import { later } from "../lib/undoToast.js";

// Colmena 2.0 · Ajustes (design/V2Ajustes.dc.html): one calm page of grouped rows. The
// detailed editors (accounts and models, connections, folders, people, the action log) stay
// one click away, under /ajustes/<section>.

const INK = "#12131A";
const MUTED = "#5C606C";
const FAINT = "#6B6F7A";
const LINE = "1px solid rgba(18,19,26,.06)";
const RED_LINES = ["…enviar algo fuera de la empresa", "…mover dinero", "…borrar o sobrescribir archivos", "…instalar programas"];
const CONNECTOR_LOOK = {
  correo: ["@", "#EAF0FF"], calendario: ["31", "#FFF0E6"], carpeta: ["▤", "#EAF6F0"], hojas: ["▦", "#EAF6F0"], chat: ["#", "#F2EEFF"],
  video: ["▶", "#FFF0E6"], crm: ["◎", "#EAF0FF"], erp: ["€", "#FFF4D1"],
};
// Search hint for the connections catalogue (/ajustes/conexiones?q=…).
const CATALOGUE_QUERY = { correo: "gmail", calendario: "calendar", carpeta: "drive", hojas: "sheets", chat: "slack", video: "meet", crm: "crm", erp: "accounting" };
const LIMITS = [[null, "Sin límite"], [1e6, "1 M"], [3e6, "3 M"], [10e6, "10 M"]];

function Section({ id, title, note, children }) {
  return (
    <section aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <h2 id={id} style={{ margin: "0 0 0 20px", fontSize: "13px", fontWeight: 500, color: FAINT }}>{title}</h2>
      <div style={{ background: "#FFFFFF", borderRadius: "26px", overflow: "hidden" }}>{children}</div>
      {note ? <p style={{ margin: "0 20px", fontSize: "13px", lineHeight: 1.5, color: FAINT }}>{note}</p> : null}
    </section>
  );
}
const Chevron = ({ open = false, right = false }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A9DA6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", transition: "transform .2s ease", transform: right ? "rotate(-90deg)" : open ? "rotate(180deg)" : "none" }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const rowStyle = (last, min = "64px") => ({ width: "100%", display: "flex", alignItems: "center", gap: "16px", minHeight: min, padding: "12px 20px", border: 0, borderBottom: last ? 0 : LINE, background: "transparent", textAlign: "left", color: INK });
function Text({ title, sub, subColor = MUTED }) {
  return (
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
      <strong style={{ fontSize: "16px", fontWeight: sub ? 600 : 400 }}>{title}</strong>
      {sub ? <span style={{ fontSize: "14px", color: subColor }}>{sub}</span> : null}
    </span>
  );
}
function Knob({ on }) {
  return (
    <span aria-hidden="true" style={{ width: "52px", height: "32px", flex: "none", padding: "3px", borderRadius: "16px", transition: "background .25s ease", background: on ? "#0B8A5F" : "rgba(18,19,26,.14)" }}>
      <span style={{ display: "block", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(20px)" : "translateX(0)" }} />
    </span>
  );
}
function SwitchRow({ title, sub, on, onChange, busy, last }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={() => onChange(!on)} style={{ ...rowStyle(last, sub ? "72px" : "64px"), cursor: busy ? "wait" : "pointer" }}>
      <Text title={title} sub={sub} />
      <Knob on={on} />
    </button>
  );
}
function LinkRow({ title, sub, value, to, last, icon = null }) {
  return (
    <a href={to} onClick={(e) => { e.preventDefault(); navigate(to); }} style={{ ...rowStyle(last, sub ? "72px" : "64px"), textDecoration: "none", cursor: "pointer" }}>
      {icon}
      <Text title={title} sub={sub} />
      {value ? <span style={{ fontSize: "15px", color: MUTED }}>{value}</span> : null}
      <Chevron right />
    </a>
  );
}
const RESULT = { "nada nuevo": "Nada nuevo", "nada importante": "Nada que contarte", "sin fuentes": "Conecta una app o elige una carpeta para empezar", error: "No pudo mirar" };
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const SOURCE_ICON = { gmail: Mail, outlook: Mail, calendar: Calendar, slack: MessageSquare, drive: FileText, notion: FileText, folders: Folder };
const SOURCE_PHRASE = { gmail: "tu correo", outlook: "tu correo de Outlook", calendar: "tu agenda", slack: "Slack", drive: "Drive", notion: "Notion", folders: "tus carpetas" };
const lastLine = (d) => {
  if (d.stopped) return "Parado tras varios fallos: " + (d.lastError || "no pudo mirar");
  if (!d.lastAt) return null;
  const what = RESULT[d.lastResult] || (/novedad/.test(d.lastResult || "") ? "Te contó " + d.lastResult : d.lastResult || "Miró");
  return what + " · " + hhmm(d.lastAt);
};
/**
 * «Te avisa de lo importante» (server/watch.mjs, OpenClaw heartbeat): on/off, where it looks
 * (each connected place), how much it tells you, and what matters to you, in your words.
 */
function WatchRows({ bots }) {
  const { data, setData } = useResource("/watch");
  const act = useAction();
  const [list, setList] = useState(null); // «Qué te importa» while you write it
  if (!data) return null;
  const save = (changes) => act.act(async () => setData(await patch("/watch", changes)));
  const look = () => act.act(async () => setData(await post("/watch/run", {})));
  const bot = bots.find((b) => b.id === data.bot?.id);
  const name = bot?.name || "Un bot";
  const places = (data.sources || []).filter((s) => s.connected);
  const sub = places.length
    ? `${name} mira lo nuevo en ${[...new Set(places.map((s) => SOURCE_PHRASE[s.id] || s.label))].join(", ").replace(/, ([^,]*)$/, " y $1")} y te escribe solo cuando algo te importa.`
    : `Conecta tu correo, tu agenda u otra app y ${bot?.name || "tu bot"} te contará lo importante que llegue.`;
  const held = data.held ? ` · ${data.held} para el próximo resumen` : "";
  const draft = list ?? data.checklist ?? "";
  const keep = () => { if (list != null && list.trim() !== (data.checklist || "")) save({ checklist: list }); setList(null); };
  return (
    <>
      <SwitchRow title="Te avisa de lo importante" sub={sub} on={!!data.enabled} busy={act.busy} onChange={(v) => save({ enabled: v })} />
      {data.enabled ? (
        <>
          {places.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "72px", padding: "12px 20px", borderBottom: LINE }}>
              <span style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ fontSize: "16px" }}>Dónde mira</span>
                <a href="/ajustes/conexiones" onClick={(e) => { e.preventDefault(); navigate("/ajustes/conexiones"); }} style={{ fontSize: "13px", fontWeight: 600, color: "#1F4FD1" }}>Conectar otra app</a>
              </span>
              <span role="group" aria-label="Dónde mira" style={{ flex: "1 1 300px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {places.map((s) => {
                  const Icon = SOURCE_ICON[s.id] || FileText;
                  const trouble = s.unavailable ? "Esta app no ofrece todavía una lectura que Colmena entienda." : s.stopped ? "Parado tras varios fallos: " + (s.error || "") : s.error;
                  return (
                    <button key={s.id} type="button" role="switch" aria-checked={s.on} disabled={act.busy} title={trouble || (s.on ? "Mira aquí. Pulsa para dejar de mirar." : "No mira aquí. Pulsa para que mire.")} onClick={() => save({ sources: { [s.id]: !s.on } })}
                      style={{ display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 14px 0 12px", borderRadius: "999px", cursor: act.busy ? "wait" : "pointer", fontSize: "13px", fontWeight: 600, transition: "all .2s ease",
                        border: s.on ? "1px solid #12131A" : "1px solid rgba(18,19,26,.12)", background: s.on ? "#12131A" : "transparent", color: s.on ? "#FFFFFF" : MUTED }}>
                      <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
                      {s.label}
                      {s.on && trouble ? <span aria-label="Con problemas" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#E5675A" }} /> : null}
                    </button>
                  );
                })}
              </span>
            </div>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "72px", padding: "12px 20px", borderBottom: LINE }}>
            <span style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ fontSize: "16px" }}>Qué te cuenta</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "13px", color: data.lastResult === "error" || data.stopped ? "#B4372A" : FAINT }}>
                {lastLine(data) ? <span title={data.lastError || undefined}>{lastLine(data) + held}</span> : null}
                {places.length ? <button type="button" disabled={act.busy} onClick={look} style={{ padding: 0, border: 0, background: "transparent", cursor: act.busy ? "wait" : "pointer", fontSize: "13px", fontWeight: 600, color: "#1F4FD1" }}>{act.busy ? "Mirando…" : "Mirar ahora"}</button> : null}
                {data.chatId && bot ? <a href={`/chat/${bot.id}?c=${data.chatId}`} style={{ fontSize: "13px", fontWeight: 600, color: "#1F4FD1" }}>Ver su chat</a> : null}
              </span>
            </span>
            <span style={{ flex: "1 1 300px" }}>
              <Segmented label="Qué te cuenta" busy={act.busy} value={data.level} onPick={(v) => save({ level: v })} items={[["urgente", "Solo lo urgente"], ["importante", "Todo lo importante"]]} />
            </span>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px 18px", borderBottom: LINE }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ fontSize: "16px" }}>Qué te importa</span>
              <span style={{ fontSize: "13px", color: FAINT }}>{`Con tus palabras. ${name} lo tiene en cuenta cada vez que mira.`}</span>
            </span>
            <textarea value={draft} maxLength={1500} rows={3} onChange={(e) => setList(e.target.value)} onBlur={keep}
              placeholder={"Avísame enseguida si escribe Oriol.\nLos pedidos de la app de Lumbre, mejor juntos en el resumen.\nNo me cuentes los boletines del banco."}
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: "84px", padding: "12px 14px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "16px", background: "#F6F6F3", font: "400 15px/1.5 'Geist', sans-serif", color: INK, outline: "none" }} />
          </label>
        </>
      ) : null}
      {act.error ? <p role="alert" style={{ margin: 0, padding: "10px 20px", fontSize: "14px", color: "#B4372A", borderBottom: LINE }}>{act.error}</p> : null}
    </>
  );
}
function Segmented({ label, items, value, onPick, busy }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
      {items.map(([v, text]) => {
        const on = value === v;
        return <button key={String(v)} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => onPick(v)} style={{ flex: 1, height: "38px", padding: "0 12px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" }}>{text}</button>;
      })}
    </div>
  );
}
// «Cómo te avisa»: a Windows notice, a sound, both or nothing; each kind sounds its own way.
const NOTICE_MODES = [["both", "Aviso y sonido"], ["windows", "Solo aviso"], ["sound", "Solo sonido"], ["off", "Nada"]];
const NOTICE_SUB = {
  both: "Un aviso de Windows y un sonido distinto si ha terminado o si te necesita.",
  windows: "Un aviso de Windows, sin sonido.",
  sound: "Solo el sonido: uno si ha terminado y otro si te necesita.",
  off: "Nada te interrumpe. Todo sigue en Hoy y en el contador del icono.",
};
function NoticeMode({ value, busy, onPick }) {
  const sounds = value === "both" || value === "sound";
  const tryOne = { display: "inline-flex", alignItems: "center", gap: "7px", height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: INK, background: "rgba(18,19,26,.05)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px 20px 16px", borderBottom: LINE }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px" }}>
        <span style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ fontSize: "16px", fontWeight: 600 }}>Cómo te avisa</strong>
          <span role="status" style={{ fontSize: "14px", color: MUTED }}>{NOTICE_SUB[value] || NOTICE_SUB.both}</span>
        </span>
        <span style={{ flex: "1 1 360px" }}>
          <Segmented label="Cómo te avisa" busy={busy} value={value} onPick={onPick} items={NOTICE_MODES} />
        </span>
      </div>
      {sounds ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", animation: "fade .25s ease-out" }}>
          <span style={{ fontSize: "13px", color: FAINT, marginRight: "4px" }}>Escúchalos</span>
          <button type="button" onClick={() => playNoticeSound("done")} style={tryOne}><Volume2 size={14} strokeWidth={2.2} aria-hidden="true" />Ha terminado</button>
          <button type="button" onClick={() => playNoticeSound("needs")} style={tryOne}><Volume2 size={14} strokeWidth={2.2} aria-hidden="true" />Te necesita</button>
        </div>
      ) : null}
    </div>
  );
}
const pill = (dark) => ({ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600, flex: "none", background: dark ? INK : "rgba(18,19,26,.06)", color: dark ? "#FFFFFF" : INK });

// «Actualizaciones» (desktop app only, desktop/updater.cjs): the version you have, what the
// updater is doing, «Buscar actualizaciones», the channel and the new version's notes.
function updateLine(u) {
  if (u.status === "checking") return "Buscando…";
  if (u.status === "downloading") return `Descargando la ${u.version}… ${u.percent || 0} %`;
  if (u.status === "ready") return u.waiting ? "Se actualizará cuando el equipo termine." : `La ${u.version} está lista. Se instala al reiniciar.`;
  if (u.status === "error") return u.error;
  return "Estás al día" + (u.checkedAt ? " · comprobado a las " + hhmm(u.checkedAt) : "");
}
function UpdatesSection() {
  const u = useUpdates();
  const [notes, setNotes] = useState(false);
  if (!u) return <p style={{ margin: "0 auto", fontSize: "13px", color: FAINT }}>Colmena 2.0</p>;
  const busy = u.status === "checking" || u.status === "downloading";
  const manual = u.status === "error" && u.manual;
  return (
    <Section id="upd-t" title="Actualizaciones" note="Las versiones nuevas se descargan solas y se instalan al reiniciar o al cerrar Colmena. Nunca a mitad de una misión.">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "76px", padding: "12px 20px", borderBottom: LINE }}>
        <Text title={"Colmena " + u.current} sub={updateLine(u)} subColor={u.status === "ready" ? "#0B6B4A" : MUTED} />
        {u.status === "ready" && !u.waiting ? (
          <button type="button" onClick={() => updates.restart()} style={pill(true)}>Reiniciar para actualizar</button>
        ) : manual ? (
          <button type="button" onClick={() => updates.download()} style={pill(true)}>Descargar</button>
        ) : u.status === "ready" ? null : (
          <button type="button" disabled={busy || !u.supported} onClick={() => updates.check()} style={{ ...pill(false), cursor: busy ? "wait" : "pointer" }}>{u.status === "downloading" ? "Descargando…" : busy ? "Buscando…" : "Buscar actualizaciones"}</button>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "72px", padding: "12px 20px", borderBottom: u.notes ? LINE : 0 }}>
        <Text title="Canal" sub={u.channel === "beta" ? "Las novedades antes que nadie, con algún fallo." : "Versiones probadas."} />
        <span style={{ flex: "0 1 230px" }}>
          <Segmented label="Canal de actualizaciones" value={u.channel} onPick={(v) => updates.setChannel(v)} items={[["stable", "Estable"], ["beta", "Beta"]]} />
        </span>
      </div>
      {u.notes && u.version ? (
        <>
          <button type="button" aria-expanded={notes} onClick={() => setNotes(!notes)} style={{ ...rowStyle(!notes), cursor: "pointer" }}>
            <Text title={"Novedades de la " + u.version} />
            <Chevron open={notes} />
          </button>
          {notes ? <p style={{ margin: 0, padding: "0 20px 18px", fontSize: "14px", lineHeight: 1.6, color: MUTED, whiteSpace: "pre-wrap", animation: "fade .25s ease-out" }}>{u.notes}</p> : null}
        </>
      ) : null}
    </Section>
  );
}

export default function AjustesV2() {
  const { settings = {}, provider, account, authError, models = [], connectors = [], folders = [], grants = [], memories = [], usage = {}, computer, bots = [], ai = null } = useStore();
  const engine = (id) => ai?.engines?.find((e) => e.id === id) || null;
  const openaiOn = !!engine("openai")?.connected || (!ai && !!provider?.connected);
  const teamEngine = ai?.primary || (openaiOn ? "openai" : null);
  const act = useAction();
  const history = useResource("/usage/history");
  const set = (changes) => act.act(() => patch("/settings", changes));
  const botOf = (id) => bots.find((b) => b.id === id) || null;

  // ── ChatGPT sign-in (the end of the flow arrives over SSE as a state refresh) ──
  const [waiting, setWaiting] = useState(null);
  const connected = ai ? openaiOn : !!provider?.connected;
  useEffect(() => { if (connected || authError) setWaiting(null); }, [connected, authError]);
  const login = () => act.act(async () => {
    const r = await post("/auth/start");
    if (r?.url) { window.open(r.url, "_blank", "noopener"); setWaiting({ url: r.url }); }
  });
  const gpt = waiting ? { text: "Esperando a que inicies sesión…", fg: "#8A5A00" }
    : connected ? { text: "Conectada · " + ((ai ? engine("openai")?.detail : provider.label) || "ChatGPT"), fg: "#0B6B4A" }
    : authError ? { text: String(authError.message || authError), fg: "#B4231A" }
    : { text: "Colmena piensa con tu plan de ChatGPT. Inicia sesión para empezar.", fg: MUTED };
  const [open, setOpen] = useState(null);
  // ChatGPT's own list (Claude and OpenCode models are «provider/model» refs).
  const gptModels = models.filter((m) => !String(m.slug).includes("/"));
  const modelLabel = gptModels.find((m) => m.slug === settings.model)?.label || settings.model || "El recomendado";

  // ── Espacio ──
  const [space, setSpace] = useState(settings.spaceName || "");
  useEffect(() => { setSpace(settings.spaceName || ""); }, [settings.spaceName]);
  const saveSpace = () => { if (space.trim() && space.trim() !== settings.spaceName) set({ spaceName: space.trim() }); };

  // ── Privacidad ──
  const [forget, setForget] = useState("idle");
  const forgetAll = () => {
    const all = memories.map((m) => m.id);
    setForget("idle");
    later({ id: "forget-all", keys: all.map((id) => "memory:" + id), text: "Los bots lo olvidan todo", error: "No se pudo olvidar todo",
      run: () => act.act(async () => { for (const id of all) await del(`/memories/${encodeURIComponent(id)}`); setForget("done"); }) });
  };

  const limits = settings.limits || {};
  const pct = usage.percent != null ? Math.round(usage.percent) : null;
  const spenders = (history.data?.bots || []).filter((b) => b.tokens > 0).slice(0, 2);
  const total = history.data?.total || 0;
  const headSub = [account?.email || (provider?.connected ? provider.label : null), settings.userRole].filter(Boolean).join(" · ") || "Tu espacio de Colmena";

  return (
    <Shell active="ajustes">
      <main style={{ maxWidth: "780px", margin: "0 auto", padding: "64px clamp(20px, 4vw, 40px) 40px", display: "flex", flexDirection: "column", gap: "38px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: "22px" }}>
          <span aria-hidden="true" style={{ width: "84px", height: "84px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: INK, color: "#FFFFFF", font: "600 26px/1 'Geist', sans-serif" }}>TÚ</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h1 style={{ margin: 0, font: "600 44px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>Ajustes</h1>
            <span style={{ fontSize: "16px", color: MUTED }}>{headSub}</span>
          </div>
        </header>
        {act.error ? <p role="alert" style={{ margin: "-20px 20px 0", fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}

        <Section id="ia-t" title="Inteligencia">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "76px", padding: "14px 20px", borderBottom: LINE }}>
            <ProviderMark engine="openai" />
            <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "3px" }}>
              <strong style={{ fontSize: "16px", fontWeight: 600 }}>Tu cuenta de ChatGPT</strong>
              <span role="status" style={{ fontSize: "14px", color: gpt.fg }}>{gpt.text}</span>
            </span>
            {waiting ? (
              <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2px solid rgba(18,19,26,.15)", borderTopColor: INK, animation: "spin .8s linear infinite" }} />
                <button type="button" onClick={() => act.act(() => post("/auth/cancel")).then(() => setWaiting(null))} style={pill(false)}>Cancelar</button>
              </span>
            ) : connected ? (
              <button type="button" disabled={act.busy} onClick={() => act.act(() => post("/auth/logout"))} style={pill(false)}>Desconectar</button>
            ) : (
              <button type="button" disabled={act.busy} onClick={login} style={pill(true)}>Iniciar sesión</button>
            )}
          </div>
          {waiting ? (
            <p style={{ margin: 0, padding: "14px 20px 16px 76px", fontSize: "14px", lineHeight: 1.5, color: MUTED, borderBottom: LINE, animation: "fade .3s ease-out" }}>
              Hemos abierto la página oficial de inicio de sesión en tu navegador. Colmena nunca ve tu contraseña. Vuelve aquí cuando termines.{" "}
              <button type="button" onClick={() => window.open(waiting.url, "_blank", "noopener")} style={{ border: 0, padding: 0, background: "none", font: "inherit", color: INK, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Abrirla otra vez</button>
            </p>
          ) : null}
          {ai ? (
            <>
              <EngineRow engine="anthropic" info={engine("anthropic")} />
              <EngineRow engine="opencode-go" info={engine("opencode-go")} />
              <EngineChoices ai={ai} localConfigured={!!ai.local} last={false} />
            </>
          ) : null}
          {teamEngine === "openai" || !ai ? <>
          <button type="button" aria-haspopup="listbox" aria-expanded={open === "model"} disabled={!gptModels.length} onClick={() => setOpen(open === "model" ? null : "model")} style={{ ...rowStyle(false), cursor: gptModels.length ? "pointer" : "default" }}>
            <span style={{ flex: 1, fontSize: "16px" }}>Modelo que usan</span>
            <span style={{ fontSize: "15px", color: MUTED }}>{connected ? <WithMark engine="openai">{modelLabel}</WithMark> : "Al iniciar sesión"}</span>
            {gptModels.length ? <Chevron open={open === "model"} /> : null}
          </button>
          {open === "model" ? (
            <div role="listbox" aria-label="Modelo que usan" style={{ display: "flex", flexDirection: "column", gap: "2px", margin: "0 12px 12px", padding: "6px", borderRadius: "18px", background: "#F4F4F0", animation: "rise .2s ease-out" }}>
              {gptModels.map((m) => {
                const on = m.slug === settings.model;
                return (
                  <button key={m.slug} type="button" role="option" aria-selected={on} onClick={() => { setOpen(null); set({ model: m.slug }); }} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "6px 14px", border: 0, borderRadius: "14px", cursor: "pointer", textAlign: "left", color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.12)" : "none" }}>
                    <ProviderMark engine="openai" size={28} />
                    <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <strong style={{ fontSize: "15px", fontWeight: 600 }}>{m.label || m.slug}</strong>
                      {m.description ? <span style={{ fontSize: "13px", color: MUTED }}>{m.description}</span> : null}
                    </span>
                    <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? INK : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: on ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          </> : null}
          <LinkRow title="Qué usa cada bot" value="Más opciones" to="/ajustes/ia" last />
        </Section>

        <Section id="con-t" title="Conectado a">
          {connectors.map((c, i) => {
            const [glyph, tint] = CONNECTOR_LOOK[c.id] || ["•", "#EEEEE9"];
            return (
              <LinkRow key={c.id} to={`/ajustes/conexiones${c.connected ? "" : "?q=" + encodeURIComponent(CATALOGUE_QUERY[c.id] || c.name)}`}
                icon={<span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", borderRadius: "12px", font: "600 15px/1 'Geist', sans-serif", background: tint }}>{glyph}</span>}
                title={c.name}
                sub={c.connected ? "Conectado" + (c.botCount ? ` · lo usan ${c.botCount} ${c.botCount === 1 ? "bot" : "bots"}` : "") : "Sin conectar"} />
            );
          })}
          <LinkRow title="Todas tus apps" sub="Conectar otra, añadir una cuenta o quitarla" to="/ajustes/conexiones" />
          <LinkRow title="Qué app usa cada bot" sub="Quién solo mira y quién puede cambiar algo" to="/ajustes/permisos" last />
        </Section>

        <Section id="ok-t" title="Los bots te preguntan antes de…" note="Esto no se puede apagar: un bot nunca hace nada de esto sin tu OK, aunque una sala, un encargo o una web le digan lo contrario.">
          {RED_LINES.map((t) => (
            <div key={t} style={rowStyle(false)}>
              <span style={{ flex: 1, fontSize: "16px" }}>{t}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600, color: MUTED }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                Siempre
              </span>
            </div>
          ))}
          <LinkRow title="Qué más puede hacer cada bot" value="En Colmena" to="/colmena" last />
        </Section>

        <Section id="av-t" title="Avisos">
          <WatchRows bots={bots} connectors={connectors} />
          <NoticeMode value={settings.notifyMode || "both"} busy={act.busy} onPick={(v) => set({ notifyMode: v })} />
          <SwitchRow title="Horario tranquilo" sub="De 19:00 a 9:00 y fines de semana. Los bots siguen, pero no te avisan." on={!!settings.quietHours} busy={act.busy} onChange={(v) => set({ quietHours: v })} />
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "72px", padding: "12px 20px" }}>
            <span style={{ flex: "1 1 160px", fontSize: "16px" }}>Avísame de</span>
            <span style={{ flex: "1 1 340px" }}>
              <Segmented label="Avísame de" busy={act.busy} value={settings.notifyLevel || "todo"} onPick={(v) => set({ notifyLevel: v })} items={[["todo", "Todo"], ["importante", "Lo importante"], ["tuyo", "Solo lo que te toca"]]} />
            </span>
          </div>
        </Section>

        <Section id="pc-t" title="Este ordenador">
          {folders.map((f) => (
            <div key={f.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", minHeight: "76px", padding: "12px 20px", borderBottom: LINE }}>
              <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", borderRadius: "12px", background: "#EAF6F0", font: "600 15px/1 'Geist', sans-serif" }}>▤</span>
              <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                <strong style={{ fontSize: "16px", fontWeight: 600 }}>{f.label}</strong>
                <span style={{ fontSize: "13px", color: MUTED, font: "500 12px/1.4 'Geist Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
                <span style={{ fontSize: "13px", color: FAINT }}>{f.botIds?.length ? f.botIds.map((id) => botOf(id)?.name).filter(Boolean).join(", ") : "Todos"}</span>
              </span>
              <span style={{ flex: "0 1 230px" }}>
                <Segmented label={"Acceso a " + f.label} busy={act.busy} value={f.access} onPick={(v) => act.act(() => patch(`/folders/${encodeURIComponent(f.id)}`, { access: v }))} items={[["lee", "Solo leer"], ["escribe", "Leer y escribir"]]} />
              </span>
            </div>
          ))}
          <LinkRow title={folders.length ? "Elegir otra carpeta…" : "Elegir una carpeta…"} sub={folders.length ? null : "Ningún bot ve tus archivos hasta que les des una carpeta."} to="/ajustes/ordenador" />
          <div style={rowStyle(true, "72px")}>
            <Text title="Navegador propio para cada bot" sub="Pueden usar webs como tú. Nunca escriben contraseñas." />
            <span style={{ fontSize: "14px", fontWeight: 500, color: computer?.available ? "#0B6B4A" : FAINT }}>{computer?.available ? "Activo" : "En la app de escritorio"}</span>
          </div>
        </Section>

        <Section id="lim-t" title="Límites y gasto">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "22px 20px 18px", borderBottom: LINE }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <strong style={{ font: "600 44px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{pct != null ? `${pct} %` : formatTokens(usage.monthTokens || 0)}</strong>
              <span style={{ fontSize: "15px", color: MUTED }}>{pct != null ? " del mes" : " tokens este mes"}</span>
            </span>
            {pct != null ? (
              <span aria-hidden="true" style={{ height: "8px", borderRadius: "4px", background: "rgba(18,19,26,.07)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: Math.min(100, pct) + "%", borderRadius: "4px", background: pct >= 80 ? "#FFC93C" : INK, animation: "grow .8s ease-out" }} />
              </span>
            ) : null}
            <span style={{ fontSize: "14px", color: MUTED }}>
              {limits.monthlyTokens ? `${formatTokens(usage.monthTokens || 0)} de ${formatTokens(limits.monthlyTokens)} tokens` : "Sin límite mensual."}
              {spenders.length && total ? ` Quien más gasta: ${spenders.map((b) => `${botOf(b.botId || b.id)?.name || b.name || "un bot"} (${Math.round((b.tokens / total) * 100)} %)`).join(" y ")}.` : ""}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "72px", padding: "12px 20px", borderBottom: LINE }}>
            <span style={{ flex: "1 1 160px", fontSize: "16px" }}>Límite al mes</span>
            <span style={{ flex: "1 1 340px" }}>
              <Segmented label="Límite al mes" busy={act.busy} value={limits.monthlyTokens ?? null} onPick={(v) => set({ limits: { monthlyTokens: v } })} items={LIMITS} />
            </span>
          </div>
          <SwitchRow title="Pausar al llegar al límite" sub="Los encargos esperan hasta el mes siguiente o hasta que lo subas." on={limits.pauseAtLimit !== false} busy={act.busy} onChange={(v) => set({ limits: { pauseAtLimit: v } })} />
          <SwitchRow title="Avisarme al 80 %" sub="Te llega a Hoy, sin interrumpir a nadie." on={limits.warnAt80 !== false} busy={act.busy} onChange={(v) => set({ limits: { warnAt80: v } })} />
          <LinkRow title="Historial de uso" value="30 días" to="/ajustes/limites" last />
        </Section>

        <Section id="esp-t" title="Espacio y personas">
          <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", minHeight: "72px", padding: "12px 20px", borderBottom: LINE }}>
            <span style={{ flex: "1 1 160px", fontSize: "16px" }}>Nombre del espacio</span>
            <input type="text" value={space} maxLength={80} onChange={(e) => setSpace(e.target.value)} onBlur={saveSpace} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} style={{ flex: "1 1 280px", height: "46px", padding: "0 16px", border: 0, borderRadius: "14px", outline: "none", background: "#F4F4F0", fontSize: "15px", color: INK }} />
          </label>
          <SwitchRow title="Aprenden de su trabajo" sub="Crean habilidades y recuerdos nuevos. Siempre los revisas tú antes de que los usen." on={settings.learning !== false} busy={act.busy} onChange={(v) => set({ learning: v })} />
          <LinkRow title="Personas del espacio" to="/ajustes/personas" last />
        </Section>

        <Section id="seg-t" title="Seguridad y registro">
          <LinkRow title="Registro de acciones" sub="Todo lo que han hecho, con quién lo aprobó y cuándo" to="/ajustes/seguridad" />
          <div style={{ display: "flex", flexDirection: "column", padding: "14px 20px 6px" }}>
            <strong style={{ fontSize: "16px", fontWeight: 600, paddingBottom: "6px" }}>Permisos que diste para siempre</strong>
            {!grants.length ? <span style={{ padding: "4px 0 14px", fontSize: "14px", color: MUTED }}>Ninguno. Te preguntarán cada vez.</span> : null}
            {grants.map((g) => (
              <div key={g.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", minHeight: "60px", padding: "8px 0", borderTop: LINE }}>
                {botOf(g.botId) ? <BotPresence bot={botOf(g.botId)} size={24} /> : null}
                <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "15px" }}>{g.label || g.title || g.text || "Permiso"}</span>
                  <span style={{ fontSize: "13px", color: FAINT }}>{[botOf(g.botId)?.name || "Todos los bots", g.createdAt ? "desde el " + new Date(g.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : null, g.uses ? `${g.uses} veces` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" disabled={act.busy} onClick={() => later({ id: "grant:" + g.id, keys: ["grant:" + g.id], text: "Permiso retirado", error: "No se pudo retirar", run: () => act.act(() => del(`/grants/${encodeURIComponent(g.id)}`)) })} style={{ ...pill(false), height: "36px", padding: "0 14px", fontSize: "13px" }}>Retirar</button>
              </div>
            ))}
          </div>
        </Section>

        <Section id="pri-t" title="Privacidad">
          <div style={rowStyle(false)}>
            <span style={{ flex: 1, fontSize: "16px" }}>Lo que hablas en privado con un bot</span>
            <span style={{ fontSize: "15px", color: MUTED }}>solo lo ves tú</span>
          </div>
          <LinkRow title="Qué recuerda cada bot de ti" value={`${memories.length} ${memories.length === 1 ? "cosa" : "cosas"}`} to="/archivo?pestana=memoria" />
          {forget === "idle" && memories.length ? (
            <button type="button" onClick={() => setForget("ask")} style={{ ...rowStyle(true), cursor: "pointer", fontSize: "16px", color: "#B4372A" }}>Hacer que los bots lo olviden todo</button>
          ) : null}
          {forget === "ask" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px 18px", background: "#FFF6F4", animation: "fade .25s ease-out" }}>
              <span style={{ fontSize: "15px", lineHeight: 1.5 }}>Olvidarán tus preferencias y tu forma de trabajar. Lo que hay en el Archivo no se borra.</span>
              <span style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => setForget("idle")} style={pill(false)}>Cancelar</button>
                <button type="button" disabled={act.busy} onClick={forgetAll} style={{ ...pill(true), background: "#B4372A" }}>{act.busy ? "Olvidando…" : "Olvidar todo"}</button>
              </span>
            </div>
          ) : null}
          {forget === "done" ? <p role="status" style={{ margin: 0, padding: "16px 20px", fontSize: "15px", color: "#0B6B4A" }}>Hecho. Empezarán a conocerte de nuevo.</p> : null}
        </Section>

        <UpdatesSection />
      </main>
    </Shell>
  );
}

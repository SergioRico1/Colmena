import { useState } from "react";
import { Download, Zap } from "lucide-react";
import { BotPresence } from "../Presence.jsx";
import ProviderMark from "../ProviderMark.jsx";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { patch } from "../../../lib/api.js";
import { formatTokens } from "../../settings/format.jsx";
import { Bar, FAINT, Figure, FieldRow, Group, INK, LINE, MUTED, Segmented, SwitchRow, anchorOf, rowStyle } from "./rows.jsx";

// Ajustes › Uso (T3 Code's usage page, in Colmena's words): what each bot and each chat or
// room spent, how much of what the model read came from its prompt cache, and how much is
// left of each plan. GET /api/usage/overview (server/usage-routes.mjs).

const PERIODS = [[7, "7 días"], [30, "30 días"], [90, "90 días"]];
const LIMITS = [[null, "Sin límite"], [1e6, "1 M"], [3e6, "3 M"], [10e6, "10 M"]];
const pct = (n) => (n == null ? "—" : n + " %");
const share = (part, total) => (total ? Math.round((part / total) * 100) : 0);

/** «Ventana de 5 horas», «Semana»: the name of a plan window. */
const windowName = (m) => (!m ? "Ahora" : m === 10080 ? "Esta semana" : m % 1440 === 0 ? `${m / 1440} días` : m % 60 === 0 ? `Ventana de ${m / 60} horas` : `${m} min`);
function whenText(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const ms = t - Date.now();
  if (ms <= 60_000) return "se renueva ahora";
  if (ms < 3_600_000) return `se renueva en ${Math.ceil(ms / 60_000)} min`;
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  if (days <= 0) return "se renueva hoy a las " + hm;
  if (days === 1) return "se renueva mañana a las " + hm;
  return "se renueva el " + d.toLocaleDateString("es-ES", { weekday: "long" }) + " a las " + hm;
}
/** Where an even spend would be now: the share of the window already gone (T3's pace line). */
function paceOf(w) {
  if (!w?.windowMinutes || !w.resetsAt) return null;
  const left = Date.parse(w.resetsAt) - Date.now();
  const span = w.windowMinutes * 60_000;
  return left > 0 && left <= span ? Math.round(((span - left) / span) * 100) : null;
}
function paceLine(w) {
  const pace = paceOf(w);
  if (pace == null) return null;
  if (w.usedPercent > pace + 5) return "Vas más rápido que el reloj";
  if (w.usedPercent < pace - 5) return "Vas holgado";
  return "Vas a buen ritmo";
}

function PlanRows({ plans }) {
  const engines = plans?.engines || [];
  const shown = engines.filter((e) => e.connected || e.limit);
  if (!shown.length) return <p style={{ margin: 0, padding: "18px 20px", fontSize: "15px", color: MUTED }}>Conecta una IA en Inteligencia para ver los límites de su plan.</p>;
  return shown.map((e, i) => {
    const last = i === shown.length - 1;
    const windows = e.id === "openai" ? [plans.openai?.primary, plans.openai?.secondary].filter(Boolean) : [];
    return (
      <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px 20px 18px", borderBottom: last ? 0 : LINE }}>
        <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <ProviderMark engine={e.id} size={32} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
            <strong style={{ fontSize: "16px", fontWeight: 600 }}>{e.label}</strong>
            <span style={{ fontSize: "13px", color: e.limit ? "#8A5A00" : FAINT }}>
              {e.limit ? `Ha llegado a su ${e.limit.label || "límite de uso"}${e.limit.resetsAt ? " · " + whenText(e.limit.resetsAt) : ""}` : e.detail || "Conectada"}
            </span>
          </span>
        </span>
        {windows.map((w, j) => {
          const left = 100 - w.usedPercent;
          const pace = paceOf(w);
          return (
            <div key={j} style={{ display: "flex", flexDirection: "column", gap: "8px", paddingLeft: "44px" }}>
              <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "4px 12px", fontSize: "14px" }}>
                <span><strong style={{ fontWeight: 600 }}>{windowName(w.windowMinutes)}</strong>{` · te queda el ${left} %`}</span>
                <span style={{ color: FAINT }}>{[paceLine(w), w.resetsAt ? whenText(w.resetsAt) : null].filter(Boolean).join(" · ")}</span>
              </span>
              <Bar percent={w.usedPercent} warn={w.usedPercent >= 80} tick={pace} label={`${windowName(w.windowMinutes)}: usado el ${w.usedPercent} %`} />
            </div>
          );
        })}
        {!windows.length && !e.limit ? (
          <span style={{ paddingLeft: "44px", fontSize: "13px", lineHeight: 1.5, color: FAINT }}>
            {e.id === "openai" ? "ChatGPT cuenta lo que queda de tu plan en cada respuesta: aparecerá aquí tras la próxima." : `${e.label} no dice cuánto queda de tu plan. Si llega al límite, Colmena te avisa y sigue con el respaldo.`}
          </span>
        ) : null}
      </div>
    );
  });
}

/** Input read new · read from the cache · written, as one bar of three tones. */
function Split({ t }) {
  const fresh = Math.max(0, t.input - t.cached), total = fresh + t.cached + t.output;
  const parts = [["Leído nuevo", fresh, "#12131A"], ["De la caché", t.cached, "#0B8A5F"], ["Escrito", t.output, "#C9CBD1"]];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <span role="img" aria-label={parts.map(([l, v]) => `${l}: ${share(v, total)} %`).join(", ")} style={{ display: "flex", height: "10px", borderRadius: "5px", overflow: "hidden", background: "rgba(18,19,26,.07)", gap: "2px" }}>
        {parts.map(([l, v, c]) => (v ? <span key={l} style={{ width: share(v, total) + "%", minWidth: "3px", background: c, transformOrigin: "left", animation: "grow .8s ease-out" }} /> : null))}
      </span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: "13px", color: MUTED }}>
        {parts.map(([l, v, c]) => (
          <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
            <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: c }} />{l} · {formatTokens(v)}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Tokens per day: quiet columns, today's darker. Hover tells the day and the amount. */
function Days({ days }) {
  const max = Math.max(1, ...days.map((d) => d.tokens));
  const dayName = (k) => new Date(k + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div role="img" aria-label={`Uso por día: el día de más uso, ${formatTokens(max)} tokens`} style={{ display: "flex", alignItems: "flex-end", gap: days.length > 40 ? "1px" : "3px", height: "96px" }}>
      {days.map((d, i) => (
        <span key={d.date} title={`${dayName(d.date)} · ${formatTokens(d.tokens)} tokens${d.input ? ` · ${share(d.cached, d.input)} % de la caché` : ""}`}
          style={{ flex: 1, minWidth: 0, height: Math.max(d.tokens ? 4 : 2, Math.round((d.tokens / max) * 96)) + "px", borderRadius: "3px", transition: "height .5s cubic-bezier(.2,.8,.2,1)", background: d.tokens ? (i === days.length - 1 ? INK : "rgba(18,19,26,.28)") : "rgba(18,19,26,.07)" }} />
      ))}
    </div>
  );
}

function SpendRow({ icon, title, sub, t, total, last, href }) {
  const body = (
    <>
      {icon}
      <span style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "15px" }}>
          <strong style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</strong>
          <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>{formatTokens(t.tokens)}</span>
        </span>
        <Bar percent={share(t.tokens, total)} height={4} />
        <span style={{ fontSize: "12px", color: FAINT }}>{[sub, `${share(t.tokens, total)} % del total`, t.cachePercent != null ? `${t.cachePercent} % de la caché` : null, `${t.calls} ${t.calls === 1 ? "llamada" : "llamadas"}`].filter(Boolean).join(" · ")}</span>
      </span>
    </>
  );
  const style = { ...rowStyle(last, "76px"), textDecoration: "none" };
  return href ? <a href={href} style={style}>{body}</a> : <div style={style}>{body}</div>;
}

export default function UsageSection() {
  const { bots = [], settings = {}, usage = {} } = useStore();
  const [days, setDays] = useState(30);
  const [allChats, setAllChats] = useState(false);
  const { data, error, loading } = useResource("/usage/overview?days=" + days);
  const act = useAction();
  const set = (changes) => act.act(() => patch("/settings", changes));
  const limits = settings.limits || {};
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const t = data?.total;
  const month = data?.month || usage;
  const monthPct = month.percent != null ? Math.round(month.percent) : null;
  const chats = (data?.chats || []).filter((c) => c.tokens > 0);
  const step = data?.purposes?.find((p) => p.purpose === "step");
  const side = data?.purposes?.find((p) => p.purpose === "side");
  return (
    <>
      {act.error ? <p role="alert" style={{ margin: "-16px 20px 0", fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
      <Group id="mes-t" title="Este mes" anchor="este-mes">
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "22px 20px 18px", borderBottom: LINE }}>
          <Figure value={monthPct != null ? `${monthPct} %` : formatTokens(month.monthTokens || 0)} unit={monthPct != null ? "de tu límite del mes" : "tokens este mes"} />
          {monthPct != null ? <Bar percent={monthPct} warn={monthPct >= 80} label={`Usado el ${monthPct} % del límite del mes`} /> : null}
          <span style={{ fontSize: "14px", color: MUTED }}>
            {month.limitTokens ? `${formatTokens(month.monthTokens || 0)} de ${formatTokens(month.limitTokens)} tokens.` : "Sin límite mensual en Colmena."}
            {data?.bots?.length && t?.tokens ? ` Quien más gasta: ${data.bots.filter((b) => b.tokens > 0).slice(0, 2).map((b) => `${botOf(b.botId)?.name || "un bot"} (${share(b.tokens, t.tokens)} %)`).join(" y ")}.` : ""}
          </span>
        </div>
        <FieldRow title="Límite al mes" anchor="limite-mensual" sub="Un tope para todo el espacio, aparte del de tu plan.">
          <Segmented label="Límite al mes" busy={act.busy} value={limits.monthlyTokens ?? null} onPick={(v) => set({ limits: { monthlyTokens: v } })} items={LIMITS} />
        </FieldRow>
        <SwitchRow anchor="pausar-limite" title="Pausar al llegar al límite" sub="Los encargos esperan hasta el mes siguiente o hasta que lo subas." on={limits.pauseAtLimit !== false} busy={act.busy} onChange={(v) => set({ limits: { pauseAtLimit: v } })} />
        <SwitchRow anchor="aviso-80" title="Avisarme al 80 %" sub="Te llega a Hoy, sin interrumpir a nadie." on={limits.warnAt80 !== false} busy={act.busy} onChange={(v) => set({ limits: { warnAt80: v } })} last />
      </Group>

      <Group id="plan-t" title="Límites de tu plan" anchor="limites-plan" note="Son los límites de tu suscripción de cada IA. Colmena los lee de cada respuesta y, si una llega al límite, sigue con la de respaldo.">
        <PlanRows plans={data?.plans} />
      </Group>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px 16px", margin: "0 0 -18px" }}>
        <span style={{ marginLeft: "20px", fontSize: "13px", fontWeight: 500, color: FAINT }}>{data ? `Del ${new Date(data.from + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "long" })} a hoy` : "Periodo"}</span>
        <span style={{ flex: "0 1 300px" }}><Segmented label="Periodo" value={days} onPick={setDays} items={PERIODS} /></span>
      </div>

      <Group id="cache-t" title="Aprovechamiento de la caché" anchor="cache" note="Cuando el modelo ya ha leído el principio de una conversación, lo reutiliza de su caché: responde antes y gasta menos de tu plan. Sube en los chats largos y en las rutinas que se repiten.">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "22px 20px 20px" }}>
          {error ? <span role="alert" style={{ fontSize: "14px", color: "#B4231A" }}>{"No pude leer el uso: " + error}</span> : null}
          {loading && !data ? <span style={{ height: "44px", borderRadius: "12px", background: "linear-gradient(90deg, rgba(18,19,26,.04), rgba(18,19,26,.08), rgba(18,19,26,.04))", backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite" }} /> : null}
          {t ? (
            <>
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "12px 24px" }}>
                <Figure value={pct(t.cachePercent)} unit={t.input ? "de lo que leyeron salió de la caché" : "aún no hay lecturas medidas"} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "14px", color: MUTED }}><Zap size={15} strokeWidth={2.2} aria-hidden="true" />{`${formatTokens(t.tokens)} tokens · ${t.calls.toLocaleString("es-ES")} llamadas`}</span>
              </span>
              {t.tokens ? <Split t={t} /> : null}
              {data.perDay?.length ? <Days days={data.perDay} /> : null}
            </>
          ) : null}
        </div>
      </Group>

      <Group id="bots-t" title="Por bot" anchor="por-bot-uso">
        {(data?.bots || []).filter((b) => b.tokens > 0).map((b, i, list) => (
          <SpendRow key={b.botId} icon={botOf(b.botId) ? <BotPresence bot={botOf(b.botId)} size={28} /> : <span style={{ width: "28px" }} />} title={botOf(b.botId)?.name || "Bot borrado"} t={b} total={t?.tokens} last={i === list.length - 1} href={botOf(b.botId) ? `/colmena/${b.botId}` : null} />
        ))}
        {data && !data.bots?.some((b) => b.tokens > 0) ? <p style={{ margin: 0, padding: "18px 20px", fontSize: "15px", color: MUTED }}>Aún no han gastado nada en este periodo.</p> : null}
      </Group>

      <Group id="chats-t" title="Por chat y sala" anchor="por-chat" note={step || side ? `El trabajo de los bots es el ${share(step?.tokens || 0, t?.tokens)} %; el resto son tareas de fondo (títulos, resúmenes, avisos).` : null}>
        {(allChats ? chats : chats.slice(0, 8)).map((c, i, list) => {
          const first = botOf(c.botIds?.[0]);
          return (
            <SpendRow key={c.missionId} icon={c.kind === "room" ? <span aria-hidden="true" style={{ width: "28px", height: "28px", flex: "none", display: "grid", placeItems: "center", borderRadius: "9px", background: "rgba(18,19,26,.06)", font: "600 14px/1 'Geist', sans-serif", color: MUTED }}>#</span> : first ? <BotPresence bot={first} size={28} /> : <span style={{ width: "28px" }} />}
              title={c.title} sub={c.kind === "room" ? "Sala" : c.kind === "gone" ? null : first ? "Con " + first.name : "Chat"} t={c} total={t?.tokens} last={i === list.length - 1 && (allChats || chats.length <= 8)}
              href={c.kind === "gone" || c.incognito ? null : c.kind === "room" ? `/sala/${c.missionId}` : `/chat/${c.botIds?.[0] || ""}?c=${c.missionId}`} />
          );
        })}
        {chats.length > 8 && !allChats ? <button type="button" onClick={() => setAllChats(true)} style={{ ...rowStyle(true, "56px"), justifyContent: "center", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{`Ver los ${chats.length}`}</button> : null}
        {data && !chats.length ? <p style={{ margin: 0, padding: "18px 20px", fontSize: "15px", color: MUTED }}>Ningún chat ni sala ha gastado en este periodo.</p> : null}
      </Group>

      <a {...anchorOf("csv")} href={`/api/usage/history.csv?days=${days}`} download style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "8px", height: "42px", padding: "0 18px", borderRadius: "999px", background: "rgba(18,19,26,.06)", color: INK, fontSize: "14px", fontWeight: 600, textDecoration: "none", marginLeft: "4px" }}>
        <Download size={16} strokeWidth={2.2} aria-hidden="true" />{`Descargar ${days} días en CSV`}
      </a>
    </>
  );
}

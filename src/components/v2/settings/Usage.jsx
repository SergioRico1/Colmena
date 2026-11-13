import Select from "../../Select.jsx";
import { useState, useSyncExternalStore } from "react";
import { useResource, useStore } from "../../../lib/store.jsx";
import { useExpert } from "../../../lib/expert.js";
import { formatTokens } from "../../settings/format.jsx";
import { Alert, BotMark, Card, INK, MUTED, Pills, Row, Switch, Term, anchorOf, btn, h3, select, useSettings } from "./v3.jsx";

// Ajustes › Uso y límites (design/V3Uso.dc.html, T3 Code's usage page in Colmena's words): what
// each bot and each chat or room spent this month, per day, how much is left of each plan, how
// much of what the model read came from its prompt cache, and the monthly cap. Colmena counts
// tokens, not money (most people think with their ChatGPT or Claude plan), so the units are
// tokens or pages (a million tokens are about 1,500 pages). GET /api/usage/overview.

const PAGES_PER_TOKEN = 1500 / 1e6;
const LIMITS = [[null, "Sin límite"], [1e6, 1e6], [3e6, 3e6], [10e6, 10e6]];
const PERIODS = [[7, "7 días"], [30, "30 días"], [90, "90 días"]];
// Long work waits from this share of the AI plan's window on (server/admission.mjs; unset = 95).
const PLAN_PAUSE = [[95, "Al 95 % usado"], [90, "Al 90 % usado"], [80, "Al 80 % usado"], [null, "Nunca"]];
const share = (part, total) => (total ? Math.round((part / total) * 100) : 0);

// The unit lives outside the screen so the switch in the title and the figures agree.
let unit = null;
const subs = new Set();
const setUnit = (u) => { unit = u; subs.forEach((fn) => fn()); };
function useUnit() {
  const [expert] = useExpert();
  const u = useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => unit, () => unit);
  return u || (expert ? "tok" : "pag");
}
const fmt = (u, tokens) => (u === "pag" ? Math.round((Number(tokens) || 0) * PAGES_PER_TOKEN).toLocaleString("es-ES") + " pág." : formatTokens(tokens));

/** «Páginas · Tokens», right of the title. */
export function UsageUnits() {
  const u = useUnit();
  return <Pills label="Unidad" value={u} onPick={setUnit} background="#EBEBE6" items={[["pag", "Páginas"], ["tok", "Tokens"]]} />;
}

const windowName = (m) => (!m ? "ahora" : m === 10080 ? "semana" : m % 1440 === 0 ? `${m / 1440} días` : m % 60 === 0 ? `${m / 60} horas` : `${m} min`);
function renews(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  return days <= 0 ? "renueva " + hm : days === 1 ? "renueva mañana" : "renueva el " + d.toLocaleDateString("es-ES", { weekday: "long" });
}
const dayLabel = (k) => new Date(k + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");

function Plans({ plans }) {
  const rows = [];
  for (const e of plans?.engines || []) {
    if (!e.connected && !e.limit) continue;
    if (e.id === "openai" && (plans.openai?.primary || plans.openai?.secondary)) {
      for (const w of [plans.openai.primary, plans.openai.secondary].filter(Boolean)) rows.push({ key: e.id + w.windowMinutes, label: `${e.label} · ${windowName(w.windowMinutes)}`, note: [`${w.usedPercent} %`, renews(w.resetsAt)].filter(Boolean).join(" · "), w: w.usedPercent });
    } else if (e.limit) rows.push({ key: e.id, label: e.label, note: "Ha llegado a su límite" + (e.limit.resetsAt ? " · " + renews(e.limit.resetsAt) : ""), w: 100 });
    else rows.push({ key: e.id, label: e.label, note: e.id === "openai" ? "Aparece tras la próxima respuesta" : "No dice cuánto queda", w: null });
  }
  if (!rows.length) return <span style={{ fontSize: "var(--t-ui)", color: MUTED }}>Conecta una IA en Cuentas de IA para ver los límites de su plan.</span>;
  return rows.map((p) => (
    <div key={p.key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "var(--t-ui)" }}><span>{p.label}</span><span style={{ color: MUTED, textAlign: "right" }}>{p.note}</span></span>
      <span aria-hidden="true" style={{ height: "8px", borderRadius: "4px", background: "#F1F1EC", overflow: "hidden" }}>{p.w != null ? <span style={{ display: "block", width: p.w + "%", height: "100%", background: INK, transformOrigin: "left", animation: "grow .8s ease-out" }} /> : null}</span>
    </div>
  ));
}

export default function UsageSection() {
  const { bots = [], usage = {} } = useStore();
  const { settings, save, error: saveError } = useSettings();
  const [expert] = useExpert();
  const u = useUnit();
  const [days, setDays] = useState(30);
  const [all, setAll] = useState(false);
  const { data, error, loading } = useResource("/usage/overview?days=" + days);
  const limits = settings.limits || {};
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const month = data?.month || usage;
  const used = month.monthTokens || 0;
  const cap = month.limitTokens || limits.monthlyTokens || null;
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : null;
  const monthName = new Date().toLocaleDateString("es-ES", { month: "long" });
  const perDay = data?.perDay || [];
  const max = Math.max(1, ...perDay.map((d) => d.tokens));
  const spike = perDay.reduce((best, d, i) => (d.tokens > (perDay[best]?.tokens || 0) ? i : best), -1);
  const today = perDay.at(-1);
  const spent = (data?.bots || []).filter((b) => b.tokens > 0).slice(0, 6);
  const top = spent[0]?.tokens || 1;
  const chats = (data?.chats || []).filter((c) => c.tokens > 0);
  const t = data?.total;
  const planPause = limits.planPauseAt === null ? null : limits.planPauseAt ?? 95;
  const setLimit = (patch, text) => save({ limits: patch }, text, { limits: Object.fromEntries(Object.keys(patch).map((k) => [k, k === "monthlyTokens" ? limits.monthlyTokens ?? null : k === "planPauseAt" ? planPause : limits[k] !== false])) });
  const kind = (c) => (c.kind === "room" ? "Sala" : c.kind === "gone" ? "Borrada" : c.incognito ? "Incógnito" : "Chat");
  const note = cap ? `quedan ${fmt(u, Math.max(0, cap - used))} hasta el límite` : u === "pag" ? "un millón de tokens da para unas 1.500 páginas" : "sin límite al mes en Colmena";
  return (
    <>
      <Alert>{saveError || (error ? "No pude leer el uso: " + error : null)}</Alert>
      <section {...anchorOf("este-mes")} aria-labelledby="mes-t" style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "22px 24px", borderRadius: "22px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "8px 16px" }}>
          <h3 id="mes-t" style={{ ...h3, textTransform: "capitalize" }}>{monthName}</h3>
          <span style={{ font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{fmt(u, used)}</span>
          <span style={{ fontSize: "var(--t-ui)", color: MUTED }}>{note}</span>
        </div>
        {cap ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span role="img" aria-label={`Usado el ${pct} % del límite del mes`} style={{ position: "relative", height: "10px", borderRadius: "5px", background: "#EEEEEA", overflow: "hidden" }}>
              <span style={{ position: "absolute", inset: "0 auto 0 0", width: pct + "%", background: INK, transformOrigin: "left", animation: "grow .8s ease-out" }} />
              {limits.warnAt80 !== false ? <span style={{ position: "absolute", top: 0, bottom: 0, left: "80%", width: "2px", background: "#8A5A00" }} /> : null}
            </span>
            <span style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--t-meta)", color: MUTED }}><span>{`${pct} % del límite de ${fmt(u, cap)}`}</span>{limits.warnAt80 !== false ? <span>aviso al 80 %</span> : null}</span>
          </div>
        ) : null}
        <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
          <figcaption style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "var(--t-meta)", color: MUTED }}>
            <span>{`Por día, últimos ${days} días`}</span>
            {expert ? <Pills label="Periodo" value={days} onPick={setDays} items={PERIODS} /> : null}
          </figcaption>
          {loading && !data ? <span style={{ height: "144px", borderRadius: "12px", background: "linear-gradient(90deg, #F6F6F3, #EEEEEA, #F6F6F3)", backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite" }} /> : null}
          {perDay.length ? (
            <>
              <div style={{ position: "relative", paddingTop: "24px" }}>
                {spike >= 0 && perDay[spike].tokens ? (
                  <span aria-hidden="true" style={{ position: "absolute", top: 0, left: `${Math.min(85, Math.max(15, ((spike + 0.5) / perDay.length) * 100))}%`, transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: "var(--t-caption)", fontWeight: 600, color: "#8A5A00" }}>{`${dayLabel(perDay[spike].date)} · el día de más uso · ${fmt(u, perDay[spike].tokens)}`}</span>
                ) : null}
                <div role="img" aria-label={`Uso diario de los últimos ${days} días; el día de más uso, ${spike >= 0 ? dayLabel(perDay[spike].date) : "ninguno"}`} style={{ display: "flex", alignItems: "flex-end", gap: days > 40 ? "1px" : "4px", height: "120px", paddingBottom: "2px", borderBottom: "1px solid rgba(18,19,26,.12)" }}>
                  {perDay.map((d, i) => (
                    <span key={d.date} title={`${dayLabel(d.date)} · ${fmt(u, d.tokens)}`} style={{ flex: 1, minWidth: 0, height: Math.max(d.tokens ? 3 : 1, Math.round((d.tokens / max) * 112)) + "px", borderRadius: "3px 3px 1px 1px", background: i === spike && d.tokens ? "#B07800" : i === perDay.length - 1 ? INK : "#C3C6CF", animation: "rise .5s ease-out" }} />
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--t-caption)", color: MUTED }}><span>{dayLabel(perDay[0].date)}</span><span style={{ color: INK, fontWeight: 600 }}>{`Hoy · ${fmt(u, today?.tokens || 0)}`}</span></div>
            </>
          ) : null}
        </figure>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: "14px" }}>
        <section {...anchorOf("por-bot-uso")} aria-labelledby="bot-t" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "20px 22px", borderRadius: "20px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
          <h3 id="bot-t" style={h3}>Por bot</h3>
          {spent.map((b) => {
            const bot = botOf(b.botId);
            return (
              <div key={b.botId} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-ui)" }}>
                <span style={{ width: "72px", display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}><BotMark bot={bot} size={12} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot?.name || "Borrado"}</span></span>
                <span aria-hidden="true" style={{ flex: 1, height: "8px", borderRadius: "4px", background: "#F1F1EC", overflow: "hidden" }}><span style={{ display: "block", width: Math.round((b.tokens / top) * 100) + "%", height: "100%", borderRadius: "4px", background: bot?.color || "#C3C6CF", transformOrigin: "left", animation: "grow .8s ease-out" }} /></span>
                <span style={{ width: "72px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(u, b.tokens)}</span>
              </div>
            );
          })}
          {data && !spent.length ? <span style={{ fontSize: "var(--t-ui)", color: MUTED }}>Aún no han gastado nada en este periodo.</span> : null}
        </section>
        <section {...anchorOf("limites-plan")} aria-labelledby="plan-t" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "20px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
          <h3 id="plan-t" style={h3}>Límites de tus planes</h3>
          <Plans plans={data?.plans} />
          <span {...anchorOf("cache")} style={{ fontSize: "var(--t-meta)", color: MUTED }}>
            <Term tip="Cuando el modelo ya ha leído el principio de una conversación, lo reutiliza: responde antes y gasta menos de tu plan.">Caché</Term>{` aprovechada: ${t?.cachePercent ?? "—"} %. Cuanto más alta, más barato y rápido.`}
          </span>
        </section>
      </div>

      <section {...anchorOf("por-chat")} aria-labelledby="chat-t" style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "20px 22px", borderRadius: "20px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
        <h3 id="chat-t" style={{ ...h3, margin: "0 0 6px" }}>Lo que más ha gastado</h3>
        {(all ? chats : chats.slice(0, 4)).map((c) => {
          const href = c.kind === "gone" || c.incognito ? null : c.kind === "room" ? `/sala/${c.missionId}` : `/chat/${c.botIds?.[0] || ""}?c=${c.missionId}`;
          const Tag = href ? "a" : "div";
          return (
            <Tag key={c.missionId} href={href || undefined} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", borderTop: "1px solid rgba(18,19,26,.05)", fontSize: "var(--t-ui)", color: INK, textDecoration: "none" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
              <span style={{ fontSize: "var(--t-meta)", color: MUTED }}>{kind(c)}{expert && t?.tokens ? ` · ${share(c.tokens, t.tokens)} %` : ""}</span>
              <span style={{ width: "80px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(u, c.tokens)}</span>
            </Tag>
          );
        })}
        {chats.length > 4 ? <button type="button" onClick={() => setAll(!all)} style={{ ...btn("ghost", 36), alignSelf: "flex-start", padding: 0, color: "#1F4FD1", fontWeight: 600 }}>{all ? "Ver menos" : `Ver los ${chats.length}`}</button> : null}
        {data && !chats.length ? <span style={{ padding: "10px 0", borderTop: "1px solid rgba(18,19,26,.05)", fontSize: "var(--t-ui)", color: MUTED }}>Ningún chat ni sala ha gastado en este periodo.</span> : null}
      </section>

      <Card label="Límites">
        <Row as="label" first anchor="limite-mensual" title="Límite al mes" sub="Un tope para todo el espacio, aparte del de tu plan. Cuenta todo lo que leen y escriben." min="64px">
          <Select aria-label="Límite al mes" value={limits.monthlyTokens ?? ""} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setLimit({ monthlyTokens: v }, v ? "Límite al mes: " + fmt(u, v) : "Sin límite al mes"); }} style={{ ...select, width: "170px" }} options={LIMITS.map(([v, l]) => [v ?? "", v ? fmt(u, l) : l])} />
        </Row>
        <Row anchor="pausar-limite" title="Pausar al llegar al límite" sub="Terminan el paso en curso y esperan hasta el mes siguiente o hasta que lo subas." min="64px">
          <Switch on={limits.pauseAtLimit !== false} label="Pausar al llegar al límite" onChange={(v) => setLimit({ pauseAtLimit: v }, v ? "Se pausan al llegar al límite" : "No se pausan al llegar al límite")} />
        </Row>
        <Row anchor="aviso-80" title="Avisarme al 80 %" sub="Un aviso en Inicio, sin parar nada." min="64px">
          <Switch on={limits.warnAt80 !== false} label="Avisarme al 80 por ciento" onChange={(v) => setLimit({ warnAt80: v }, v ? "Te avisarán al 80 %" : "Sin aviso al 80 %")} />
        </Row>
        <Row as="label" anchor="pausa-plan" title="Guardar el final del plan para chatear" sub="Cuando a tu plan de IA le queda poco, las rutinas y los trabajos largos esperan a que se renueve. Lo que tú escribes se responde igual, y puedes pulsar «Continuar ahora»." min="64px">
          <Select aria-label="Guardar el final del plan para chatear" value={planPause ?? ""} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setLimit({ planPauseAt: v }, v ? `El trabajo largo espera al ${v} % del plan` : "El trabajo largo no espera por el plan"); }} style={{ ...select, width: "170px" }} options={(PLAN_PAUSE.some(([v]) => v === planPause) ? PLAN_PAUSE : [[planPause, `Al ${planPause} % usado`], ...PLAN_PAUSE]).map(([v, l]) => [v ?? "", l])} />
        </Row>
        <Row anchor="csv" title="Descargar el uso en CSV" min="64px">
          <a href={`/api/usage/history.csv?days=${days}`} download style={{ ...btn("outline", 36), fontSize: "var(--t-ui)" }}>Descargar</a>
        </Row>
      </Card>
    </>
  );
}

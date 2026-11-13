import { useMemo, useState } from "react";
import { Check, Lock } from "../../Icon.js";
import { patch, post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { useStore } from "../../../lib/store.jsx";
import { reversible } from "../../../lib/undoToast.js";
import AppLogo from "../../settings/AppLogo.jsx";
import { ACCESS_LEVELS, KIND_OF, KIND_WORDS, suggestedAccess } from "./effects.js";
import { RED_LINES } from "./redLines.js";
import { BotMark, UNDO_MS, btn } from "./v3.jsx";
import { C } from "../../../lib/theme.js";

// The step after connecting an app account (/permisos/<cuenta>?cuenta=1, from Apps y carpetas):
// what was connected, a name to tell it from another account of the same app, what each of your
// bots may do with it — read, also write, or nothing — with a sensible start (what they already
// had, or reading for all when none had any: reading never changes anything), and the red lines,
// said once. Saving changes each bot's access (PATCH /api/bots/:id, «Deshacer» puts it back) and
// the account's name (POST /api/connections/rename).

export const NAMES = [
  { label: "Personal", dot: C.ok },
  { label: "Trabajo", dot: "var(--c-kind-img)" },
  { label: "Familia", dot: "var(--c-kind-ppt)" },
];
const head = { margin: 0, fontSize: "var(--t-body)", fontWeight: 600 };
const quiet = { fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" };

function Access({ bot, value, onPick }) {
  const items = value === "pide" ? [...ACCESS_LEVELS.slice(0, 2), ["pide", "Lee y pide"], ACCESS_LEVELS[2]] : ACCESS_LEVELS;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", minHeight: "44px", borderTop: "1px solid var(--c-line)" }}>
      <span style={{ flex: "1 1 140px", display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", fontWeight: 500 }}><BotMark bot={bot} size={18} />{bot.name}</span>
      <span role="radiogroup" aria-label={"Qué puede hacer " + bot.name} style={{ display: "inline-flex", padding: "2px", gap: "2px", borderRadius: "var(--r-sm)", background: "var(--c-chip)" }}>
        {items.map(([v, text]) => {
          const on = value === v;
          return <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onPick(v)} style={{ height: "28px", padding: "0 12px", border: 0, borderRadius: "var(--r-xs)", background: on ? "var(--c-selected)" : "transparent", boxShadow: on ? "var(--c-shadow-lift)" : "none", fontSize: "var(--t-meta)", fontWeight: on ? 600 : 500, color: on ? "var(--c-text)" : "var(--c-text-2)", cursor: "pointer" }}>{text}</button>;
        })}
      </span>
    </div>
  );
}

export default function AfterConnect({ account, app, error, busy, name, setName, customName, setCustomName, nameValue, action }) {
  const { bots = [], run } = useStore();
  const team = useMemo(() => bots.filter((b) => b.enabled !== false && b.audience !== "yo"), [bots]);
  const kind = KIND_OF[String(account?.toolkit || "").toLowerCase()] || null;
  const start = useMemo(() => (kind ? suggestedAccess(team, kind) : {}), [kind, team.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [access, setAccess] = useState(null);
  const [lines, setLines] = useState(false);
  const chosen = access || start;
  const fresh = kind && !team.some((b) => (b.tools?.[kind] || "none") !== "none");
  const done = () => action(async () => {
    const changed = kind ? team.filter((b) => (chosen[b.id] || "none") !== (b.tools?.[kind] || "none")) : [];
    const before = changed.map((b) => [b.id, { ...(b.tools || {}) }]);
    for (const b of changed) await patch(`/bots/${encodeURIComponent(b.id)}`, { tools: { ...(b.tools || {}), [kind]: chosen[b.id] } });
    if (account && nameValue.trim() && nameValue.trim() !== account.alias) await post("/connections/rename", { account: account.id, alias: nameValue.trim() });
    if (changed.length) reversible({ id: "after-connect:" + account?.id, text: `Permisos de ${app} guardados`, ms: UNDO_MS, undo: () => run(async () => { for (const [id, tools] of before) await patch(`/bots/${encodeURIComponent(id)}`, { tools }); }) });
    navigate("/ajustes/apps");
  });
  return (
    <div role="dialog" aria-labelledby="ac-t" style={{ width: "min(560px, 100%)", display: "flex", flexDirection: "column", gap: "22px", padding: "28px", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid var(--c-line)", boxShadow: "var(--c-shadow-pop)", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <span style={{ position: "relative", display: "flex", flex: "none" }}>
          <AppLogo id={account?.toolkit} name={app} size={48} />
          <span aria-hidden="true" style={{ position: "absolute", right: "-6px", bottom: "-6px", width: "22px", height: "22px", borderRadius: "var(--r-circle)", background: C.ok, border: "3px solid var(--c-card)", color: C.btnText, display: "grid", placeItems: "center" }}><Check size={10} weight="bold" /></span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <h1 id="ac-t" style={{ margin: 0, font: "600 var(--t-title)/1.25 'Geist', sans-serif" }}>{account ? `${app} está conectado` : "Cuenta conectada"}</h1>
          <span role={error ? "alert" : undefined} style={{ ...quiet, color: error ? "var(--c-error)" : quiet.color }}>{error || "Colmena guarda el permiso que diste, nunca tu contraseña. Puedes desconectarla cuando quieras en Apps y carpetas."}</span>
        </span>
      </div>

      <section aria-labelledby="ac-name" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <h2 id="ac-name" style={head}>Cómo la llamas</h2>
          <span style={quiet}>Para distinguirla si conectas otra cuenta de {app}.</span>
        </span>
        <div role="radiogroup" aria-label="Nombre de la cuenta" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {NAMES.map((n) => {
            const on = customName === null && n.label === name;
            return (
              <button key={n.label} type="button" role="radio" aria-checked={on} onClick={() => { setName(n.label); setCustomName(null); }} style={{ height: "32px", border: on ? "1px solid var(--c-btn)" : "1px solid var(--c-line)", padding: "0 12px", borderRadius: "var(--r-sm)", fontSize: "var(--t-meta)", fontWeight: 500, display: "flex", alignItems: "center", gap: "8px", background: on ? "var(--c-btn)" : "var(--c-card)", color: on ? "var(--c-btn-text)" : C.text, cursor: "pointer" }}>
                <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "var(--r-circle)", background: n.dot }} />{n.label}
              </button>
            );
          })}
        </div>
        <input className="c-quiet" type="text" aria-label="Nombre de la cuenta" value={nameValue} maxLength={80} onChange={(e) => setCustomName(e.target.value)} style={{ height: "36px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-card)", padding: "0 12px", fontFamily: "inherit", fontSize: "var(--t-ui)", color: "var(--c-text)" }} />
      </section>

      {kind && team.length ? (
        <section aria-labelledby="ac-access" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "6px" }}>
            <h2 id="ac-access" style={head}>{`Qué pueden hacer tus bots con ${KIND_WORDS[kind] || app}`}</h2>
            <span style={quiet}>{fresh ? "Empiezan leyendo, que nunca cambia nada. Dale «Escribe» solo a quien lo necesite." : `Como ya tenían con ${KIND_WORDS[kind] || "este tipo de app"}. Cámbialo si quieres.`}</span>
          </span>
          {team.map((b) => <Access key={b.id} bot={b} value={chosen[b.id] || "none"} onPick={(v) => setAccess({ ...chosen, [b.id]: v })} />)}
          <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", ...quiet }}>
            {ACCESS_LEVELS.map(([v, l, what]) => <div key={v} style={{ display: "contents" }}><dt style={{ fontWeight: 600, color: "var(--c-text-2)" }}>{l}</dt><dd style={{ margin: 0 }}>{what}</dd></div>)}
          </dl>
        </section>
      ) : (
        <p style={{ margin: 0, ...quiet }}>{`Tus bots pueden leer ${app} sin preguntarte; cambiar algo, con tu OK. Qué puede hacer cada uno se ajusta en Autonomía y permisos.`}</p>
      )}

      <section aria-label="Líneas rojas" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--c-hover)" }}>
        <span style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "var(--t-ui)", lineHeight: 1.5 }}>
          <Lock size={16} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />
          <span>Aunque elijas «Escribe», <strong style={{ fontWeight: 600 }}>enviar, pagar o comprar, publicar y borrar de verdad siempre te preguntan</strong>: son las líneas rojas, y nada puede saltárselas. Leer nunca te pregunta.</span>
        </span>
        <button type="button" aria-expanded={lines} onClick={() => setLines(!lines)} style={{ ...btn("ghost", 30), alignSelf: "flex-start", padding: "0 0 0 26px", color: "var(--c-accent-ink)" }}>{lines ? "Ocultar las líneas rojas" : "Ver todas las líneas rojas"}</button>
        {lines ? (
          <ul style={{ margin: 0, padding: "0 0 0 26px", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px", ...quiet }}>
            {RED_LINES.map(([t, why]) => <li key={t}><strong style={{ fontWeight: 600, color: "var(--c-text-2)" }}>{t}</strong> · {why}</li>)}
          </ul>
        ) : null}
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" disabled={busy} onClick={() => navigate("/ajustes/apps")} style={btn("ghost", 40)}>Ahora no</button>
        <button type="button" disabled={busy || !account || !nameValue.trim()} onClick={done} style={btn("dark", 40)}>{busy ? "Guardando…" : "Guardar y terminar"}</button>
      </div>
      <span style={{ ...quiet, textAlign: "right", marginTop: "-14px" }}>«Ahora no» deja la cuenta conectada con lo que tus bots ya tenían.</span>
    </div>
  );
}


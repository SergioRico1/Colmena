import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { DESKTOP_GAINS } from "./DesktopRoute.jsx";

// The desktop app in cloud mode, the first time a company opens on this computer: what the app
// adds to the company the person already has on the web, in three short steps (each skippable).
// The guided start of a new company (src/cloud/Setup.jsx, /empezar) goes first when it is due;
// this only says what the computer adds. Seen once per company on this computer (localStorage).
const KEY = (id) => "colmena.desktopWelcome." + id;
const seenHere = (id) => { try { return !!localStorage.getItem(KEY(id)); } catch { return true; } };
const markSeen = (id) => { try { localStorage.setItem(KEY(id), String(Date.now())); } catch {} };

const btn = (strong) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "40px", padding: "0 18px", borderRadius: "var(--r-pill)", border: strong ? 0 : "1px solid var(--c-line-strong)", background: strong ? "var(--c-btn)" : "transparent", color: strong ? "var(--c-btn-text)" : "var(--c-text)", font: "600 var(--t-ui)/1 'Geist', sans-serif", cursor: "pointer", whiteSpace: "nowrap" });

export default function DesktopWelcome({ bridge }) {
  const { ready, cloud = null, ai = null } = useStore();
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(false);
  const box = useRef(null);
  const id = cloud?.workspace?.id || null;
  const guided = cloud?.onboarding?.started && !cloud.onboarding.finished;
  useEffect(() => {
    if (!bridge || !ready || !id || shown || guided || location.pathname.startsWith("/empezar")) return;
    if (!seenHere(id)) setShown(true);
  }, [bridge, ready, id, guided, shown]);
  useEffect(() => { if (shown) box.current?.focus(); }, [shown, step]);
  if (!shown) return null;
  const close = () => { markSeen(id); setShown(false); };
  const connected = (ai?.engines || []).filter((e) => e.connected);
  const company = cloud?.workspace?.name || "tu empresa";
  const steps = [
    {
      kicker: "Bienvenido",
      title: `${company}, ahora en tu ordenador`,
      body: <p style={P}>{"Es la misma empresa que en la web: los mismos canales, bots y tareas. Todo sigue guardado en la nube, así que puedes pasar de una a otra cuando quieras."}</p>,
    },
    {
      kicker: "Este ordenador",
      title: "Lo que añade la app",
      body: (
        <>
          <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" }}>
            {DESKTOP_GAINS.filter((g) => !/misma empresa/i.test(g)).map((g) => <li key={g}>{g}</li>)}
          </ul>
          <p style={P}>{"Tú decides qué presta este ordenador: nada se comparte hasta que lo eliges."}</p>
        </>
      ),
      extra: bridge?.openAgentSettings ? <button type="button" style={btn(false)} onClick={() => bridge.openAgentSettings().catch(() => {})}>{"Elegir qué presta"}</button> : null,
    },
    {
      kicker: "Tu IA",
      title: connected.length ? "Tus bots ya pueden trabajar" : "Conecta tu cuenta de IA",
      body: <p style={P}>{connected.length
        ? `Cuando trabajan para ti, piensan con ${connected.map((e) => e.label).join(", ")}. En «Ajustes › Tu cuenta de IA» eliges también el modelo de cada bot.`
        : "Los bots usan la cuenta de IA de quien les pide algo. Conecta ChatGPT, Claude u otra para que trabajen para ti."}</p>,
      extra: connected.length ? null : <button type="button" style={btn(false)} onClick={() => { close(); navigate("/ajustes/ia"); }}>{"Conectar mi IA"}</button>,
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(18, 19, 26, 0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 16px 32px" }}
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bienvenida-escritorio-t"
        style={{ width: "min(520px, 100%)", background: "var(--c-card)", borderRadius: "var(--r-xl)", boxShadow: "0 24px 64px rgb(0 0 0 / .25)", display: "flex", flexDirection: "column", gap: "14px", padding: "24px 24px 20px", outline: "none", animation: "rise .25s ease-out" }}>
        <span style={{ font: "500 var(--t-caption)/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-text-3)" }}>{`${s.kicker} · ${step + 1} de ${steps.length}`}</span>
        <h2 id="bienvenida-escritorio-t" style={{ margin: 0, font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{s.title}</h2>
        {s.body}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginTop: "6px" }}>
          {s.extra}
          <span style={{ flex: "1 1 auto" }} />
          {!last ? <button type="button" onClick={close} style={{ ...btn(false), border: 0, color: "var(--c-text-3)" }}>{"Saltar"}</button> : null}
          <button type="button" style={btn(true)} onClick={() => (last ? close() : setStep(step + 1))}>{last ? "Empezar" : "Siguiente"}</button>
        </div>
      </div>
    </div>
  );
}

const P = { margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.55, color: "var(--c-text-2)" };

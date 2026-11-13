import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Shield } from "../components/Icon.js";
import { css } from "../design/css/Permissions.js";
import { get, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { appName, loadAccounts } from "../components/settings/connections.jsx";
import Shell from "../components/v2/Shell.jsx";
import AppLogo from "../components/settings/AppLogo.jsx";
import { SkeletonLines } from "../components/Skeleton.jsx";

// Port of the NEXO 09c dialogs (design/Permissions.dc.html): only the relevant dialog is shown.
//  /permisos/<cuenta>?cuenta=1 → name the account after connecting
//  /permisos/<aprobación>      → read review or send review (hold 1.2 s to send)
const NAMES = [
  { label: "Personal", dot: "#0B8A5F" },
  { label: "Trabajo", dot: "#7D5A78" },
  { label: "Familia", dot: "#A9803F" },
];
const HOLD_MS = 1200;
const EXTRA = "\nbutton:focus-visible,input:focus-visible{outline:2px solid #12131A;outline-offset:2px}\nbutton:not(:disabled){cursor:pointer}\nbutton:disabled{opacity:.6}";
// v2 sheet: white, 30 px corners, calm shadow; a request that waits for you glows honey.
const CALM = "0 1px 2px rgba(18,19,26,.05), 0 30px 70px -36px rgba(18,19,26,.35)";
const HONEY = "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)";
const dialog = { width: "min(480px, 100%)", borderRadius: "var(--r-3xl)", background: "var(--c-card)", border: "0", display: "flex", flexDirection: "column", boxShadow: CALM, animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" };

function Brand({ chip, tone }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <img src="/colmena-icon-128.png" alt="" width="24" height="24" style={{ display: "block", width: "24px", height: "24px" }} />
      <span style={{ fontSize: "var(--t-ui)", fontWeight: "600", flexGrow: "1" }}>Colmena</span>
      <span style={{ height: "26px", display: "flex", alignItems: "center", padding: "0 11px", borderRadius: "var(--r-pill)", fontSize: "var(--t-caption)", fontWeight: "600", ...(tone === "warn" ? { background: "var(--c-error-soft)", color: "var(--c-error)" } : { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" }) }}>{chip}</span>
    </div>
  );
}

export default function Permissions({ params, query = {} }) {
  const id = params.id;
  const naming = query.cuenta !== undefined;
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState(null);
  const [name, setName] = useState("Personal");
  const [customName, setCustomName] = useState(null);
  const [review, setReview] = useState(null);
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [hold, setHold] = useState(0);
  const holdTimer = useRef(null);
  const holdStart = useRef(0);
  const busyRef = useRef(false);

  const action = useCallback(async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message || "No se pudo completar la operación.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    action(async () => {
      if (naming) {
        const all = await loadAccounts();
        const found = all.find((a) => a.id === id);
        if (!found) throw Error("Esta cuenta aún no aparece en el servicio de conexiones. Espera unos segundos y vuelve a abrirla desde Apps conectadas.");
        setAccount(found);
        // A second account of the same app gets a name the first one does not use.
        const label = appName(found.toolkit);
        const taken = new Set(all.filter((a) => a.id !== found.id && a.toolkit === found.toolkit).map((a) => String(a.alias || "").toLowerCase()));
        const own = String(found.alias || "");
        const preset = NAMES.find((n) => [n.label.toLowerCase(), `${label} ${n.label}`.toLowerCase()].includes(own.toLowerCase()));
        if (preset && !taken.has(own.toLowerCase())) setName(preset.label);
        else if (own && own !== found.toolkit && !taken.has(own.toLowerCase())) setCustomName(own);
        else setName((NAMES.find((n) => !taken.has(`${label} ${n.label}`.toLowerCase())) || NAMES[0]).label);
      } else {
        const r = await get(`/connections/review/${encodeURIComponent(id)}`);
        setReview(r);
        if (r.status !== "pending") setError(r.result?.error || "Esta solicitud ya está resuelta.");
      }
    }).finally(() => setLoaded(true));
  }, [id, naming, action]);

  const stopHold = useCallback(() => {
    clearInterval(holdTimer.current);
    holdTimer.current = null;
    holdStart.current = 0;
    setHold(0);
  }, []);
  useEffect(() => {
    const hidden = () => document.hidden && stopHold();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      clearInterval(holdTimer.current);
    };
  }, [stopHold]);

  const decide = (decision) => {
    stopHold();
    return action(async () => {
      const data = await post(`/connections/review/${encodeURIComponent(id)}`, { decision, revision: review?.revision || "", remember: remember && review?.kind === "read" });
      if (data?.error) {
        setReview({ ...review, status: "executed" });
        throw Error(data.error);
      }
      navigate("/bandeja");
    });
  };
  const disabled = busy || !loaded || (review && review.status !== "pending");
  const beginHold = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (holdTimer.current || disabled) return;
    holdStart.current = Date.now();
    holdTimer.current = setInterval(() => {
      const elapsed = Date.now() - holdStart.current;
      if (elapsed >= HOLD_MS) decide("approved");
      else setHold(elapsed / HOLD_MS);
    }, 40);
  };
  const keyHold = (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      beginHold(e);
    }
  };

  const p = review?.review;
  const app = appName(naming ? account?.toolkit : p?.toolkit) || "La app";
  const kind = naming ? "name" : review?.kind || "read";
  const nameValue = customName ?? `${app} ${name.toLowerCase()}`;
  const args = p?.arguments || {};
  const list = (v) => (Array.isArray(v) ? v.join(", ") : v || "");

  return (
    <Shell active="hoy" extraCss={css + EXTRA}>
      <div style={{ minHeight: "100%", boxSizing: "border-box", color: "var(--c-text)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "72px 16px 40px" }}>
        {!loaded ? <div style={{ ...dialog, padding: "26px" }}><SkeletonLines lines={4} /></div> : null}

        {loaded && !naming && !review ? (
          <div role="dialog" aria-label="Solicitud no encontrada" style={{ ...dialog, padding: "26px", gap: "18px" }}>
            <Brand chip="Sin cambios" />
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Esta solicitud ya no está</span>
              <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)", lineHeight: "1.5" }}>Puede que ya la decidieras, que caducara o que se borrara su sala. No se ha hecho nada en tu cuenta. Lo que siga pendiente está en Hoy.</span>
            </div>
            <button type="button" onClick={() => navigate("/bandeja")} style={{ height: "46px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "600" }}>Ir a Hoy</button>
          </div>
        ) : null}

        {loaded && kind === "name" ? (
          <div role="dialog" aria-label="Nombrar la cuenta" style={{ ...dialog, padding: "28px", gap: "22px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", textAlign: "center" }}>
              <span style={{ position: "relative", display: "flex" }}>
                <AppLogo id={account?.toolkit} name={app} size={56} />
                <span style={{ position: "absolute", right: "-6px", bottom: "-6px", width: "24px", height: "24px", borderRadius: "var(--r-circle)", background: "#0B8A5F", border: "3px solid #FFFFFF", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={11} weight="bold" />
                </span>
              </span>
              <span style={{ font: "600 var(--t-heading)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{account ? `${app} está conectado` : "Cuenta conectada"}</span>
              <span role={error ? "alert" : undefined} style={{ fontSize: "var(--t-ui)", color: error ? "var(--c-error)" : "var(--c-text-3)", lineHeight: "1.5" }}>{error || "¿Cómo quieres llamar a esta cuenta? Así sabrás cuál usa Colmena."}</span>
            </div>
            <div role="radiogroup" aria-label="Nombre de la cuenta" style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
              {NAMES.map((n) => {
                const on = customName === null && n.label === name;
                return (
                  <button key={n.label} type="button" role="radio" aria-checked={on} onClick={() => { setName(n.label); setCustomName(null); }} style={{ height: "40px", border: "0", padding: "0 16px", borderRadius: "var(--r-pill)", fontSize: "var(--t-ui)", fontWeight: "500", display: "flex", alignItems: "center", gap: "8px", background: on ? "var(--c-btn)" : "rgb(var(--c-ink-rgb) / .05)", color: on ? "var(--c-btn-text)" : "#12131A" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "var(--r-circle)", background: n.dot }} />
                    {n.label}
                  </button>
                );
              })}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>O escribe otro nombre</span>
              <input className="c-quiet" type="text" value={nameValue} maxLength={80} onChange={(e) => setCustomName(e.target.value)} style={{ height: "46px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-sunken)", padding: "0 18px", fontFamily: "inherit", fontSize: "var(--t-body)", color: "var(--c-text)" }} />
            </label>
            <button type="button" disabled={busy || !account || !nameValue.trim()} onClick={() => action(async () => {
              await post("/connections/rename", { account: account.id, alias: nameValue.trim() });
              navigate("/ajustes/conexiones");
            })} style={{ height: "48px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: "500" }}>{busy ? "Guardando…" : "Listo"}</button>
          </div>
        ) : null}

        {loaded && kind === "read" && (naming || review) ? (
          <div role="dialog" aria-label="Permitir lectura" style={{ ...dialog, padding: "28px", gap: "18px", boxShadow: review?.status === "pending" ? HONEY : CALM }}>
            <Brand chip="Solo lectura" />
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ font: "600 var(--t-heading)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{p ? `¿Puedo consultar ${app}?` : "Revisar permiso"}</span>
              <span role={error ? "alert" : undefined} style={{ fontSize: "var(--t-ui)", color: error ? "var(--c-error)" : "var(--c-text-3)", lineHeight: "1.5" }}>{error || "Solo se consultarán los datos indicados. No se modificará tu cuenta."}</span>
            </div>
            {p ? (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "var(--r-xl)", background: "var(--c-hover)" }}>
                <AppLogo id={p.toolkit} name={app} size={36} />
                <span style={{ flexGrow: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "1px" }}>
                  <span style={{ fontSize: "var(--t-ui)", fontWeight: "500" }}>{`${app} · ${p.account_alias || "Sin cuenta"}`}</span>
                  <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{p.name || ""}</span>
                </span>
              </div>
            ) : null}
            {p ? (
              <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ alignSelf: "flex-start", height: "32px", border: "0", padding: "0", background: "transparent", fontSize: "var(--t-meta)", color: "var(--c-text-3)", display: "flex", alignItems: "center", gap: "6px" }}>
                Detalles técnicos
                <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none" }} />
              </button>
            ) : null}
            {p && open ? (
              <div style={{ marginTop: "-10px", padding: "12px 14px", borderRadius: "var(--r-lg)", background: "#12131A", color: "#C9CCD6", fontFamily: "'Geist Mono', monospace", fontSize: "var(--t-micro)", lineHeight: "1.7", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "240px", overflow: "auto" }}>
                {`${p.tool}\n${JSON.stringify(p.arguments, null, 2)}\nCuenta: ${p.account}`}
              </div>
            ) : null}
            {p ? (
              <button type="button" role="checkbox" aria-checked={remember} onClick={() => setRemember(!remember)} style={{ border: "0", background: "transparent", padding: "0", textAlign: "left", display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-meta)", color: "var(--c-text)", minHeight: "32px" }}>
                <span style={{ width: "20px", height: "20px", borderRadius: "var(--r-sm)", flexShrink: "0", background: remember ? "var(--c-btn)" : "var(--c-card)", boxShadow: remember ? "none" : "inset 0 0 0 1.5px #C7C7CC", color: "var(--c-btn-text)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={11} weight="bold" />
                </span>
                {`No volver a preguntar para estas lecturas en ${app}`}
              </button>
            ) : null}
            <div style={{ display: "flex", gap: "8px" }}>
              {review && review.status !== "pending" ? (
                <button type="button" onClick={() => navigate("/bandeja")} style={{ flexGrow: "1", height: "46px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "500" }}>Volver a Hoy</button>
              ) : (
                <>
                  <button type="button" disabled={disabled} onClick={() => decide("denied")} style={{ height: "46px", border: "0", padding: "0 18px", borderRadius: "var(--r-pill)", background: "var(--c-card)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .1)", fontSize: "var(--t-ui)", fontWeight: "500" }}>No permitir</button>
                  <button type="button" disabled={disabled} onClick={() => decide("approved")} style={{ flexGrow: "1", height: "46px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "500" }}>{busy ? "Un momento…" : "Aprobar"}</button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {loaded && kind === "send" ? (
          <div role="dialog" aria-label="Confirmar envío" style={{ ...dialog, padding: "28px", gap: "18px", boxShadow: review?.status === "pending" ? HONEY : CALM }}>
            <Brand chip="No se puede deshacer" tone="warn" />
            <span role={error ? "alert" : undefined} style={{ font: "600 var(--t-heading)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", color: error ? "var(--c-error)" : undefined }}>{error || `Voy a enviar este correo desde ${app} · ${p?.account_alias || ""}`}</span>
            <div style={{ borderRadius: "var(--r-lg)", boxShadow: "0 0 0 1px rgba(0,0,0,0.08)", overflow: "hidden", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-meta)", borderBottom: "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
                <span><span style={{ color: "var(--c-text-3)", display: "inline-block", width: "56px" }}>Para</span>{list([].concat(args.recipient_email || [], args.extra_recipients || []))}</span>
                {list(args.cc) ? <span><span style={{ color: "var(--c-text-3)", display: "inline-block", width: "56px" }}>Cc</span>{list(args.cc)}</span> : null}
                {list(args.bcc) ? <span><span style={{ color: "var(--c-text-3)", display: "inline-block", width: "56px" }}>Cco</span>{list(args.bcc)}</span> : null}
                <span><span style={{ color: "var(--c-text-3)", display: "inline-block", width: "56px" }}>Asunto</span>{args.subject || ""}</span>
              </div>
              <div style={{ padding: "14px 16px", fontSize: "var(--t-ui)", lineHeight: "1.55", color: "var(--c-text-2)", maxHeight: "40vh", overflow: "auto" }}>{args.body || ""}</div>
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "var(--t-meta)", lineHeight: "1.5", color: "var(--c-text-3)" }}>
              <Shield size={16} color="#B4372A" style={{ flexShrink: "0", marginTop: "1px" }} />
              Una vez enviado no se puede recuperar, aunque detengas a Colmena.
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {review && review.status !== "pending" ? (
                <button type="button" onClick={() => navigate("/bandeja")} style={{ flexGrow: "1", height: "50px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "500" }}>Volver a Hoy</button>
              ) : (
                <>
                  <button type="button" disabled={disabled} onClick={() => navigate(`/bandeja/${encodeURIComponent(id)}/editar`)} style={{ height: "50px", border: "0", padding: "0 18px", borderRadius: "var(--r-pill)", background: "var(--c-card)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .1)", fontSize: "var(--t-ui)", fontWeight: "500" }}>Editar</button>
                  <button type="button" disabled={disabled} aria-describedby="mantener" onPointerDown={beginHold} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onKeyDown={keyHold} onKeyUp={stopHold} onBlur={stopHold} onContextMenu={(e) => e.preventDefault()}
                    style={{ flexGrow: "1", position: "relative", overflow: "hidden", height: "50px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "500", touchAction: "none", userSelect: "none" }}>
                    <span style={{ position: "absolute", left: "0", top: "0", bottom: "0", width: `${Math.min(100, hold * 100)}%`, background: "rgba(255,255,255,.26)" }} />
                    <span style={{ position: "relative" }}>{busy ? "Enviando…" : "Mantén para enviar"}</span>
                  </button>
                </>
              )}
            </div>
            <span id="mantener" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}>Mantén pulsado el botón, o la barra espaciadora, durante algo más de un segundo para enviar. Un clic corto no envía.</span>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

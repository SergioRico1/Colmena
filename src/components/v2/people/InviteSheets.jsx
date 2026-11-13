import { useState } from "react";
import { Copy, X } from "lucide-react";
import { patch, post } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { navigate } from "../../../lib/router.jsx";
import { shareUrl } from "../../../lib/peers.js";
import { lacksOwnName } from "../../../lib/ownName.js";
import { DIALOG_VEIL, useDialogFocus } from "../../../lib/useDialogFocus.js";

// «Hablar con una persona» and «Tengo una invitación» (design/V2Personas.dc.html, paso
// invitar / aceptar). Colmena never sends the invitation: you copy it and send it yourself.
// The invitation says who you are («Hola Marta, soy Sergio…»): when Colmena does not know your
// name yet, the sheet asks for it first and keeps it as your name (Ajustes › Tu nombre).
const veil = { position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: "24px", background: DIALOG_VEIL, animation: "fade .25s ease-out" };
const card = (w) => ({ width: `min(${w}px, 100%)`, maxHeight: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "22px", padding: "28px", borderRadius: "var(--r-3xl)", background: "rgba(255,255,255,.97)", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55), 0 0 0 1px rgba(18,19,26,.06)", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)", boxSizing: "border-box" });
const dark = (on = true) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "46px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", cursor: on ? "pointer" : "default", fontSize: "var(--t-ui)", fontWeight: 600, background: on ? "var(--c-btn)" : "#C9CBD1", color: "var(--c-btn-text)" });
const quiet = { height: "44px", padding: "0 18px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text-3)" };

function Close({ onClose }) {
  return (
    <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "rgb(var(--c-ink-rgb) / .06)", cursor: "pointer" }}>
      <X size={15} strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
}
const Steps = ({ items }) => (
  <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "12px" }}>
    {items.map((text, i) => (
      <li key={i} style={{ display: "flex", gap: "12px", fontSize: "var(--t-body)", lineHeight: 1.5 }}>
        <span aria-hidden="true" style={{ width: "26px", height: "26px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "rgb(var(--c-ink-rgb) / .06)", font: "600 var(--t-caption)/1 'Geist Mono', monospace" }}>{i + 1}</span>
        <span>{text}</span>
      </li>
    ))}
  </ol>
);

export function InviteSheet({ onClose, initialName = "" }) {
  const box = useDialogFocus({ onEscape: onClose });
  const store = useStore();
  const [name, setName] = useState(initialName);
  // Asked once, when the sheet opens without a name of yours; it stays while you type it.
  const [nameless] = useState(() => lacksOwnName(store));
  const [mine, setMine] = useState("");
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const make = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (nameless) await store.run(() => patch("/settings", { userName: mine.trim() }));
      setMade(await post("/peers/invites", { name: name.trim() }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(made.text);
      setCopied(true);
    } catch {
      setError("No se pudo copiar. Selecciona el texto y cópialo tú.");
    }
  };
  const first = (made?.name || name).split(/\s+/)[0] || "esa persona";
  const ready = !!name.trim() && (!nameless || mine.trim().length >= 2);
  return (
    <div style={veil} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={box} role="dialog" aria-modal="true" aria-labelledby="inv-t" style={card(560)}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h2 id="inv-t" style={{ margin: 0, font: "600 var(--t-heading)/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{made ? "Invitación para " + first : "Hablar con una persona"}</h2>
            <span style={{ fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{made ? "Cópiala y mándasela. Cuando la pegue en su Colmena, comprobaréis las palabras." : "Para chatear con alguien que también usa Colmena, en su propio ordenador."}</span>
          </span>
          <Close onClose={onClose} />
        </div>
        {!made ? (
          <>
            {nameless ? (
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-ui)", fontWeight: 600 }}>
                {"Tu nombre"}
                <input className="c-quiet" autoFocus type="text" value={mine} maxLength={80} autoComplete="name" onChange={(e) => setMine(e.target.value)} placeholder="Como quieres que te vean"
                  style={{ height: "46px", padding: "0 18px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-sunken)", fontSize: "var(--t-read)", fontWeight: 400 }} />
                <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, fontWeight: 400, color: "var(--c-text-3)" }}>{"La invitación empieza por «Hola, soy…». Se guarda como tu nombre en Colmena; puedes cambiarlo en Ajustes."}</span>
              </label>
            ) : null}
            <div className="c-ring" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 18px", borderRadius: "var(--r-pill)", background: "var(--c-sunken)" }}>
              <label style={{ flex: 1, display: "flex" }}>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Nombre de la otra persona"}</span>
                <input className="c-bare" autoFocus={!nameless} type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") make(); }} placeholder="¿Cómo se llama la otra persona?" style={{ flex: 1, minWidth: 0, height: "44px", border: 0, background: "transparent", fontSize: "var(--t-read)" }} />
              </label>
              <button type="button" onClick={make} disabled={!ready || busy} style={dark(ready && !busy)}>{busy ? "Creando…" : "Crear invitación"}</button>
            </div>
            <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{"Te daré un código que sirve una sola vez y caduca en 24 horas, con un mensaje listo para mandárselo tú por WhatsApp o correo. Colmena no escribe a nadie por ti."}</span>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "18px", borderRadius: "var(--r-2xl)", background: "var(--c-sunken)", animation: "rise .3s ease-out" }}>
              {/* Exactly what is copied: who you are, where to get Colmena, the code. */}
              {/* Its link opens Colmena's downloads page on GitHub, not an installer: the steps below say so. */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text)", userSelect: "text" }}>
                {made.text.split("\n").map((line, i) => line === made.code
                  ? <code key={i} style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--c-card)", font: "500 var(--t-body)/1 'Geist Mono', monospace", letterSpacing: "0.04em", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .08)", userSelect: "all" }}>{line}</code>
                  : <span key={i} style={{ overflowWrap: "anywhere" }}>{line}</span>)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <button type="button" onClick={copy} style={dark()}><Copy size={15} strokeWidth={2.2} aria-hidden="true" />{copied ? "Copiada" : "Copiar invitación"}</button>
                <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Sirve una vez · caduca en 24 horas"}</span>
              </div>
            </div>
            <Steps items={[
              "Se la mandas tú: Colmena no escribe a nadie por ti.",
              `Si ${first} no tiene Colmena, el enlace del mensaje abre su página de descargas en GitHub: ahí elige el instalador de Windows o de Mac, que es gratis. Después pulsa «Tengo una invitación» y pega el código.`,
              "Os saldrán las mismas cuatro palabras a los dos. Decíoslas en persona o por teléfono: si coinciden, nadie se ha puesto en medio.",
            ]} />
          </>
        )}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</p> : null}
      </section>
    </div>
  );
}

export function AcceptSheet({ onClose }) {
  const box = useDialogFocus({ onEscape: onClose });
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const look = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try { setPreview(await post("/peers/invites/preview", { code: code.trim() })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const accept = async () => {
    setBusy(true);
    setError(null);
    try { setDone(await post("/peers/invites/accept", { code: code.trim() })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const first = (preview?.name || "").split(/\s+/)[0] || "esa persona";
  return (
    <div style={veil} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={box} role="dialog" aria-modal="true" aria-labelledby="acc-t" style={{ ...card(520), alignItems: preview ? "center" : "stretch", textAlign: preview ? "center" : "left", gap: "20px" }}>
        {!preview ? (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <h2 id="acc-t" style={{ margin: 0, font: "600 var(--t-heading)/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Tengo una invitación"}</h2>
                <span style={{ fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{"Pega el código que te han mandado. Empieza por COLMENA-."}</span>
              </span>
              <Close onClose={onClose} />
            </div>
            <div className="c-ring" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 18px", borderRadius: "var(--r-pill)", background: "var(--c-sunken)" }}>
              <label style={{ flex: 1, display: "flex" }}>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Código de invitación"}</span>
                <input className="c-bare" autoFocus type="text" value={code} maxLength={400} onChange={(e) => { const m = /COLMENA[-\s]*(?:[0-9A-Z]{4}[-\s]*){4}/i.exec(e.target.value); setCode(m ? m[0] : e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") look(); }} placeholder="COLMENA-XXXX-XXXX-XXXX-XXXX" spellCheck={false} style={{ flex: 1, minWidth: 0, height: "44px", border: 0, background: "transparent", font: "500 var(--t-body)/1 'Geist Mono', monospace", letterSpacing: "0.03em" }} />
              </label>
              <button type="button" onClick={look} disabled={!code.trim() || busy} style={dark(!!code.trim() && !busy)}>{busy ? "Buscando…" : "Continuar"}</button>
            </div>
            <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{"¿No tienes código? Pídeselo a quien quiera hablar contigo: lo crea en su Colmena con «Invitar a alguien». Puedes pegar el mensaje entero, Colmena encuentra el código."}</span>
          </>
        ) : (
          <>
            <span style={{ font: "500 var(--t-caption)/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-text-3)" }}>{"Invitación"}</span>
            <span aria-hidden="true" style={{ width: "68px", height: "68px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "var(--c-btn)", color: "var(--c-btn-text)", font: "600 var(--t-title)/1 'Geist', sans-serif", animation: "pop .5s ease-out" }}>{preview.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h2 id="acc-t" style={{ margin: 0, font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{done ? "Conectada con " + first : preview.room ? preview.name + " te invita a «" + preview.room + "»" : preview.name + " te invita a hablar"}</h2>
              <span style={{ fontSize: "var(--t-body)", lineHeight: 1.55, color: "var(--c-text-3)" }}>{done ? "Sus mensajes llegan cerrados con llave: solo los abre tu ordenador." : "Os escribiréis desde Colmena, cada uno en su ordenador y con sus bots."}</span>
            </span>
            {!done ? (
              <>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px", padding: "18px", borderRadius: "var(--r-2xl)", background: "var(--c-sunken)", boxSizing: "border-box" }}>
                  <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{`Pídele a ${first} que te diga las suyas. Deben ser estas:`}</span>
                  <span style={{ font: "600 var(--t-title)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{preview.words.join(" · ")}</span>
                  <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>{`Si coinciden, la invitación es de verdad de ${first} y nadie se ha puesto en medio. Si no, no conectes.`}</span>
                </div>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button type="button" onClick={accept} disabled={busy} style={{ ...dark(!busy), height: "50px", fontSize: "var(--t-body)" }}>{busy ? "Conectando…" : `Coinciden · conectar con ${first}`}</button>
                  <button type="button" onClick={onClose} style={quiet}>{"No coinciden o no le conozco"}</button>
                </div>
                <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{`${first} solo verá lo que le escribas y lo que tú decidas compartir.`}</span>
              </>
            ) : (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", borderRadius: "var(--r-pill)", background: "var(--c-ok-soft)", color: "var(--c-ok-ink)", fontSize: "var(--t-body)", fontWeight: 600, animation: "develop .5s ease-out" }}>{"Ya podéis escribiros"}</span>
                <button type="button" onClick={() => { onClose(); navigate(shareUrl(done.dm)); }} style={{ ...dark(), height: "48px", fontSize: "var(--t-body)" }}>{"Abrir la conversación"}</button>
              </>
            )}
          </>
        )}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</p> : null}
      </section>
    </div>
  );
}

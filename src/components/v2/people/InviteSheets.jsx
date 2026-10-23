import { useEffect, useState } from "react";
import { Copy, X } from "lucide-react";
import { post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { shareUrl } from "../../../lib/peers.js";

// «Hablar con una persona» and «Tengo una invitación» (design/V2Personas.dc.html, paso
// invitar / aceptar). Colmena never sends the invitation: you copy it and send it yourself.
const veil = { position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: "24px", background: "rgba(18,19,26,.28)", WebkitBackdropFilter: "blur(6px)", backdropFilter: "blur(6px)", animation: "fade .25s ease-out" };
const card = (w) => ({ width: `min(${w}px, 100%)`, maxHeight: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: "22px", padding: "28px", borderRadius: "32px", background: "rgba(255,255,255,.97)", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55), 0 0 0 1px rgba(18,19,26,.06)", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)", boxSizing: "border-box" });
const dark = (on = true) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "46px", padding: "0 20px", border: 0, borderRadius: "999px", cursor: on ? "pointer" : "default", fontSize: "14px", fontWeight: 600, background: on ? "#12131A" : "#C9CBD1", color: "#FFFFFF" });
const quiet = { height: "44px", padding: "0 18px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: "#5C606C" };

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
function Close({ onClose }) {
  return (
    <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.06)", cursor: "pointer" }}>
      <X size={15} strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
}
const Steps = ({ items }) => (
  <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "12px" }}>
    {items.map((text, i) => (
      <li key={i} style={{ display: "flex", gap: "12px", fontSize: "15px", lineHeight: 1.5 }}>
        <span aria-hidden="true" style={{ width: "26px", height: "26px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: "rgba(18,19,26,.06)", font: "600 12px/1 'Geist Mono', monospace" }}>{i + 1}</span>
        <span>{text}</span>
      </li>
    ))}
  </ol>
);

export function InviteSheet({ onClose, initialName = "" }) {
  useEscape(onClose);
  const [name, setName] = useState(initialName);
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const make = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try { setMade(await post("/peers/invites", { name: name.trim() })); } catch (e) { setError(e.message); } finally { setBusy(false); }
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
  return (
    <div style={veil} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="inv-t" style={card(560)}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h2 id="inv-t" style={{ margin: 0, font: "600 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{made ? "Invitación para " + first : "Hablar con una persona"}</h2>
            <span style={{ fontSize: "15px", lineHeight: 1.5, color: "#5C606C" }}>{made ? "Cópiala y mándasela. Cuando la pegue en su Colmena, comprobaréis las palabras." : "Para chatear con alguien que también usa Colmena, en su propio ordenador."}</span>
          </span>
          <Close onClose={onClose} />
        </div>
        {!made ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 18px", borderRadius: "999px", background: "#F2F2EE" }}>
              <label style={{ flex: 1, display: "flex" }}>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Nombre"}</span>
                <input autoFocus type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") make(); }} placeholder="¿Cómo se llama?" style={{ flex: 1, minWidth: 0, height: "44px", border: 0, outline: "none", background: "transparent", fontSize: "16px" }} />
              </label>
              <button type="button" onClick={make} disabled={!name.trim() || busy} style={dark(!!name.trim() && !busy)}>{busy ? "Creando…" : "Crear invitación"}</button>
            </div>
            <span style={{ fontSize: "13px", lineHeight: 1.5, color: "#5C606C" }}>{"Colmena no la envía por ti: tú se la mandas por WhatsApp, correo o como prefieras."}</span>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "18px", borderRadius: "22px", background: "#F4F4F0", animation: "rise .3s ease-out" }}>
              <span style={{ fontSize: "15px", lineHeight: 1.55, color: "#1E2029", userSelect: "text" }}>{made.text.replace(made.code, "").replace(/\s*\(sirve.*$/, "")}</span>
              <code style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "12px", background: "#FFFFFF", font: "500 15px/1 'Geist Mono', monospace", letterSpacing: "0.04em", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.08)", userSelect: "all" }}>{made.code}</code>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <button type="button" onClick={copy} style={dark()}><Copy size={15} strokeWidth={2.2} aria-hidden="true" />{copied ? "Copiada" : "Copiar invitación"}</button>
                <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{"Sirve una vez · caduca en 24 horas"}</span>
              </div>
            </div>
            <Steps items={["Se la mandas tú: Colmena no escribe a nadie por ti.", "La pega en su Colmena y os aparece la otra persona.", "Os decís las cuatro palabras de seguridad. Si coinciden, nadie se ha colado."]} />
          </>
        )}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{error}</p> : null}
      </section>
    </div>
  );
}

export function AcceptSheet({ onClose }) {
  useEscape(onClose);
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
      <section role="dialog" aria-modal="true" aria-labelledby="acc-t" style={{ ...card(520), alignItems: preview ? "center" : "stretch", textAlign: preview ? "center" : "left", gap: "20px" }}>
        {!preview ? (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <h2 id="acc-t" style={{ margin: 0, font: "600 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Tengo una invitación"}</h2>
                <span style={{ fontSize: "15px", lineHeight: 1.5, color: "#5C606C" }}>{"Pega el código que te han mandado. Empieza por COLMENA-."}</span>
              </span>
              <Close onClose={onClose} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 18px", borderRadius: "999px", background: "#F2F2EE" }}>
              <label style={{ flex: 1, display: "flex" }}>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Código de invitación"}</span>
                <input autoFocus type="text" value={code} maxLength={400} onChange={(e) => { const m = /COLMENA[-\s]*(?:[0-9A-Z]{4}[-\s]*){4}/i.exec(e.target.value); setCode(m ? m[0] : e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") look(); }} placeholder="COLMENA-XXXX-XXXX-XXXX-XXXX" spellCheck={false} style={{ flex: 1, minWidth: 0, height: "44px", border: 0, outline: "none", background: "transparent", font: "500 15px/1 'Geist Mono', monospace", letterSpacing: "0.03em" }} />
              </label>
              <button type="button" onClick={look} disabled={!code.trim() || busy} style={dark(!!code.trim() && !busy)}>{busy ? "Buscando…" : "Continuar"}</button>
            </div>
          </>
        ) : (
          <>
            <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{"Invitación"}</span>
            <span aria-hidden="true" style={{ width: "68px", height: "68px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#12131A", color: "#FFFFFF", font: "600 20px/1 'Geist', sans-serif", animation: "pop .5s ease-out" }}>{preview.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h2 id="acc-t" style={{ margin: 0, font: "600 26px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{done ? "Conectada con " + first : preview.name + " te invita a hablar"}</h2>
              <span style={{ fontSize: "15px", lineHeight: 1.55, color: "#5C606C" }}>{done ? "Sus mensajes llegan cerrados con llave: solo los abre tu ordenador." : "Os escribiréis desde Colmena, cada uno en su ordenador y con sus bots."}</span>
            </span>
            {!done ? (
              <>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px", padding: "18px", borderRadius: "22px", background: "#F4F4F0", boxSizing: "border-box" }}>
                  <span style={{ fontSize: "13px", color: "#5C606C" }}>{`Pídele a ${first} que te diga las suyas. Deben ser estas:`}</span>
                  <span style={{ font: "600 21px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{preview.words.join(" · ")}</span>
                </div>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button type="button" onClick={accept} disabled={busy} style={{ ...dark(!busy), height: "50px", fontSize: "15px" }}>{busy ? "Conectando…" : `Coinciden · conectar con ${first}`}</button>
                  <button type="button" onClick={onClose} style={quiet}>{"No coinciden o no le conozco"}</button>
                </div>
                <span style={{ fontSize: "13px", lineHeight: 1.5, color: "#6B6F7A" }}>{`${first} solo verá lo que le escribas y lo que tú decidas compartir.`}</span>
              </>
            ) : (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", borderRadius: "999px", background: "#E8F5EE", color: "#0B6B4A", fontSize: "15px", fontWeight: 600, animation: "develop .5s ease-out" }}>{"Ya podéis escribiros"}</span>
                <button type="button" onClick={() => { onClose(); navigate(shareUrl(done.dm)); }} style={{ ...dark(), height: "48px", fontSize: "15px" }}>{"Abrir la conversación"}</button>
              </>
            )}
          </>
        )}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{error}</p> : null}
      </section>
    </div>
  );
}

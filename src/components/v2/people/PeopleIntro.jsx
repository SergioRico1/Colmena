import { KeyRound, Laptop, LockKeyhole, UserPlus } from "lucide-react";
import { navigate } from "../../../lib/router.jsx";

// «Personas» the first time (design/V2Personas.dc.html, paso primera): it is not Slack, so
// three short lines say why — everyone on their own computer, nobody else can read it, you
// invite with a code — and «Cómo funciona» goes to the whole page.
export const HELP_URL = "/personas/como-funciona";
export const INTRO_STEPS = [
  [Laptop, "Cada uno en su ordenador", "No hay ninguna empresa guardando vuestras conversaciones: cada persona usa su propia Colmena."],
  [LockKeyhole, "Nadie más puede leerlo", "Cada mensaje sale cerrado con llave y solo lo abre el ordenador de quien lo recibe."],
  [KeyRound, "Invitas con un código", "Se lo mandas por WhatsApp o correo, lo pega en su Colmena y comprobáis cuatro palabras."],
];

export default function PeopleIntro({ onInvite = null, onCode = null, compact = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? "14px" : "20px", padding: compact ? "6px 10px 14px" : "24px 22px 22px", animation: "fade .3s ease-out" }}>
      {compact ? null : (
        <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <strong style={{ font: "600 22px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Habla con personas, cada una en su Colmena"}</strong>
          <span style={{ fontSize: "15px", lineHeight: 1.5, color: "#5C606C" }}>{"Funciona distinto a Slack o WhatsApp, y por eso es privado."}</span>
        </span>
      )}
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: compact ? "10px" : "14px" }}>
        {INTRO_STEPS.map(([Icon, title, text]) => (
          <li key={title} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <span aria-hidden="true" style={{ width: compact ? "30px" : "36px", height: compact ? "30px" : "36px", flex: "none", display: "grid", placeItems: "center", borderRadius: "11px", background: "#F2F2EE" }}><Icon size={compact ? 15 : 17} strokeWidth={2} /></span>
            <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <strong style={{ fontSize: compact ? "14px" : "15px", fontWeight: 600 }}>{title}</strong>
              <span style={{ fontSize: compact ? "13px" : "14px", lineHeight: 1.45, color: "#5C606C" }}>{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        {onInvite ? <button type="button" onClick={onInvite} style={{ display: "flex", alignItems: "center", gap: "8px", height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}><UserPlus size={15} strokeWidth={2.2} aria-hidden="true" />{"Invitar a alguien"}</button> : null}
        {onCode ? <button type="button" onClick={onCode} style={{ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{"Tengo una invitación"}</button> : null}
        <a href={HELP_URL} onClick={(e) => { e.preventDefault(); navigate(HELP_URL); }} style={{ padding: "0 8px", fontSize: "14px", fontWeight: 600, color: "#1F4FD1", textDecoration: "none" }}>{"Cómo funciona"}</a>
      </div>
    </div>
  );
}

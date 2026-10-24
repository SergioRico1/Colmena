import { ArrowLeft, Bot, CalendarClock, Inbox, KeyRound, UserMinus, Users } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import { INTRO_STEPS } from "../components/v2/people/PeopleIntro.jsx";
import { navigate } from "../lib/router.jsx";

// «Cómo funciona Personas» (design/V2Personas.dc.html, paso ayuda): the whole thing on one
// page, from Ajustes › Personas and Ctrl+K. Short paragraphs, the person's words, no jargon.
const SECTIONS = [
  ["invitar", KeyRound, "Invitar a alguien", [
    "En Chats › Nueva › «Invitar a alguien» escribes cómo se llama y Colmena te da un mensaje listo para copiar: quién eres, el enlace para descargar Colmena y un código.",
    "Se lo mandas tú, por WhatsApp o correo. El código sirve una sola vez y caduca en 24 horas; si caduca, crea otro.",
    "La otra persona pulsa «Tengo una invitación» y lo pega. A los dos os salen cuatro palabras: decíoslas en persona o por teléfono. Si coinciden, nadie se ha puesto en medio.",
  ]],
  ["grupos", Users, "Conversaciones de grupo", [
    "En Chats › Nueva elige a varias personas y ponle nombre. Caben hasta 32.",
    "Quien la crea decide quién entra. Si alguien del grupo no está en tus personas, sale en Ajustes › Personas como «Conoces por una conversación»: puede escribir en el grupo, no a ti a solas.",
    "«Salir» te saca a ti; quien la creó puede «Cerrar para todos».",
  ]],
  ["bots", Bot, "Tus bots en conversaciones con personas", [
    "Menciónalos con @ y contestan ahí, desde tu ordenador. Solo ven lo que se ha dicho en esa conversación: ni tu correo, ni tu agenda, ni tus archivos, ni lo que saben de ti.",
    "Lo que les piden otras personas es un dato, nunca una orden: no envían, compran, pagan ni borran nada por ello. Tú decides si alguien puede hablar con tus bots, en Ajustes › Personas.",
    "Si tu bot y el de otra persona se llaman igual, verás «Vera · tu bot» y «Vera · de Marta». Elige en @ a cuál se lo pides; un «@Vera» escrito a mano es siempre la tuya.",
  ]],
  ["reuniones", CalendarClock, "Acordar una reunión", [
    "Escribe, por ejemplo, «@Atlas búscanos una hora la semana que viene, 45 minutos, por las mañanas».",
    "Cada Colmena mira solo si su dueño está libre u ocupado, nunca qué tiene. Tú eliges para cada persona si te pregunta antes, si lo comparte siempre o nunca.",
    "Atlas propone tres huecos. Cuando todos decís que sí al mismo, se apunta en el calendario de cada uno, sin enviar invitaciones por correo.",
  ]],
  ["buzon", Inbox, "Qué guarda el buzón", [
    "Los mensajes viajan por el buzón de Colmena como sobres cerrados: ve quién escribe a quién y cuándo, nunca lo que pone.",
    "Si alguien no está conectado, su sobre espera hasta 7 días y se borra en cuanto le llega. Tus correos, archivos y lo que saben de ti tus bots nunca salen de tu ordenador.",
  ]],
  ["quitar", UserMinus, "Dejar de hablar con alguien", [
    "En Ajustes › Personas, abre a esa persona y pulsa «Dejar de hablar con…». Se le avisa y sus mensajes dejan de llegarte.",
    "Lo que ya os escribisteis se queda en tu Colmena. Para volver a hablar, invítala otra vez.",
  ]],
];

export default function PeopleHelp() {
  return (
    <Shell active="conversaciones">
      <article style={{ width: "100%", maxWidth: "760px", margin: "0 auto", padding: "40px clamp(20px, 4vw, 44px) 72px", display: "flex", flexDirection: "column", gap: "28px", boxSizing: "border-box" }}>
        <a href="/ajustes/contactos" onClick={(e) => { e.preventDefault(); if (history.length > 1) history.back(); else navigate("/ajustes/contactos"); }} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: 600, color: "#5C606C", textDecoration: "none" }}><ArrowLeft size={15} strokeWidth={2.2} aria-hidden="true" />{"Volver"}</a>
        <header style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{"Personas"}</span>
          <h1 style={{ margin: 0, font: "600 40px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Cómo funciona"}</h1>
          <p style={{ margin: 0, fontSize: "17px", lineHeight: 1.55, color: "#3D404A" }}>{"Hablas con otras personas que usan Colmena, cada una en su ordenador y con sus bots. No es como Slack o WhatsApp: no hay ninguna empresa en medio guardando lo que os decís."}</p>
        </header>
        <ol style={{ margin: 0, padding: "22px", listStyle: "none", display: "flex", flexDirection: "column", gap: "16px", borderRadius: "26px", background: "#FFFFFF" }}>
          {INTRO_STEPS.map(([Icon, title, text]) => (
            <li key={title} style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ width: "38px", height: "38px", flex: "none", display: "grid", placeItems: "center", borderRadius: "12px", background: "#F2F2EE" }}><Icon size={18} strokeWidth={2} /></span>
              <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}><strong style={{ fontSize: "16px", fontWeight: 600 }}>{title}</strong><span style={{ fontSize: "15px", lineHeight: 1.5, color: "#5C606C" }}>{text}</span></span>
            </li>
          ))}
        </ol>
        <nav aria-label="En esta página" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {SECTIONS.map(([id, , title]) => <a key={id} href={"#" + id} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} style={{ height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "13px", fontWeight: 600, color: "#12131A", textDecoration: "none" }}>{title}</a>)}
        </nav>
        {SECTIONS.map(([id, Icon, title, paragraphs]) => (
          <section key={id} id={id} aria-labelledby={id + "-t"} style={{ display: "flex", flexDirection: "column", gap: "12px", scrollMarginTop: "24px" }}>
            <h2 id={id + "-t"} style={{ margin: 0, display: "flex", alignItems: "center", gap: "10px", font: "600 22px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}><Icon size={20} strokeWidth={2} aria-hidden="true" />{title}</h2>
            {paragraphs.map((p) => <p key={p} style={{ margin: 0, fontSize: "16px", lineHeight: 1.6, color: "#3D404A" }}>{p}</p>)}
          </section>
        ))}
      </article>
    </Shell>
  );
}

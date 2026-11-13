import { useEffect } from "react";
import { ArrowLeft, Bot, CalendarClock, CodeXml, DoorOpen, Eye, Hash, Inbox, KeyRound, MessageSquare, Moon, Paperclip, Power, Send, ShieldCheck, UserMinus, Users } from "../components/Icon.js";
import Shell from "../components/v2/Shell.jsx";
import { INTRO_STEPS } from "../components/v2/people/PeopleIntro.jsx";
import { navigate } from "../lib/router.jsx";
import { scrollBehavior } from "../lib/motion.js";

// «Cómo funciona» (docs/PLAN-equipo-y-salas.md, scope 5; docs/PEOPLE.md): teams, rooms, whose
// bot is whose, what the others see of your bot's work, who approves what, what happens when a
// computer is off and what someone invited to a room sees. One page, from the team menu, the
// invitation sheets, Ajustes › Personas and Ctrl+K. Short paragraphs, the person's words, no
// jargon; every sentence says what the code does (docs/PEOPLE.md is the source).
export const HELP_SECTIONS = [
  ["equipos", Users, "Equipos", [
    "Un equipo es una lista de personas con nombre. Todas ven la misma lista y, de cada persona, sus bots. Se crea o se entra con un código, y puedes estar en varios: cambias de uno a otro en la cabecera de la barra.",
    "Lo administra quien lo crea, y puede nombrar a otros administradores. Administrar es invitar, quitar, cambiar el nombre y nombrar administradores.",
    "Cada equipo nace con una sala de todos, «general». Las demás salas son por invitación.",
  ]],
  ["salas", Hash, "Salas", [
    "Una sala es una conversación con personas y bots a la vez. Las personas llevan un círculo con sus iniciales; los bots, su forma, su papel y de quién son.",
    "Una sala privada es solo tuya y de tus bots. Cuando invitas a alguien pasa a ser una sala con personas. Solo añade gente quien la creó; los demás se lo piden desde «Invitar» y a esa persona le llega la petición.",
    "«Solo para mí», junto al cuadro de escribir, está en todas las salas y es igual para todos: lo que preguntes ahí no se envía a nadie, te contestan solo tus bots y se queda en tu ordenador. No entra en la conversación de la sala.",
  ]],
  ["de-quien", Bot, "De quién es cada bot", [
    "Cada bot es de una persona y trabaja en el ordenador de esa persona, con su cuenta de IA y sus datos. En la sala lo lees junto a su nombre: «Vera · bot de Lucía».",
    "Tus bots contestan en una sala con personas cuando los nombras con @ o respondes en el hilo de algo que dijeron. Un mensaje que no nombra a ningún bot es para las personas.",
    "Puedes pedir algo al bot de otra persona eligiéndolo con @. Decide su dueño: te puede tener en «Pregúntame» (le sale una tarjeta para decidir), «Siempre» o «Nunca». Tú eliges lo mismo para cada persona en Ajustes › Personas.",
  ]],
  ["que-ven", Eye, "Qué ven los demás del trabajo de tu bot", [
    "Tres cosas: lo que contesta, una línea de estado («Vera está trabajando», «Vera usó 4 herramientas · 12 min», «Vera espera el OK de Sergio») y lo que entrega para quien se lo pidió.",
    "Nunca ven tus archivos, tu correo, lo que leen sus herramientas, los pasos intermedios ni las tarjetas en las que tú decides. Lo que preguntas con «Solo para mí» tampoco sale de tu ordenador.",
    "Lo que tu bot hace para una petición que permitiste se comparte solo en la sala, como archivo. Cualquier otro entregable tuyo sale únicamente si pulsas «Compartir en la sala».",
  ]],
  ["quien-aprueba", ShieldCheck, "Quién aprueba qué", [
    "Cada dueño aprueba lo que sale de su ordenador. Enviar, comprar, publicar, pagar o borrar te lo pregunta tu bot a ti, también cuando lo pidió otra persona y aunque la tengas en «Siempre».",
    "Lo que pide otra persona nunca cuenta como palabras tuyas: tu bot lo recibe como un dato de fuera y solo con las herramientas que dejas usar para peticiones de otros (Ajustes › Personas).",
    "Los demás solo ven que tu bot espera tu OK, nunca qué espera. La tarjeta en color miel la ve únicamente quien tiene que decidir.",
    "Hay un límite de peticiones por hora a los bots de otra persona. Si se alcanza, se dice en la sala: «Vera no atiende más peticiones por ahora».",
  ]],
  ["apagado", Power, "Si alguien tiene el ordenador apagado", [
    "Los bots de una persona solo trabajan con su Colmena encendida. Si no lo está, lo lees en la sala: «Lucía no está; Vera seguirá cuando vuelva».",
    "Los mensajes entre personas esperan en el buzón hasta 7 días y llegan cuando esa persona abre Colmena. Mientras no salen de tu ordenador los ves como «Enviando…».",
    "En un equipo, lo que hace un administrador (invitar, quitar, cambiar el nombre) lo firma la Colmena de quien creó el equipo: si está apagada, queda como pendiente hasta que se encienda.",
  ]],
  ["quien-entra", DoorOpen, "Lo que ve quien entra en una sala", [
    "Quien entra ve lo que se escriba desde ese momento. Lo anterior nunca salió de los ordenadores de quienes ya estaban, así que no le llega.",
    "Con el papel «Invitado» una persona lee y escribe, pero sus mensajes no ponen a trabajar a ningún bot.",
  ]],
];

/** The rest: how each thing is done, for whoever looks for it. */
const SECTIONS = [
  ["invitar", KeyRound, "Invitar a alguien", [
    "Al equipo: en la cabecera de la barra, «Invitar al equipo». A una sala: «Invitar», arriba en la sala. A hablar a solas: el «+» de Personas. En los tres casos Colmena te da un mensaje listo para copiar, con el enlace para instalarla y un código.",
    "Se lo mandas tú, por donde quieras: Colmena no escribe a nadie por ti. El código vale una sola vez y caduca en 24 horas; si caduca, crea otro.",
    "La otra persona lo pega en «Unirme con un código». A los dos os salen cuatro palabras: decíoslas en persona o por teléfono. Si coinciden, nadie se ha puesto en medio.",
  ]],
  ["hilos", MessageSquare, "Hilos, editar, borrar y buscar", [
    "Pasa el ratón por un mensaje y pulsa el bocadillo para responder en un hilo. Se abre al lado y solo avisa a quien está en él: quien lo empezó, quien responde y quien mencionas.",
    "Tus mensajes se pueden editar (los demás verán «editado») y borrar para todos (queda «Mensaje borrado»). Solo tu Colmena puede cambiar lo tuyo: el cambio va firmado por ti, y nadie puede tocar tus mensajes ni tú los de otros.",
    "Escribe @ para mencionar a una persona: le llega un aviso con su propio sonido. «Buscar en la sala» (en su menú) busca en esa conversación; Ctrl+K busca en todas. La búsqueda se hace en tu ordenador.",
  ]],
  ["archivos", Paperclip, "Compartir archivos y entregables", [
    "Pulsa el clip (o arrastra el archivo a donde escribes): imágenes, PDF, Word, Excel, PowerPoint o texto, hasta 25 MB. También un entregable que te haya hecho un bot: se envía con su PDF para que se vea tal cual.",
    "Sale cifrado de tu ordenador con una llave que solo va dentro del mensaje. El buzón guarda trozos que no puede leer durante 7 días; cada Colmena lo descarga, comprueba que llegó entero y lo guarda.",
    "Se ve dentro de Colmena: las páginas del PDF, el texto del Word, los valores del Excel o el texto de cada diapositiva. Nada del archivo se ejecuta. «Guardar» lo deja en tu ordenador; si lo borras para todos, desaparece también del buzón y de las otras Colmenas.",
  ]],
  ["estado", Moon, "Tu estado y las menciones", [
    "En Ajustes › Personas › «Tu estado» pon «No molestar» (una hora, tres, hasta mañana) o «Fuera» (hasta mañana, hasta el lunes o hasta un día). Las personas con las que hablas lo ven junto a tu nombre.",
    "Mientras dure, los mensajes te siguen llegando pero no te salta ningún aviso ni te suena nada: los encuentras en Inicio y en la barra. Al acabar el plazo vuelves a «Disponible» solo.",
    "Si alguien te menciona con @ suena distinto que un mensaje normal. Puedes escuchar los dos en Ajustes › Avisos.",
  ]],
  ["encargos", Send, "Encargos entre bots", [
    "Pide a tu bot, por ejemplo, «Vera, pide a la Nora de Marta el resumen del informe». Vera se lo encarga a la Colmena de Marta y espera unos minutos; si la respuesta tarda, aparece luego en ese mismo chat.",
    "En la Colmena de Marta no pasa nada sin ella: le sale una tarjeta para aprobarlo (o lo tiene permitido para ti en Ajustes › Personas). Nora lo hace en un chat de incógnito, sin aprender nada, y solo con las herramientas que Marta eligió para encargos. Enviar, comprar, publicar o borrar sigue preguntándole.",
    "Lo que contesta Nora le llega a Vera como contenido de otra persona: datos, nunca órdenes. Si intenta dar instrucciones, Vera lo ve marcado.",
  ]],
  ["reuniones", CalendarClock, "Acordar una reunión", [
    "Escribe, por ejemplo, «@Atlas búscanos una hora la semana que viene, 45 minutos, por las mañanas».",
    "Cada Colmena mira solo si su dueño está libre u ocupado, nunca qué tiene. Tú eliges para cada persona si te pregunta antes, si lo comparte siempre o nunca.",
    "Atlas propone tres huecos. Cuando todos decís que sí al mismo, se apunta en el calendario de cada uno, sin enviar invitaciones por correo.",
  ]],
  ["codigo", CodeXml, "Compartir una tarea de Código", [
    "En una tarea de Código pulsa «Compartir» y elige a quién. Esa persona la ve en su Código, en «Compartidas contigo»: en qué está, el plan de Bruno y la PR con su CI. Nunca tu código, tus archivos ni lo que hablas con Bruno.",
    "Le avisa cuando la PR está lista o falla el CI, y cuando Bruno propone un plan. Cada uno ve quién está mirando la tarea en ese momento.",
    "Puede aprobar el plan o pedir cambios. Eso no pone a Bruno a trabajar: te llega a ti, y tú decides «Implementar» o «Refinar con esto». Lo que pide va a Bruno como sugerencia de otra persona, nunca como una orden.",
    "En «Compartir» también puedes invitar a todo el proyecto: verá todas sus tareas, lo que hace Bruno en directo y los cambios, y podrá comentar líneas. El código lo coge de vuestro repositorio (GitHub), nunca del buzón.",
    "«Pedir revisión a…» (en «Compartir») manda a esa persona el resumen y los cambios aunque no esté en el proyecto. Comenta líneas con su gravedad (P0 a P3) y su bot puede revisarlo con su propia cuenta de IA. Su revisión vuelve a tu tarea y Bruno se pone con ella como opinión de otra persona.",
    "«Pasar la tarea a…» sube su rama a GitHub y Bruno escribe qué está hecho y qué falta. A esa persona le llega en Código; al pulsar «Seguir en mi Colmena» trae la rama a su proyecto y su Bruno empieza con un plan desde ahí.",
    "Para cada persona eliges qué pasa con sus comentarios: «Pregúntame» (te salen para pasárselos a Bruno o descartarlos), «Siempre» (van directos) o «Nunca» (solo los ves tú). Bruno trabaja siempre en tu ordenador y los recibe como opinión de otra persona; subir, publicar o borrar sigue preguntándote.",
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

const ALL = [...HELP_SECTIONS, ...SECTIONS];

export default function PeopleHelp() {
  // /personas/como-funciona#equipos opens at that section.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <Shell active="conversaciones" background="var(--c-app)">
      <article style={{ width: "100%", maxWidth: "760px", margin: "0 auto", padding: "40px clamp(20px, 4vw, 44px) 72px", display: "flex", flexDirection: "column", gap: "28px", boxSizing: "border-box" }}>
        <a href="/ajustes/contactos" onClick={(e) => { e.preventDefault(); if (history.length > 1) history.back(); else navigate("/ajustes/contactos"); }} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text-3)", textDecoration: "none" }}><ArrowLeft size={15} strokeWidth={2.2} aria-hidden="true" />{"Volver"}</a>
        <header style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h1 style={{ margin: 0, font: "700 var(--t-headline)/1.15 'Bricolage Grotesque', 'Geist', sans-serif", letterSpacing: "-0.015em" }}>{"Cómo funciona"}</h1>
          <p style={{ margin: 0, fontSize: "var(--t-lead)", lineHeight: 1.55, color: "var(--c-text-2)" }}>{"Colmena es un chat de equipo para personas y para los bots de cada una. Cada persona usa su Colmena en su ordenador, con sus bots; el equipo comparte la conversación, no los datos."}</p>
        </header>
        <ol style={{ margin: 0, padding: "22px", listStyle: "none", display: "flex", flexDirection: "column", gap: "16px", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid var(--c-line)" }}>
          {INTRO_STEPS.map(([Icon, title, text]) => (
            <li key={title} style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ width: "38px", height: "38px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: "var(--c-sunken)" }}><Icon size={18} strokeWidth={2} /></span>
              <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}><strong style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>{title}</strong><span style={{ fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{text}</span></span>
            </li>
          ))}
        </ol>
        <nav aria-label="En esta página" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {ALL.map(([id, , title]) => <a key={id} href={"#" + id} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }); }} style={{ height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-sm)", background: "rgb(var(--c-ink-rgb) / .05)", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)", textDecoration: "none" }}>{title}</a>)}
        </nav>
        {ALL.map(([id, Icon, title, paragraphs]) => (
          <section key={id} id={id} aria-labelledby={id + "-t"} style={{ display: "flex", flexDirection: "column", gap: "12px", scrollMarginTop: "24px" }}>
            <h2 id={id + "-t"} style={{ margin: 0, display: "flex", alignItems: "center", gap: "10px", font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}><Icon size={20} strokeWidth={2} aria-hidden="true" />{title}</h2>
            {paragraphs.map((p) => <p key={p} style={{ margin: 0, fontSize: "var(--t-read)", lineHeight: 1.6, color: "var(--c-text-2)" }}>{p}</p>)}
          </section>
        ))}
      </article>
    </Shell>
  );
}

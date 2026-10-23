import { useEffect, useState } from "react";
import { ShieldCheck, Ticket, UserPlus } from "lucide-react";
import { useAction, useStore } from "../../../lib/store.jsx";
import { del, patch } from "../../../lib/api.js";
import { later, isHidden } from "../../../lib/undoToast.js";
import { RELAY_LABEL } from "../../../lib/peers.js";
import { PeerAvatar } from "../people/PeerAvatar.jsx";
import { AcceptSheet, InviteSheet } from "../people/InviteSheets.jsx";
import { Chevron, FieldRow, Group, LINE, MUTED, Segmented, Text, inputStyle, pill, rowStyle } from "./rows.jsx";

// Ajustes › Personas (design/V2Personas.dc.html, paso personas): who you talk to from
// Colmena, what each one's bot may ask you, your safety words with each, invitations not yet
// accepted and the mailbox the messages travel through.
const ASKS = [
  ["libre", "Cuándo estás libre", "Solo libre u ocupado: nunca títulos, lugares ni personas.", [["pregunta", "Pregúntame"], ["siempre", "Siempre"], ["nunca", "Nunca"]]],
  ["bots", "Hablar con tus bots", "En conversaciones que compartís. Tus bots no usan tus cuentas por lo que pida.", [["mencion", "Si los menciona"], ["nunca", "Nunca"]]],
  ["archivos", "Ver tus archivos", "Solo los que compartas tú en una conversación.", [["pregunta", "Pregúntame"], ["nunca", "Nunca"]]],
];
const when = (iso) => new Date(iso).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const seenText = (c) => (c.online ? "Conectada" : c.status === "pending" ? "Aún no ha abierto Colmena desde que aceptaste" : c.lastSeenAt ? "Vista por última vez el " + when(c.lastSeenAt) : "En su Colmena");

export default function PeopleSettings() {
  const { peers = null } = useStore();
  const act = useAction();
  const [sheet, setSheet] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    // /ajustes/contactos#<address> opens that person.
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash && peers?.contacts?.some((c) => c.id === hash)) setOpen(hash);
  }, [peers?.contacts?.length]);
  if (!peers?.me) return <Group id="pp-t" title="Personas"><div style={rowStyle(true)}><Text title="Preparando «Personas»…" sub="Colmena está creando las claves de este ordenador." /></div></Group>;
  const contacts = peers.contacts.filter((c) => c.status !== "known" && !isHidden("peer:" + c.id));
  const known = peers.contacts.filter((c) => c.status === "known");
  const relay = peers.relay || {};
  const remove = (c) => later({
    id: "peer:" + c.id, keys: ["peer:" + c.id], text: `Has dejado de hablar con ${c.name.split(" ")[0]}`, error: "No se pudo quitar",
    run: () => act.act(() => del(`/peers/contacts/${encodeURIComponent(c.id)}`)),
  });
  return (
    <>
      <Group id="pp-me" title="Tú" anchor="tu-identidad" note="Tu nombre es el de Ajustes › Tu cuenta. Las personas con las que hablas lo ven tal cual.">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px", padding: "20px" }}>
          <PeerAvatar person={{ me: true }} size={56} />
          <Text title={peers.me.name} sub="Hablas desde Colmena con otras personas, cada una en su ordenador." />
          <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" id="invitar" onClick={() => setSheet("invitar")} disabled={relay.status === "off"} style={pill(true)}><UserPlus size={15} strokeWidth={2.2} aria-hidden="true" />{"Invitar a alguien"}</button>
            <button type="button" onClick={() => setSheet("aceptar")} disabled={relay.status === "off"} style={pill(false)}><Ticket size={15} strokeWidth={2.2} aria-hidden="true" />{"Tengo una invitación"}</button>
          </span>
        </div>
      </Group>

      <Group id="pp-ct" title={`Conectadas · ${contacts.length}`} anchor="contactos" note={contacts.length ? "Enviar, comprar, publicar o pagar por algo que pida otra persona o su bot siempre te pregunta, aunque digas «Siempre» aquí." : null}>
        {contacts.length === 0 ? <div style={rowStyle(!peers.invites.length)}><Text title="Aún no hablas con nadie" sub="Invita a alguien: le mandas un código y lo pega en su Colmena." /></div> : null}
        {contacts.map((c, i) => {
          const isOpen = open === c.id;
          return (
            <div key={c.id} id={c.id} style={{ borderBottom: i === contacts.length - 1 && !peers.invites.length ? 0 : LINE }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} style={{ ...rowStyle(true, "68px"), cursor: "pointer" }}>
                <PeerAvatar person={c} size={40} dot ring="#FFFFFF" dashed={c.status === "pending"} />
                <Text title={c.name} sub={seenText(c)} />
                {c.verifiedAt ? <ShieldCheck size={17} strokeWidth={2.2} color="#0B8A5F" aria-label="Palabras comprobadas" /> : null}
                <Chevron open={isOpen} />
              </button>
              {isOpen ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "4px 20px 22px 76px", animation: "rise .2s ease-out" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px 16px", borderRadius: "18px", background: "#F4F4F0" }}>
                    <span style={{ fontSize: "13px", color: MUTED }}>{`Vuestras palabras de seguridad. ${c.name.split(" ")[0]} tiene que ver las mismas:`}</span>
                    <strong style={{ font: "600 19px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{c.words.join(" · ")}</strong>
                    <button type="button" onClick={() => act.act(() => patch(`/peers/contacts/${encodeURIComponent(c.id)}`, { verified: !c.verifiedAt }))} style={{ ...pill(!c.verifiedAt), alignSelf: "flex-start", height: "36px", fontSize: "13px" }}>{c.verifiedAt ? "Comprobadas · deshacer" : "Las hemos comprobado"}</button>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 500, color: MUTED }}>{"Lo que puede pedirte su bot"}</span>
                  {ASKS.map(([key, title, sub, items]) => (
                    <div key={key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px" }}>
                      <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "2px" }}><strong style={{ fontSize: "15px", fontWeight: 600 }}>{title}</strong><span style={{ fontSize: "13px", color: MUTED }}>{sub}</span></span>
                      <span style={{ flex: "0 1 300px" }}><Segmented label={title} items={items} value={c.asks[key]} busy={act.busy} onPick={(v) => act.act(() => patch(`/peers/contacts/${encodeURIComponent(c.id)}`, { asks: { [key]: v } }))} /></span>
                    </div>
                  ))}
                  <button type="button" onClick={() => remove(c)} style={{ ...pill(false), alignSelf: "flex-start", background: "transparent", color: "#B42318", padding: "0 4px" }}>{"Dejar de hablar con " + c.name.split(" ")[0]}</button>
                </div>
              ) : null}
            </div>
          );
        })}
        {peers.invites.map((inv, i) => (
          <div key={inv.id} style={rowStyle(i === peers.invites.length - 1, "64px")}>
            <PeerAvatar person={{ initials: inv.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(), color: "#EEEAE3" }} size={40} dashed />
            <Text title={inv.name} sub={"Invitación sin aceptar · caduca el " + when(inv.expiresAt)} />
            <button type="button" onClick={() => later({ id: "invite:" + inv.id, keys: [], text: "Invitación cancelada", run: () => act.act(() => del(`/peers/invites/${inv.id}`)) })} style={{ ...pill(false), height: "36px", fontSize: "13px" }}>{"Cancelar"}</button>
          </div>
        ))}
      </Group>

      {known.length ? (
        <Group id="pp-kn" title="Conoces por una conversación" note="Están en un grupo contigo porque las añadió quien lo creó. Para escribiros a solas, invítala.">
          {known.map((c, i) => (
            <div key={c.id} style={rowStyle(i === known.length - 1, "60px")}>
              <PeerAvatar person={c} size={36} />
              <Text title={c.name} sub={c.online ? "Conectada" : "En su Colmena"} />
            </div>
          ))}
        </Group>
      ) : null}

      <RelayGroup relay={relay} act={act} />
      {sheet === "invitar" ? <InviteSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "aceptar" ? <AcceptSheet onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function RelayGroup({ relay, act }) {
  const [draft, setDraft] = useState(relay.url || "");
  useEffect(() => { setDraft(relay.url || ""); }, [relay.url]);
  const color = relay.status === "online" ? "#1E9E6A" : relay.status === "connecting" ? "#C98A00" : relay.status === "offline" ? "#B4372A" : "#9A9DA6";
  const save = () => { const v = draft.trim(); if (v !== (relay.url || "")) act.act(() => patch("/peers/settings", { relayUrl: v || null })); };
  return (
    <Group id="pp-rl" title="Cómo os llegan los mensajes" anchor="buzon" note="Si alguien no está conectado, su sobre espera en el buzón hasta 7 días. Tus correos, tu calendario, tus archivos y lo que saben de ti tus bots nunca salen de aquí: solo lo que escribís y lo que tú apruebas compartir.">
      <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "18px 20px", borderBottom: LINE }}>
        <span aria-hidden="true" style={{ width: "10px", height: "10px", flex: "none", borderRadius: "50%", background: color, boxShadow: `0 0 0 4px ${color}26` }} />
        <Text title={RELAY_LABEL[relay.status] || "Buzón"} sub={relay.status === "online" ? "Cada mensaje sale cerrado con llave desde este ordenador y solo lo abre el de la otra persona: el buzón guarda sobres que no puede leer." : relay.error || "Sin buzón no se puede hablar con nadie."} />
      </div>
      <FieldRow title="Dirección del buzón" sub="Todas las personas que habláis tenéis que usar el mismo." last>
        <input type="url" aria-label="Dirección del buzón" value={draft} placeholder="https://buzon.ejemplo.com" spellCheck={false} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} style={inputStyle} />
      </FieldRow>
    </Group>
  );
}

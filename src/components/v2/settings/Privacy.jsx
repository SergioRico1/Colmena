import { useEffect, useState } from "react";
import ManagersPanel from "./Managers.jsx";
import { useResource, useStore } from "../../../lib/store.jsx";
import { del, get } from "../../../lib/api.js";
import { later } from "../../../lib/undoToast.js";
import VaultCard from "../../settings/Vault.jsx";
import DocHistory from "../team/DocHistory.jsx";
import { Alert, Confirm, Go, LINE, Row, Switch, UNDO_MS, anchorOf, btn, danger, h3, useSettings } from "./v3.jsx";
import { forgetAllText } from "./effects.js";
import { C } from "../../../lib/theme.js";

// Ajustes › Memoria y privacidad: where your data lives and what leaves this computer, what the
// bots remember and learn (an incognito chat never learns), the web passwords, the log of what
// they do and «Hacer que lo olviden todo», set apart and confirmed with what goes and what stays.
// Backups and encryption have their own section (Copias y cifrado, Copies.jsx).

function Fact({ k, v, n, dot, anchor }) {
  return (
    <div {...anchorOf(anchor)} style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "16px 18px", scrollMarginTop: "24px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}><span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "var(--r-circle)", background: dot }} />{k}</span>
      <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{v}</span>
      <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>{n}</span>
    </div>
  );
}

export default function PrivacySection() {
  const { memories = [], memoryArchive, run } = useStore();
  const archived = memoryArchive?.count || 0;
  const remembered = memories.length + archived;
  const { settings, save, error } = useSettings();
  const enc = useResource("/encryption");
  const vault = useResource("/vault");
  const [open, setOpen] = useState(null); // "vault" | "managers" | "profile"
  const [asking, setAsking] = useState(false);
  const s = enc.data;
  const saved = vault.data?.entries?.length || 0;
  const logins = useResource("/logins");
  const chosenLogins = logins.data?.logins?.length || 0;
  // A link to #gestores (Ctrl+K, a bot's page) opens the panel.
  useEffect(() => { if (location.hash === "#gestores") setOpen("managers"); }, []);
  const forgetAll = () => {
    setAsking(false);
    const all = memories.map((m) => m.id);
    later({ id: "forget-all", keys: all.map((id) => "memory:" + id), ms: UNDO_MS, text: "Los bots lo olvidan todo", error: "No se pudo olvidar todo",
      run: () => run(async () => {
        // The archive is not in the state: its ids come by pages, before anything is deleted.
        const ids = [];
        for (let cursor = "", pages = 0; cursor !== null && pages < 500; pages++) {
          const page = await get(`/memories?tier=archive&limit=200${cursor ? "&cursor=" + cursor : ""}`);
          ids.push(...page.items.map((m) => m.id));
          cursor = page.cursor;
        }
        for (const id of [...all, ...ids]) await del(`/memories/${encodeURIComponent(id)}`);
      }) });
  };
  const toggle = (what) => setOpen(open === what ? null : what);
  const forget = forgetAllText(memories.length, archived);
  return (
    <>
      <Alert>{error}</Alert>
      <section aria-label="Dónde están tus datos" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)" }}>
        <Fact anchor="privado" k="Dónde viven tus datos" v="En este ordenador" dot={s?.encrypted ? C.okInk : C.text4} n={s?.encrypted ? "Cifrados en el disco. Colmena no tiene servidores propios." : <>Colmena no tiene servidores propios. <Go to="/ajustes/copias#cifrado">Cifrarlos</Go></>} />
        <Fact k="Qué sale de aquí" v="Solo lo que pides" dot={C.text4} n="Lo que escribes pasa por tu cuenta de IA para que te respondan. Enviar o publicar siempre te pregunta." />
      </section>

      <section aria-labelledby="mem-t" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden" }}>
        <h3 id="mem-t" style={{ ...h3, padding: "18px 22px 6px" }}>Lo que recuerdan de ti</h3>
        <Row anchor="aprenden" first title="Aprenden de lo que hablas" sub="Apagado, siguen trabajando pero no guardan recuerdos ni habilidades nuevas. Un chat de incógnito nunca aprende." min="64px">
          <Switch on={settings.learning !== false} label="Aprenden de lo que hablas" onChange={(on) => save({ learning: on }, on ? "Vuelven a aprender" : "Ya no aprenden de lo que hablas", { learning: !on })} />
        </Row>
        <Row anchor="recuerdos" title="Qué recuerda cada bot de ti" sub={remembered ? `${remembered} ${remembered === 1 ? "recuerdo" : "recuerdos"}. Puedes ver, corregir o borrar cada uno.` : "Nada todavía."} min="64px">
          <Go to="/biblioteca/memoria" style={btn("outline", 32)}>Ver la memoria</Go>
        </Row>
        <Row anchor="perfil-historial" title="Tu perfil y sus versiones" sub="Lo que saben de ti, resumido. Cada cambio queda guardado y puedes volver a cualquiera." min="64px">
          <button type="button" aria-expanded={open === "profile"} onClick={() => toggle("profile")} style={btn("outline", 32)}>{open === "profile" ? "Ocultar" : "Ver versiones"}</button>
        </Row>
        {open === "profile" ? <div style={{ padding: "0 10px 10px", animation: "fade .25s ease-out" }}><DocHistory doc="user" empty="Todavía no hay un perfil resumido: Colmena lo prepara cuando sabe lo suficiente de ti." /></div> : null}
      </section>

      <section aria-labelledby="pw-t" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden" }}>
        <h3 id="pw-t" style={{ ...h3, padding: "18px 22px 6px" }}>Contraseñas y registro</h3>
        <Row anchor="boveda" first title="Contraseñas de webs" sub={vault.data?.available === false ? "Solo en la app de escritorio de Windows. Los bots nunca las ven." : `${saved ? saved + (saved === 1 ? " guardada" : " guardadas") : "Ninguna guardada"} en el llavero de Windows. Colmena las escribe por tus bots; ellos nunca las ven.`} min="64px">
          <button type="button" aria-expanded={open === "vault"} onClick={() => toggle("vault")} style={btn("outline", 32)}>{open === "vault" ? "Ocultar" : "Gestionar"}</button>
        </Row>
        {open === "vault" ? <div style={{ padding: "0 10px 10px", borderTop: LINE, animation: "fade .25s ease-out" }}><VaultCard /></div> : null}
        <Row anchor="gestores" title="Conectar un gestor de contraseñas" sub={chosenLogins ? `${chosenLogins} ${chosenLogins === 1 ? "inicio de sesión" : "inicios de sesión"} de 1Password o Bitwarden. Tus bots entran con ellos sin verlos.` : "1Password o Bitwarden. Eliges qué inicios de sesión y qué bots; ninguno hasta que tú lo digas."} min="64px">
          <button type="button" aria-expanded={open === "managers"} onClick={() => toggle("managers")} style={btn("outline", 32)}>{open === "managers" ? "Ocultar" : chosenLogins ? "Gestionar" : "Conectar"}</button>
        </Row>
        {open === "managers" ? <div style={{ padding: "0 10px 10px", borderTop: LINE, animation: "fade .25s ease-out" }}><ManagersPanel /></div> : null}
        <Row anchor="registro" title="Registro de acciones" sub="Todo lo que han hecho, con quién lo aprobó y cuándo. Se puede descargar." min="64px">
          <Go to="/ajustes/seguridad" style={btn("outline", 32)}>Ver el registro</Go>
        </Row>
      </section>

      <section {...anchorOf("olvidar")} aria-labelledby="danger-t" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "10px", padding: "18px 22px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid color-mix(in srgb, var(--c-error) 28%, transparent)", scrollMarginTop: "24px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 20px" }}>
          <span style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <h3 id="danger-t" style={h3}>Hacer que lo olviden todo</h3>
            <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>{remembered ? "Borra lo que todos tus bots recuerdan de ti. Los chats, los archivos y tu perfil se quedan." : "No recuerdan nada de ti todavía: no hay nada que olvidar."}</span>
          </span>
          {!asking ? <button type="button" disabled={!remembered} title={remembered ? undefined : "No hay recuerdos que borrar"} onClick={() => setAsking(true)} style={{ ...danger(38), opacity: remembered ? 1 : 0.5 }}>Olvidar todo…</button> : null}
        </div>
        {asking ? <Confirm title={forget.title} action={forget.action} onConfirm={forgetAll} onCancel={() => setAsking(false)}>{forget.body}</Confirm> : null}
      </section>
    </>
  );
}

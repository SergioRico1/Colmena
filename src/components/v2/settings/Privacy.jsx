import { useState } from "react";
import { useResource, useStore } from "../../../lib/store.jsx";
import { del, get } from "../../../lib/api.js";
import { later } from "../../../lib/undoToast.js";
import VaultCard from "../../settings/Vault.jsx";
import DocHistory from "../team/DocHistory.jsx";
import BackupSettings, { folderLabel, size, when } from "./Backup.jsx";
import EncryptionSettings from "./Encryption.jsx";
import DictationRow from "./Dictation.jsx";
import { Alert, Go, LINE, MUTED, Row, Switch, UNDO_MS, anchorOf, btn, h3, useSettings } from "./v3.jsx";

// Ajustes › Privacidad y datos (design/V3Privacidad.dc.html): where your data lives and what
// leaves this computer, the encrypted backups, the local database encryption, what the bots
// remember and learn (an incognito chat never learns), the web passwords, dictation, the log
// of what they do (seen in Actividad) and «Hacer que lo olviden todo».

function Fact({ k, v, n, dot, anchor }) {
  return (
    <div {...anchorOf(anchor)} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "18px", borderRadius: "18px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: MUTED }}><span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot }} />{k}</span>
      <span style={{ fontSize: "16px", fontWeight: 600 }}>{v}</span>
      <span style={{ fontSize: "12.5px", color: MUTED }}>{n}</span>
    </div>
  );
}

export default function PrivacySection() {
  const { memories = [], memoryArchive, run } = useStore();
  const remembered = memories.length + (memoryArchive?.count || 0);
  const { settings, save, error } = useSettings();
  const backup = useResource("/backup");
  const enc = useResource("/encryption");
  const vault = useResource("/vault");
  const [open, setOpen] = useState(null); // "vault" | "profile"
  const v = backup.data, s = enc.data;
  const reloadEnc = () => get("/encryption").then(enc.setData);
  const saved = vault.data?.entries?.length || 0;
  const forgetAll = () => {
    const all = memories.map((m) => m.id);
    later({ id: "forget-all", keys: all.map((id) => "memory:" + id), ms: UNDO_MS, text: "Los bots lo olvidan todo", error: "No se pudo olvidar todo",
      run: () => run(async () => {
        // The archive is not in the state: its ids come by pages, before anything is deleted.
        const archived = [];
        for (let cursor = "", pages = 0; cursor !== null && pages < 500; pages++) {
          const page = await get(`/memories?tier=archive&limit=200${cursor ? "&cursor=" + cursor : ""}`);
          archived.push(...page.items.map((m) => m.id));
          cursor = page.cursor;
        }
        for (const id of [...all, ...archived]) await del(`/memories/${encodeURIComponent(id)}`);
      }) });
  };
  const toggle = (what) => setOpen(open === what ? null : what);
  return (
    <>
      <Alert>{error}</Alert>
      <section aria-label="Resumen" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "10px" }}>
        <Fact anchor="privado" k="Dónde viven tus datos" v="En este ordenador" dot={s?.encrypted ? "#0B6B4A" : "#8A8D96"} n={s?.encrypted ? "Cifrados. Colmena no tiene servidores propios." : "Colmena no tiene servidores propios."} />
        <Fact k="Qué sale de aquí" v="Solo lo que pides" dot="#8A8D96" n="Pasa por tu cuenta de IA para que te respondan" />
        <Fact k="Última copia" v={v?.last ? when(v.last.at) : "Ninguna todavía"} dot={v?.last && !v.lastError ? "#0B6B4A" : "#8A8D96"} n={v?.last ? `Cifrada, en ${folderLabel(v)} · ${size(v.last.bytes)}` : v?.hasPassword ? "Haz la primera aquí abajo." : "Pon una contraseña y haz la primera."} />
      </section>

      <BackupSettings v={v} setV={backup.setData} error={backup.error} />
      <EncryptionSettings s={s} reload={reloadEnc} />

      <section aria-labelledby="mem-t" style={{ display: "flex", flexDirection: "column", borderRadius: "20px", background: "#FFFFFF", overflow: "hidden" }}>
        <h3 id="mem-t" style={{ ...h3, fontSize: "16px", padding: "18px 22px 8px" }}>Memoria y conversaciones</h3>
        <Row anchor="aprenden" title="Aprenden de lo que hablas" sub="Si lo apagas, siguen trabajando pero no guardan recuerdos ni habilidades nuevas. Un chat de incógnito nunca aprende." min="64px">
          <Switch on={settings.learning !== false} label="Aprenden de lo que hablas" onChange={(on) => save({ learning: on }, on ? "Vuelven a aprender" : "Ya no aprenden de lo que hablas", { learning: !on })} />
        </Row>
        <Row anchor="recuerdos" title="Qué recuerda cada bot de ti" sub={remembered ? `${remembered} ${remembered === 1 ? "recuerdo" : "recuerdos"}` : "Nada todavía"} min="64px">
          <Go to="/biblioteca/memoria" style={btn("outline", 32)}>Ver memoria</Go>
        </Row>
        <Row anchor="perfil-historial" title="Tu perfil y sus versiones" sub="Lo que saben de ti, resumido. Cada cambio queda guardado y puedes volver a cualquiera." min="64px">
          <button type="button" aria-expanded={open === "profile"} onClick={() => toggle("profile")} style={btn("outline", 32)}>{open === "profile" ? "Ocultar" : "Ver versiones"}</button>
        </Row>
        {open === "profile" ? <div style={{ padding: "0 10px 10px", animation: "fade .25s ease-out" }}><DocHistory doc="user" empty="Todavía no hay un perfil resumido: Colmena lo prepara cuando sabe lo suficiente de ti." /></div> : null}
        <Row anchor="boveda" title="Contraseñas de webs" sub={vault.data?.available === false ? "Solo en la app de escritorio de Windows. Los bots nunca las ven." : `${saved ? saved + (saved === 1 ? " guardada" : " guardadas") : "Ninguna guardada"} en el llavero de Windows. Los bots nunca las ven.`} min="64px">
          <button type="button" aria-expanded={open === "vault"} onClick={() => toggle("vault")} style={btn("outline", 32)}>{open === "vault" ? "Ocultar" : "Gestionar"}</button>
        </Row>
        {open === "vault" ? <div style={{ padding: "0 10px 10px", borderTop: LINE, animation: "fade .25s ease-out" }}><VaultCard /></div> : null}
        <DictationRow />
        <Row anchor="registro" title="Registro de acciones" sub={<>Todo lo que hacen, con quién lo aprobó y cuándo. Se ve en <Go to="/actividad">Actividad</Go>.</>} min="64px">
          <Go to="/ajustes/seguridad" style={btn("outline", 32)}>Ver registro</Go>
        </Row>
      </section>

      <section {...anchorOf("olvidar")} aria-labelledby="danger-t" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 20px", padding: "18px 22px", borderRadius: "20px", background: "#FFFFFF", boxShadow: "inset 0 0 0 1px rgba(180,35,42,.25)", scrollMarginTop: "24px" }}>
        <span style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <h3 id="danger-t" style={h3}>Hacer que lo olviden todo</h3>
          <span style={{ fontSize: "13px", color: "#4A4D57" }}>Borra lo que recuerdan de ti. Los chats y los archivos se quedan. Tienes 10 segundos para deshacerlo.</span>
        </span>
        <button type="button" disabled={!remembered} onClick={forgetAll} style={{ ...btn("outline", 38), borderColor: "rgba(180,35,42,.35)", color: "#B4232A", fontSize: "14px", opacity: memories.length ? 1 : 0.5 }}>Olvidar todo…</button>
      </section>
    </>
  );
}

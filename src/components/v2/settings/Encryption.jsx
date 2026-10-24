import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole, LockKeyholeOpen, TriangleAlert } from "lucide-react";
import { del, get, post } from "../../../lib/api.js";
import { FAINT, Group, INK, LINE, MUTED, Text, anchorOf, pill, rowStyle } from "./rows.jsx";

// Ajustes › Privacidad y datos › «Cifrado de este ordenador» (server/encryption.mjs): the
// database encrypted with a key Windows (or the Mac's Keychain) keeps for your account. It is
// prepared here — an encrypted backup first — and done when Colmena starts again. Says plainly
// what it protects, what it does not, and what to use for the files.

const GREEN = "#0B6B4A", RED = "#B4372A";
const when = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "");
const KEEPER = { dpapi: "Windows la guarda para tu cuenta", keychain: "el Llavero de tu Mac la guarda", file: "se guarda en un archivo solo tuyo" };
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent || "");

export default function EncryptionSettings() {
  const [s, setS] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const load = () => get("/encryption").then(setS).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const act = async (what, fn) => {
    setBusy(what);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  if (!s) return null;
  const pending = s.pending;
  return (
    <>
      {s.locked ? (
        <section role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px", padding: "18px 20px", borderRadius: "26px", background: "#FBE4E0" }}>
          <TriangleAlert size={20} strokeWidth={2} color={RED} aria-hidden="true" />
          <Text title="No encontré la clave de tu base de datos cifrada" sub={`Colmena ha empezado de cero y ha apartado tus datos cifrados en «${s.locked.folder}». Para recuperarlos, restaura una copia de seguridad (más arriba).`} />
          <button type="button" onClick={() => act("dismiss", () => post("/encryption/dismiss/locked", {}))} style={pill(false)}>Entendido</button>
        </section>
      ) : null}
      {pending ? (
        <section role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px", padding: "18px 20px", borderRadius: "26px", background: "#FFF4D1", animation: "rise .35s cubic-bezier(.2,.8,.2,1)" }}>
          <LockKeyhole size={20} strokeWidth={2} color={INK} aria-hidden="true" />
          <Text title="Todo listo para cifrar" sub="La copia de seguridad ya está hecha. Colmena cifra la base al reiniciarse: tarda unos segundos." />
          <span style={{ display: "flex", gap: "10px" }}>
            {s.canRelaunch
              ? <button type="button" onClick={() => act("restart", () => post("/encryption/relaunch", {}))} disabled={busy === "restart"} style={pill(true)}>{busy === "restart" ? "Reiniciando…" : "Reiniciar y cifrar"}</button>
              : <span style={{ fontSize: "14px", color: MUTED }}>Cierra Colmena y vuelve a abrirla.</span>}
            <button type="button" onClick={() => act("cancel", () => del("/encryption/prepare"))} style={pill(false)}>Anular</button>
          </span>
        </section>
      ) : null}

      <Group id="enc-t" title="Cifrado de este ordenador" anchor="cifrado" note={s.encrypted ? `La clave no está en la carpeta de Colmena: ${KEEPER[s.keyStore] || "la guarda el sistema"}.` : null}>
        <div {...anchorOf("cifrado-estado")} style={{ ...rowStyle(!open && !s.failed && !s.done, "80px"), flexWrap: "wrap" }}>
          <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: s.encrypted ? "#E1F4EC" : "rgba(18,19,26,.06)", color: s.encrypted ? GREEN : "#A3A6AF" }}>
            {s.encrypted ? <LockKeyhole size={17} strokeWidth={2} /> : <LockKeyholeOpen size={17} strokeWidth={2} />}
          </span>
          <Text title={s.encrypted ? "Tu base de datos está cifrada" : "Tu base de datos no está cifrada"}
            sub={s.encrypted ? "Desde el " + when(s.encryptedAt) + ". Si alguien copia la carpeta de Colmena o el disco, no puede leer tus conversaciones ni lo que saben tus bots." : "Quien copie la carpeta de Colmena o el disco podría leer tus conversaciones."}
            subColor={s.encrypted ? MUTED : FAINT} />
          {!s.encrypted && !pending ? <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={pill(!open)}>{open ? "Cancelar" : "Cifrar…"}</button> : null}
        </div>
        {open && !s.encrypted && !pending ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px 20px", borderTop: LINE, background: "#FBFBF9", animation: "fade .25s ease-out" }}>
            <ol style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: 1.55, color: INK }}>
              <li>Se hace una copia de seguridad cifrada, por si algo saliera mal.</li>
              <li>Se crea una clave que {KEEPER[s.keyStore] || "guarda el sistema"}.</li>
              <li>Colmena se reinicia, cifra la base y comprueba que no falta nada y que todo sigue en su orden. Si algo no cuadra, lo deja como estaba.</li>
            </ol>
            <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: MUTED }}>Si un día reinstalas {isMac ? "macOS" : "Windows"} o borras tu cuenta, esa clave se pierde. Tus datos vuelven con una copia de seguridad: cada copia lleva la clave dentro, protegida con su contraseña.</p>
            {!s.backupReady ? <span style={{ fontSize: "13px", color: RED }}>Primero pon la contraseña de las copias, más arriba.</span> : null}
            <span><button type="button" disabled={!s.backupReady || busy === "prepare"} onClick={() => act("prepare", async () => { await post("/encryption/prepare", {}); setOpen(false); })}
              style={{ ...pill(true), opacity: s.backupReady ? 1 : 0.4, cursor: busy === "prepare" ? "wait" : "pointer" }}>{busy === "prepare" ? "Haciendo la copia…" : "Hacer la copia y preparar el cifrado"}</button></span>
          </div>
        ) : null}
        {s.failed ? (
          <div style={{ ...rowStyle(!s.done, "64px"), flexWrap: "wrap" }}>
            <Text title="No se pudo cifrar: todo sigue como estaba" sub={s.failed.error} subColor={RED} />
            <button type="button" onClick={() => act("dismiss", () => post("/encryption/dismiss/encrypt-failed", {}))} style={pill(false)}>Entendido</button>
          </div>
        ) : null}
        {s.encrypted && s.plainCopies?.length ? (
          <div style={{ ...rowStyle(!s.done, "64px"), alignItems: "flex-start" }}>
            <TriangleAlert size={16} strokeWidth={2} color={RED} aria-hidden="true" style={{ flex: "none", marginTop: "3px" }} />
            <Text title="Quedan copias antiguas sin cifrar" sub={`En la carpeta de Colmena: ${s.plainCopies.join(", ")}. Son lo que había antes de una restauración; bórralas cuando ya no las necesites.`} />
          </div>
        ) : null}
        {s.done && s.encrypted ? (
          <div style={{ ...rowStyle(true, "64px"), flexWrap: "wrap" }}>
            <Text title="Cifrado comprobado" sub={`Todos tus registros están, en su orden, y se descifran igual. Tardó ${Math.max(1, Math.round(s.done.ms / 1000))} s.`} subColor={GREEN} />
            <button type="button" onClick={() => act("dismiss", () => post("/encryption/dismiss/encrypt-done", {}))} style={{ ...pill(false), background: "transparent", color: MUTED }}>Ocultar</button>
          </div>
        ) : null}
      </Group>
      {error ? <p role="alert" style={{ margin: "0 20px", fontSize: "13px", color: RED }}>{error}</p> : null}

      <Group id="enc-q" title="Qué protege y qué no" anchor="cifrado-que-protege">
        {[
          ["Protege", "Tus conversaciones, lo que saben tus bots, tus ajustes y el historial de lo que hacen: si alguien se lleva la carpeta de Colmena o el disco, solo ve datos cifrados."],
          ["Se sigue viendo", "Cuántos registros hay de cada tipo, sus identificadores, fechas y estados (lo justo para encontrar las cosas rápido). Nunca el texto."],
          ["No protege", `A quien entre en ${isMac ? "tu Mac" : "Windows"} con tu cuenta: la clave se abre con ella. Tampoco los archivos de tus encargos (entregables, documentos) ni los puntos de «Deshacer cambios», que son archivos normales.`],
          ["Para los archivos", isMac
            ? "Activa FileVault (Ajustes del Sistema › Privacidad y seguridad › FileVault): cifra todo el disco, también la carpeta de Colmena."
            : "Con Windows Pro, cifra la carpeta de Colmena con EFS (clic derecho › Propiedades › Opciones avanzadas › «Cifrar contenido para proteger datos») o el disco entero con BitLocker. Guarda la clave de recuperación que te dé Windows."],
          ["Si se pierde la clave", "Colmena arranca vacía y aparta tus datos cifrados. Los recuperas restaurando una copia de seguridad: por eso conviene tenerlas automáticas."],
        ].map(([title, text], i, all) => (
          <div key={title} style={{ ...rowStyle(i === all.length - 1, "auto"), alignItems: "flex-start", padding: "16px 20px" }}>
            <span style={{ flex: "0 0 150px", display: "flex", alignItems: "center", gap: "8px", fontSize: "15px", fontWeight: 600 }}>{i === 4 ? <KeyRound size={15} strokeWidth={2} aria-hidden="true" /> : null}{title}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: "14px", lineHeight: 1.55, color: MUTED }}>{text}</span>
          </div>
        ))}
      </Group>
    </>
  );
}

import { useState } from "react";
import { del, post } from "../../../lib/api.js";
import { useExpert } from "../../../lib/expert.js";
import { Alert, Chip, INK, MUTED, SOFT, anchorOf, btn, h3 } from "./v3.jsx";

// Ajustes › Privacidad y datos › «Cifrado de este ordenador» (design/V3Privacidad.dc.html,
// server/encryption.mjs): the database encrypted with a key Windows (or the Mac's Keychain)
// keeps for your account. It is prepared here — an encrypted backup first — and done when
// Colmena starts again. Says plainly what it protects, what it does not, and what to use for
// the files. The parent owns the state (GET /api/encryption).

const RED = "#B4232A";
const date = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "");
const KEEPER = { dpapi: "La clave la guarda Windows", keychain: "La clave la guarda el Llavero de tu Mac", file: "La clave está en un archivo solo tuyo" };
const STORE = { dpapi: "DPAPI", keychain: "Llavero", file: "archivo" };
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent || "");
const banner = (bg) => ({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", padding: "12px 14px", borderRadius: "12px", background: bg, fontSize: "var(--t-ui)", lineHeight: 1.5 });

export default function EncryptionSettings({ s, reload }) {
  const [expert] = useExpert();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const act = async (what, fn) => {
    setBusy(what); setError(null);
    try { await fn(); await reload(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  if (!s) return null;
  const pending = s.pending;
  return (
    <section {...anchorOf("cifrado")} aria-labelledby="enc-t" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "20px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
      <div {...anchorOf("cifrado-estado")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", scrollMarginTop: "24px" }}>
        <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <h3 id="enc-t" style={{ ...h3, fontSize: "var(--t-read)" }}>Cifrado de este ordenador</h3>
          <span style={{ fontSize: "var(--t-meta)", color: MUTED }}>
            {s.encrypted ? `Tus chats y la memoria se guardan cifrados desde el ${date(s.encryptedAt)}. ${KEEPER[s.keyStore] || "La clave la guarda el sistema"}.` : "Quien copie la carpeta de Colmena o el disco podría leer tus conversaciones. Cifrarla tarda unos segundos."}
          </span>
        </span>
        {s.encrypted ? <Chip tone="green" style={{ height: "30px", padding: "0 12px", fontSize: "var(--t-meta)" }}>✓ Cifrada</Chip>
          : pending ? <Chip tone="grey" style={{ height: "30px", padding: "0 12px", fontSize: "var(--t-meta)" }}>Lista para cifrar</Chip>
          : <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={btn(open ? "outline" : "dark", 38)}>{open ? "Cancelar" : "Cifrar…"}</button>}
      </div>

      {s.locked ? (
        <div role="alert" style={banner("#FBEAE7")}>
          <span style={{ flex: "1 1 260px" }}>{`No encontré la clave de tu base de datos cifrada. Colmena ha empezado de cero y ha apartado tus datos cifrados en «${s.locked.folder}». Para recuperarlos, restaura una copia de seguridad.`}</span>
          <button type="button" onClick={() => act("dismiss", () => post("/encryption/dismiss/locked", {}))} style={btn("outline", 32)}>Entendido</button>
        </div>
      ) : null}
      {pending ? (
        <div role="status" style={banner("#F6F6F3")}>
          <span style={{ flex: "1 1 260px" }}>La copia de seguridad ya está hecha. Colmena cifra la base al reiniciarse: tarda unos segundos.</span>
          {s.canRelaunch
            ? <button type="button" onClick={() => act("restart", () => post("/encryption/relaunch", {}))} disabled={busy === "restart"} style={btn("dark", 34)}>{busy === "restart" ? "Reiniciando…" : "Reiniciar y cifrar"}</button>
            : <span style={{ color: MUTED }}>Cierra Colmena y vuelve a abrirla.</span>}
          <button type="button" onClick={() => act("cancel", () => del("/encryption/prepare"))} style={btn("outline", 34)}>Anular</button>
        </div>
      ) : null}
      {open && !s.encrypted && !pending ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px", borderRadius: "12px", background: "#F6F6F3", fontSize: "var(--t-ui)", lineHeight: 1.55, animation: "fade .25s ease-out" }}>
          <ol style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px", color: INK }}>
            <li>Se hace una copia de seguridad cifrada, por si algo saliera mal.</li>
            <li>Se crea una clave que {isMac ? "guarda el Llavero de tu Mac" : "guarda Windows para tu cuenta"}.</li>
            <li>Colmena se reinicia, cifra la base y comprueba que no falta nada. Si algo no cuadra, lo deja como estaba.</li>
          </ol>
          <span style={{ color: SOFT }}>Si un día reinstalas {isMac ? "macOS" : "Windows"} o borras tu cuenta, esa clave se pierde. Tus datos vuelven con una copia de seguridad: cada copia lleva la clave dentro, protegida con su contraseña.</span>
          {!s.backupReady ? <span style={{ color: RED }}>Primero pon la contraseña de las copias, más arriba.</span> : null}
          <span><button type="button" disabled={!s.backupReady || busy === "prepare"} onClick={() => act("prepare", async () => { await post("/encryption/prepare", {}); setOpen(false); })} style={{ ...btn("dark", 36), opacity: s.backupReady ? 1 : 0.4 }}>{busy === "prepare" ? "Haciendo la copia…" : "Hacer la copia y preparar el cifrado"}</button></span>
        </div>
      ) : null}
      {s.failed ? (
        <div style={banner("#FBEAE7")}>
          <span style={{ flex: "1 1 260px" }}><strong style={{ fontWeight: 600 }}>No se pudo cifrar: todo sigue como estaba.</strong> {s.failed.error}</span>
          <button type="button" onClick={() => act("dismiss", () => post("/encryption/dismiss/encrypt-failed", {}))} style={btn("outline", 32)}>Entendido</button>
        </div>
      ) : null}
      {s.encrypted && s.plainCopies?.length ? (
        <div style={banner("#F6F6F3")}>
          <span>{`Quedan copias antiguas sin cifrar en la carpeta de Colmena: ${s.plainCopies.join(", ")}. Son lo que había antes de una restauración; bórralas cuando ya no las necesites.`}</span>
        </div>
      ) : null}
      {s.done && s.encrypted ? (
        <div role="status" style={banner("#E3F4EC")}>
          <span style={{ flex: "1 1 260px", color: "#0B6B4A" }}>{`Cifrado comprobado: todos tus registros están, en su orden, y se descifran igual. Tardó ${Math.max(1, Math.round(s.done.ms / 1000))} s.`}</span>
          <button type="button" onClick={() => act("dismiss", () => post("/encryption/dismiss/encrypt-done", {}))} style={btn("ghost", 32)}>Ocultar</button>
        </div>
      ) : null}

      <details {...anchorOf("cifrado-que-protege")} style={{ padding: "12px 14px", borderRadius: "12px", background: "#F6F6F3", fontSize: "var(--t-ui)", lineHeight: 1.5 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Qué protege y qué no</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px", color: "#3D404A" }}>
          <span>Protege tus conversaciones, lo que saben tus bots, tus ajustes y el historial de lo que hacen si alguien copia la carpeta o se lleva el disco. Se sigue viendo cuántos registros hay, sus fechas y estados; nunca el texto.</span>
          <span>{`No protege si alguien entra en ${isMac ? "tu Mac" : "Windows"} con tu usuario, ni los archivos de tus tareas ni los puntos de «Deshacer cambios». Para eso, ${isMac ? "activa FileVault" : "activa BitLocker o cifra la carpeta de Colmena con EFS"}.`}</span>
          <span>Si se pierde la clave, Colmena arranca vacía y aparta tus datos cifrados: los recuperas restaurando una copia de seguridad.</span>
          {expert ? <span style={{ font: "400 var(--t-caption)/1.5 'Geist Mono', monospace", color: MUTED }}>{`AES-256-GCM por registro · clave en ${STORE[s.keyStore] || "el sistema"}`}</span> : null}
        </div>
      </details>
      <Alert>{error}</Alert>
    </section>
  );
}

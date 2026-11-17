// Moving from hosted Colmena to each person's own computer (docs/CLOUD.md › Cierre, 2026-11-17):
// - In the cloud, «Llevar tus conversaciones a tu ordenador»: your own chats with bots
//   (/api/cloud/export/mine.zip) and, for whoever runs the company, its channels and messages
//   (/api/chat/admin/export.zip). Both are ZIPs of the same format.
// - On the desktop, «Traer las conversaciones de la nube»: one of those ZIPs becomes private rooms
//   here with their history (server/cloud-import.mjs); you say who you were there first.
import { useState } from "react";
import { Download, Upload } from "../../Icon.js";
import { post } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { Alert, anchorOf, btn } from "./v3.jsx";

const card = { display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", scrollMarginTop: "24px" };
const text = { fontSize: "var(--t-ui)", color: "var(--c-text-2)", maxWidth: "68ch", lineHeight: 1.5 };

/** In the cloud: the two downloads. */
export function CloudExport() {
  const store = useStore();
  const role = store.cloud?.me?.role;
  const admin = role === "owner" || role === "admin";
  return (
    <section {...anchorOf("llevar")} aria-label="Llevar tus conversaciones a tu ordenador" style={card}>
      <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>Llevar tus conversaciones a tu ordenador</span>
      <span style={text}>Colmena pasa a funcionar en el ordenador de cada uno. Descarga tus conversaciones y, en la app de escritorio en modo «Solo en este ordenador», ábrelas con «Traer las conversaciones de la nube»: quedan como salas con todo su historial.</span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <a href="/api/cloud/export/mine.zip" download style={btn("dark", 40)}><Download size={16} />Mis chats con bots</a>
        {admin ? <a href="/api/chat/admin/export.zip" download style={btn("outline", 40)}><Download size={16} />Canales y mensajes de la empresa</a> : null}
      </span>
      {admin ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Los canales y mensajes los descarga quien administra la empresa y se los pasa a cada persona; cada uno los trae a su ordenador.</span> : <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Los canales y mensajes de la empresa te los pasa quien la administra.</span>}
    </section>
  );
}

const base64Of = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",").pop());
  r.onerror = () => reject(new Error("No se pudo leer el archivo."));
  r.readAsDataURL(file);
});
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** On the desktop: bring a ZIP in. */
export function CloudImport() {
  const { settings = {} } = useStore();
  const [zip, setZip] = useState(null); // base64
  const [preview, setPreview] = useState(null);
  const [me, setMe] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const pick = async (file) => {
    if (!file) return;
    setError(null); setDone(null); setPreview(null); setBusy(true);
    try {
      const data = await base64Of(file);
      const p = await post("/import/nube", { zip: data, preview: true });
      setZip(data); setPreview(p);
      // You, by your name here; with one person in it (your own chats), that one.
      const mine = p.members.length === 1 ? p.members[0] : p.members.find((x) => fold(x.name) === fold(settings.userName));
      setMe(mine?.id || "");
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const bring = async () => {
    setBusy(true); setError(null);
    try { setDone(await post("/import/nube", { zip, me: me || null })); setPreview(null); setZip(null); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <section {...anchorOf("traer")} aria-label="Traer las conversaciones de la nube" style={card}>
      <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>Traer las conversaciones de la nube</span>
      <span style={text}>Abre el ZIP que descargaste en Colmena en la nube (Ajustes › Dispositivos): tus chats con bots, o los canales y mensajes de la empresa. Cada conversación queda aquí como una sala privada con todo su historial y sus archivos; ningún bot se pone a trabajar. Si lo traes otra vez, solo se añade lo nuevo.</span>
      {error ? <Alert>{error}</Alert> : null}
      {!preview ? (
        <label style={{ ...btn("dark", 40), alignSelf: "flex-start", cursor: busy ? "default" : "pointer" }}>
          <Upload size={16} />{busy ? "Leyendo…" : "Elegir el ZIP…"}
          <input type="file" accept=".zip,application/zip" hidden disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span style={{ fontSize: "var(--t-ui)" }}><b>{preview.company}</b>{" · " + preview.channels.length + (preview.channels.length === 1 ? " conversación" : " conversaciones") + " · " + preview.channels.reduce((n, c) => n + c.messages, 0) + " mensajes"}</span>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "var(--t-meta)", color: "var(--c-text-2)", maxHeight: "160px", overflowY: "auto" }}>
            {preview.channels.map((c) => <li key={c.id}>{(c.kind === "public" || c.kind === "private" ? "#" : "") + c.title + " · " + c.messages}</li>)}
          </ul>
          {preview.members.length > 1 ? (
            <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)" }}>
              ¿Quién eras tú allí?
              <select value={me} onChange={(e) => setMe(e.target.value)} style={{ height: "34px", padding: "0 8px", borderRadius: "var(--r-sm)", border: "1px solid var(--c-line-strong)", background: "var(--c-card)", color: "var(--c-text)" }}>
                <option value="">Ninguna de estas personas</option>
                {preview.members.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          ) : null}
          <span style={{ display: "flex", gap: "8px" }}>
            <button type="button" disabled={busy} onClick={bring} style={btn("dark", 40)}>{busy ? "Trayendo…" : "Traer a este ordenador"}</button>
            <button type="button" disabled={busy} onClick={() => { setPreview(null); setZip(null); }} style={btn("outline", 40)}>Cancelar</button>
          </span>
        </div>
      )}
      {done ? (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-ui)" }}>
          <span>{"Listo: " + done.rooms.reduce((n, r) => n + r.added, 0) + " mensajes nuevos de " + done.company + (done.files ? " y " + done.files + (done.files === 1 ? " archivo" : " archivos") : "") + "."}</span>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>{done.rooms.map((r) => <li key={r.roomId}><a href={"/sala/" + encodeURIComponent(r.roomId)}>{r.title}</a>{r.kept ? " · " + r.kept + " ya estaban" : ""}</li>)}</ul>
          {done.skipped?.length ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"No se pudo traer: " + done.skipped.slice(0, 5).join(", ") + (done.skipped.length > 5 ? "…" : "")}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

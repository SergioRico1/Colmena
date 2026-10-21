import { useState } from "react";
import SettingsShell, { BotAvatar, Notice, PageHeader } from "../components/settings/SettingsShell.jsx";
import { useStore, useAction } from "../lib/store.jsx";
import { patch } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";

// /ajustes/permisos · «Qué app usa cada bot»: one row per bot, one column per kind of app.
// A cell cycles sin acceso → lee → escribe. Red lines (send outside, move money, delete,
// install) keep asking whatever the cell says.
const MATRIX = [
  { key: "correo", label: "Correo" },
  { key: "calendario", label: "Calendario" },
  { key: "carpeta", label: "Carpeta" },
  { key: "hojas", label: "Hojas" },
  { key: "chat", label: "Chat" },
];
const NEXT = { none: "lee", lee: "escribe", pide: "escribe", escribe: "none" };
const SAY = { none: "sin acceso", lee: "lee", pide: "lee y pide escribir", escribe: "escribe" };
const INK = "#12131A";
const MUTED = "#5C606C";
const LINE = "1px solid rgba(18,19,26,.06)";

export default function Ajustes() {
  const { bots, connectors, ready } = useStore();
  const { act, error } = useAction();
  const [pendingCell, setPendingCell] = useState(null);
  const team = bots.filter((b) => b.enabled !== false);
  const columns = connectors.some((c) => c.id === "erp" && c.connected) ? [...MATRIX, { key: "erp", label: "Contabilidad" }] : MATRIX;
  const connected = (key) => connectors.find((c) => c.id === key)?.connected;

  const rotate = (bot, key) => {
    const current = bot.tools?.[key] || "none";
    setPendingCell(bot.id + key);
    act(() => patch(`/bots/${encodeURIComponent(bot.id)}`, { tools: { ...(bot.tools || {}), [key]: NEXT[current] || "lee" } })).finally(() => setPendingCell(null));
  };
  const pill = (v) => (v === "escribe"
    ? { padding: "6px 12px", borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "13px", fontWeight: 600 }
    : { padding: "6px 12px", borderRadius: "999px", background: "#F4F4F0", color: INK, fontSize: "13px", fontWeight: 600 });

  const cell = (bot, key, last) => {
    const v = bot.tools?.[key] || "none";
    const label = `${bot.name} · ${columns.find((c) => c.key === key).label}: ${SAY[v]}. Pulsa para cambiar a ${SAY[NEXT[v] || "lee"]}.`;
    return (
      <td key={key} style={{ padding: "12px 8px", borderBottom: last ? 0 : LINE }}>
        <button type="button" aria-label={label} onClick={() => rotate(bot, key)} style={{ display: "inline-flex", alignItems: "center", gap: "6px", minHeight: "34px", padding: 0, border: 0, background: "transparent", cursor: "pointer", opacity: pendingCell === bot.id + key ? 0.5 : 1, color: "#9A9DA6" }}>
          {v === "none" ? "—" : <span style={pill(v)}>{v === "escribe" ? "Escribe" : "Lee"}</span>}
          {v === "pide" ? <span style={{ padding: "6px 10px", borderRadius: "999px", background: "#FFF4D1", color: "#8A5A00", fontSize: "12px", fontWeight: 600 }}>pide escribir</span> : null}
        </button>
      </td>
    );
  };

  return (
    <SettingsShell section="permisos" wide>
      <PageHeader title="Qué app usa cada bot">Conectar una app no da acceso a nadie: aquí decides qué bot la mira y cuál puede cambiar algo. Pulsa una casilla para cambiarla.</PageHeader>
      <Notice>{error}</Notice>
      <section aria-labelledby="matriz" style={{ background: "#FFFFFF", borderRadius: "26px", padding: "22px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <h2 id="matriz" style={{ margin: 0, font: "600 22px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Quién usa qué</h2>
          <ul aria-label="Leyenda" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "14px", fontSize: "13px", color: MUTED }}>
            <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={pill("escribe")}>Escribe</span>lee y cambia</li>
            <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={pill("lee")}>Lee</span>solo mira</li>
            <li style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ color: "#9A9DA6" }}>—</span>sin acceso</li>
          </ul>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: "640px", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th scope="col" style={{ padding: "10px 8px", borderBottom: LINE, fontSize: "13px", fontWeight: 500, color: MUTED }}>Bot</th>
                {columns.map((c) => (
                  <th key={c.key} scope="col" style={{ padding: "10px 8px", borderBottom: LINE, fontSize: "13px", fontWeight: 500, color: MUTED }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {c.label}
                      <span aria-label={connected(c.key) ? "conectada" : "sin conectar"} title={connected(c.key) ? "Conectada" : "Sin conectar"} style={{ width: "6px", height: "6px", borderRadius: "50%", background: connected(c.key) ? "#0B8A5F" : "rgba(18,19,26,.18)" }} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.length === 0 ? (
                <tr><td colSpan={columns.length + 1} style={{ padding: "14px 8px", color: MUTED }}>{ready ? "Aún no hay bots en el equipo." : "Cargando el equipo…"}</td></tr>
              ) : null}
              {team.map((b, i) => {
                const last = i === team.length - 1;
                return (
                  <tr key={b.id}>
                    <th scope="row" style={{ padding: "12px 8px", borderBottom: last ? 0 : LINE, textAlign: "left", fontWeight: 600 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}><BotAvatar bot={b} size={22} />{b.name}</span>
                    </th>
                    {columns.map((c) => cell(b, c.key, last))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p style={{ margin: "0 8px", fontSize: "13px", lineHeight: 1.5, color: MUTED }}>
        {"Enviar fuera, mover dinero, borrar e instalar siempre piden permiso. Las apps sin conectar (punto gris) se conectan en "}
        <a href="/ajustes/conexiones" onClick={(e) => { e.preventDefault(); navigate("/ajustes/conexiones"); }} style={{ color: "#1F4FD1", fontWeight: 500 }}>Apps conectadas</a>.
      </p>
    </SettingsShell>
  );
}

import { useState } from "react";
import { Banknote, Download, Lock, PackagePlus, Send, ShieldCheck, Trash2 } from "../Icon.js";
import { BotAvatar, Card, Notice, PageHeader, Toggle, btn } from "./SettingsShell.jsx";
import { csvCell } from "./format.jsx";
import VaultCard from "./Vault.jsx";
import ApiKeysCard from "./ApiKeys.jsx";
import { useAction, useStore } from "../../lib/store.jsx";
import { del, download, patch } from "../../lib/api.js";
import { dateTime } from "../../lib/format.js";
import { later } from "../../lib/undoToast.js";

const RED_LINES = [
  { title: "Enviar algo fuera", text: "Correos, mensajes y publicaciones a cualquiera fuera de Colmena.", Icon: Send },
  { title: "Mover dinero", text: "Pagos, transferencias, facturas emitidas o cambios en cuentas.", Icon: Banknote },
  { title: "Borrar", text: "Archivos, correos, registros o eventos, aunque se puedan recuperar.", Icon: Trash2 },
  { title: "Instalar", text: "Programas, extensiones o cambios en este ordenador.", Icon: PackagePlus },
];
const DECISION = {
  approved: { label: "Aprobado", style: { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" } },
  executed: { label: "Hecho", style: { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" } },
  executing: { label: "En curso", style: { background: "var(--c-honey-soft)", color: "var(--c-text)" } },
  answered: { label: "Respondido", style: { background: "var(--c-sunken)", color: "var(--c-text-2)" } },
  denied: { label: "Denegado", style: { background: "var(--c-error-soft)", color: "var(--c-error)" } },
};
const PAGE = 25;

/** Ajustes › Seguridad y registro: red lines, «Permitir siempre» rules and the decision log. */
export default function Seguridad() {
  const { approvals, bots, settings, state } = useStore();
  const grants = (state.grants || []).filter((g) => g.active !== false);
  const { act, busy, error } = useAction();
  const [shown, setShown] = useState(PAGE);
  const bot = (id) => bots.find((b) => b.id === id) || null;
  const who = (a) => (a.decidedBy === "regla" ? "Regla «Permitir siempre»" : a.decidedBy === "revisor" ? "Revisor de Colmena" : settings.userName || "Tú");
  const log = approvals
    .filter((a) => a.status && a.status !== "pending")
    .sort((a, b) => Date.parse(b.decidedAt || b.createdAt || 0) - Date.parse(a.decidedAt || a.createdAt || 0));

  const exportCsv = () => {
    const header = ["Fecha", "Bot", "Acción", "Detalle", "Decisión", "Quién decidió", "Motivo", "Misión"];
    const rows = log.map((a) => [
      new Date(a.decidedAt || a.createdAt).toISOString(),
      bot(a.botId)?.name || a.botId || "",
      a.title || "",
      a.summary || "",
      DECISION[a.status]?.label || a.status,
      who(a),
      a.denyReason || (a.decidedBy === "revisor" ? String(a.resolution || "").replace(/^Aprobado por el revisor:?\s*/, "") : ""),
      a.missionId || "",
    ]);
    const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
    download(`registro-colmena-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  };

  const cellStyle = (last) => (last ? { padding: "10px 8px", verticalAlign: "top" } : { padding: "10px 8px", borderBottom: "1px solid rgb(var(--c-ink-rgb) / .06)", verticalAlign: "top" });

  return (
    <>
      <PageHeader title="Seguridad y registro">Lo que tus bots nunca hacen sin preguntar, lo que has permitido para siempre y quién decidió cada cosa.</PageHeader>
      <Notice>{error}</Notice>

      <Card id="lineas" title="Líneas rojas" aside={<span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", fontWeight: "600" }}><Lock size={14} strokeWidth={2.2} aria-hidden="true" />Siempre activas</span>}>
        <p style={{ margin: "0", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-3)" }}>Estas acciones piden tu permiso en Hoy sea cual sea la autonomía del bot. No se pueden desactivar ni convertir en «Permitir siempre».</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))", gap: "10px" }}>
          {RED_LINES.map((r) => (
            <div key={r.title} style={{ padding: "14px", background: "var(--c-hover)", borderRadius: "var(--r-md)", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span aria-hidden="true" style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", background: "var(--c-card)", border: "1.5px solid var(--c-error)", color: "var(--c-error)", borderRadius: "var(--r-sm)" }}>
                <r.Icon size={17} strokeWidth={2} />
              </span>
              <strong style={{ fontSize: "var(--t-body)" }}>{r.title}</strong>
              <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.45", color: "var(--c-text-3)" }}>{r.text}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card id="revisor" title="Revisor automático">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <span style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "var(--t-ui)", lineHeight: "1.5" }}>
            <ShieldCheck size={18} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />
            <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <strong style={{ fontSize: "var(--t-body)" }}>{settings.autoReview !== false ? "Aprueba por ti lo rutinario" : "Todo pasa por ti"}</strong>
              <span style={{ color: "var(--c-text-3)" }}>Cuando un bot pide permiso para algo que no sale de Colmena (guardar un archivo o una entrega, rellenar una copia de un PDF, recordar algo), el modelo más barato lo revisa y, si es claramente parte de lo que pediste, lo aprueba. Si duda, te lo deja a ti. Las líneas rojas y las imágenes siempre te las pregunta.</span>
            </span>
          </span>
          <Toggle large on={settings.autoReview !== false} disabled={busy} label="Revisor automático" onChange={(v) => act(() => patch("/settings", { autoReview: v }))} />
        </div>
      </Card>

      <VaultCard />
      <ApiKeysCard />

      <Card id="siempre" title="Permitido siempre" aside={<span style={{ font: "500 var(--t-caption)/1 'Geist Mono', monospace", color: "var(--c-text-3)" }}>{grants.length} {grants.length === 1 ? "regla" : "reglas"}</span>}>
        {grants.length === 0 ? (
          <p style={{ margin: "0", padding: "14px", background: "var(--c-hover)", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-3)" }}>No has permitido nada para siempre. Cuando marques «Permitir siempre» al aprobar algo en Hoy, la regla aparecerá aquí y podrás revocarla.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {grants.map((g, i) => (
              <div key={g.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", minHeight: "56px", padding: "8px 0", borderTop: i ? "1px solid rgb(var(--c-ink-rgb) / .06)" : "0" }}>
                {bot(g.botId) ? <BotAvatar bot={bot(g.botId)} size={28} font={12} /> : <span aria-hidden="true" style={{ width: "28px", height: "28px", borderRadius: "var(--r-circle)", background: "var(--c-sunken)" }} />}
                <span style={{ flex: "1 1 240px", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
                  <strong style={{ fontSize: "var(--t-ui)" }}>{g.label || g.title || g.text || "Regla sin nombre"}</strong>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{[bot(g.botId)?.name || (g.botId ? g.botId : "Todos los bots"), g.createdAt ? `desde ${dateTime(g.createdAt)}` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" disabled={busy} onClick={() => later({ id: "grant:" + g.id, keys: ["grant:" + g.id], text: "Permiso retirado", error: "No se pudo retirar", run: () => act(() => del(`/grants/${encodeURIComponent(g.id)}`)) })} style={btn.quiet}>Revocar</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card id="registro" title="Registro de acciones" aside={<button type="button" onClick={exportCsv} disabled={!log.length} style={{ ...btn.outline, height: "36px", fontSize: "var(--t-meta)" }}>
        <Download size={14} strokeWidth={2.2} aria-hidden="true" />
        Exportar CSV
      </button>}>
        {log.length === 0 ? (
          <p style={{ margin: "0", padding: "14px", background: "var(--c-hover)", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>Aún no se ha decidido nada. Cada aprobación, rechazo o respuesta quedará aquí con la hora, el bot y quién decidió.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "640px", borderCollapse: "collapse", fontSize: "var(--t-ui)" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  {["Hora", "Bot", "Acción", "Decisión", "Quién"].map((h) => <th key={h} scope="col" style={{ padding: "10px 8px", borderBottom: "2px solid var(--c-text)", fontWeight: "600" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {log.slice(0, shown).map((a, i, list) => {
                  const last = i === list.length - 1;
                  const b = bot(a.botId);
                  const d = DECISION[a.status] || { label: a.status, style: { background: "var(--c-sunken)" } };
                  return (
                    <tr key={a.id}>
                      <td style={{ ...cellStyle(last), fontFamily: "'Geist Mono', monospace", fontSize: "var(--t-caption)", color: "var(--c-text-3)", whiteSpace: "nowrap" }}>{dateTime(a.decidedAt || a.createdAt)}</td>
                      <td style={cellStyle(last)}><span style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "600" }}>{b ? <BotAvatar bot={b} size={22} /> : null}{b?.name || "—"}</span></td>
                      <td style={cellStyle(last)}>
                        {a.missionId ? <a href={`/misiones/${encodeURIComponent(a.missionId)}`}>{a.title || a.summary || "Acción"}</a> : a.title || a.summary || "Acción"}
                        {a.denyReason ? <span style={{ display: "block", marginTop: "2px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Motivo: " + a.denyReason}</span> : null}
                      </td>
                      <td style={cellStyle(last)}><span style={{ padding: "3px 8px", borderRadius: "var(--r-xs)", fontSize: "var(--t-caption)", fontWeight: "600", ...d.style }}>{d.label}</span></td>
                      <td style={{ ...cellStyle(last), color: a.decidedBy === "regla" ? "var(--c-honey-text)" : "var(--c-text)" }}>{who(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {log.length > shown ? <button type="button" onClick={() => setShown(shown + PAGE)} style={{ ...btn.quiet, alignSelf: "flex-start" }}>{`Ver ${Math.min(PAGE, log.length - shown)} más`}</button> : null}
      </Card>
    </>
  );
}

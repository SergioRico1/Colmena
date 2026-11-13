import { useState } from "react";
import { Download } from "../Icon.js";
import { BotAvatar, Card, Notice, PageHeader, btn } from "./SettingsShell.jsx";
import { csvCell } from "./format.jsx";
import { useAction, useStore } from "../../lib/store.jsx";
import { download } from "../../lib/api.js";
import { navigate } from "../../lib/router.jsx";
import { dateTime } from "../../lib/format.js";

const DECISION = {
  approved: { label: "Aprobado", style: { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" } },
  executed: { label: "Hecho", style: { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" } },
  executing: { label: "En curso", style: { background: "var(--c-honey-soft)", color: "var(--c-text)" } },
  answered: { label: "Respondido", style: { background: "var(--c-sunken)", color: "var(--c-text-2)" } },
  denied: { label: "Denegado", style: { background: "var(--c-error-soft)", color: "var(--c-error)" } },
};
const PAGE = 25;

/**
 * Ajustes › Memoria y privacidad › Registro de acciones (/ajustes/seguridad): the decision log, with
 * its CSV. The red lines, the reviewer and the «Permitir siempre» rules used to be repeated here;
 * they live once, in Autonomía y permisos, and this page links there.
 */
export default function Seguridad() {
  const { approvals, bots, settings } = useStore();
  const { error } = useAction();
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
      <PageHeader title="Registro de acciones">Todo lo que tus bots han pedido y quién lo decidió: tú, el revisor automático o una regla «Permitir siempre».</PageHeader>
      <Notice>{error}</Notice>

      <p style={{ margin: 0, maxWidth: "720px", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-3)" }}>Lo que nunca hacen sin preguntarte (las líneas rojas), el revisor automático y lo que permitiste para siempre se cambian en <a href="/ajustes/permisos" onClick={(e) => { e.preventDefault(); navigate("/ajustes/permisos"); }} style={{ color: "var(--c-accent-ink)", fontWeight: 600 }}>Autonomía y permisos</a>.</p>

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
                        {a.missionId ? <a href={`/encargo/${encodeURIComponent(a.missionId)}`}>{a.title || a.summary || "Acción"}</a> : a.title || a.summary || "Acción"}
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

import { useEffect, useState } from "react";
import { get, put } from "../../../lib/api.js";
import { FieldRow, Group, Segmented, SwitchRow } from "../settings/rows.jsx";

// Ajustes › Bots y autonomía › Tareas de Código (T3 Code auto-settle rules): finished tasks leave
// the list on their own when saved into main, when their PR closes, or after some idle days.
// Each project can change the days and «conservar con PR» from its «…» in Código.

const DAYS = [[0, "Nunca"], [1, "1 día"], [3, "3 días"], [7, "7 días"], [14, "14 días"]];

export default function CodeArchiveSettings() {
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { get("/code/archive-settings").then((d) => setRules(d.rules), (e) => setError(e.message)); }, []);
  // A link to …#codigo-archivar arrives before this group has loaded: go there once it shows.
  useEffect(() => {
    if (rules && window.location.hash === "#codigo-archivar") document.getElementById("codigo-archivar")?.scrollIntoView({ block: "start" });
  }, [!!rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (change) => {
    setBusy(true); setError(null);
    try { setRules((await put("/code/archive-settings", change)).rules); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (!rules) return error ? <p role="alert" style={{ margin: "0 20px", fontSize: "14px", color: "#B4231A" }}>{error}</p> : null;
  return (
    <Group id="cod-arch-t" title="Tareas de Código" anchor="codigo-archivar"
      note="Archivar no borra nada: la tarea pasa a «Archivadas» y vuelve si le escribes. Nunca se archiva sola si está fijada, trabaja, te espera, tiene mensajes en cola o está pospuesta.">
      <FieldRow title="Archivar las inactivas" sub="Tras estos días sin que escribas ni trabaje. Cada proyecto puede tener los suyos." control="1 1 360px">
        <Segmented label="Archivar las inactivas tras" items={DAYS} value={rules.idleDays} busy={busy} onPick={(v) => save({ idleDays: v })} />
      </FieldRow>
      <SwitchRow title="Al guardarla en main" sub="Su copia ya se limpia; la tarea sale de la lista." on={rules.onSave} busy={busy} onChange={(v) => save({ onSave: v })} />
      <SwitchRow title="Al fusionarse o cerrarse su PR" on={rules.onPr} busy={busy} onChange={(v) => save({ onPr: v })} />
      <SwitchRow title="Conservar las que tienen una PR abierta" sub="Aunque pasen los días sin actividad." on={rules.keepWithPr} busy={busy} onChange={(v) => save({ keepWithPr: v })} last />
      {error ? <p role="alert" style={{ margin: 0, padding: "0 20px 14px", fontSize: "14px", color: "#B4231A" }}>{error}</p> : null}
    </Group>
  );
}

import { useEffect, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import MemoryImport from "../components/library/MemoryImport.jsx";
import Files from "../components/v3/library/Files.jsx";
import Skills from "../components/v3/library/Skills.jsx";
import Memory from "../components/v3/library/Memory.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { pickTextFiles, post } from "../lib/api.js";
import { useExpert } from "../lib/expert.js";

// Colmena 3 · Biblioteca (design/V3Archivos, V3Habilidades, V3Memoria .dc.html): what the bots
// produce and what they know, in three tabs that each answer one question — Archivos (what
// they deliver), Habilidades (what they learned to do) and Memoria (what they know about you).
// /biblioteca/<tab>; the old /archivo?tab=… and ?archivo=<id> addresses still land here; ?abrir=<id> opens that file.

const TABS = [
  { id: "archivos", label: "Archivos", sub: "lo que entregan" },
  { id: "habilidades", label: "Habilidades" },
  { id: "memoria", label: "Memoria", sub: "lo que saben de ti" },
];
const ALIAS = { done: "archivos", skills: "habilidades", mem: "memoria", "saben-de-ti": "memoria" };
const tabOf = (v) => (TABS.some((t) => t.id === v) ? v : ALIAS[v] || "archivos");
const WIDTH = { archivos: "1180px", habilidades: "1120px", memoria: "1080px" };

export default function ArchivoV2({ params = {}, query = {} }) {
  const { artifacts = [], bots = [], missions = [], skills = [], memories = [], ready } = useStore();
  const [expert] = useExpert();
  const tab = tabOf(params.tab || query.pestana || query.tab || (query.abrir || query.archivo || query.artefacto ? "archivos" : null));
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState(null);
  const act = useAction();
  useEffect(() => { setNote(null); }, [tab]);
  const pending = skills.filter((s) => s.status === "pending").length;

  const importSkill = async () => {
    let files;
    try { files = await pickTextFiles({ multiple: false, accept: ".md,.markdown,.txt" }); } catch (e) { setNote({ error: true, text: e.message }); return; }
    if (!files?.length) return;
    const ok = await act.act(() => post("/skills", { content: files[0].content, source: files[0].name }));
    setNote(ok !== undefined ? { text: `«${files[0].name}» importada. Revisa sus pasos antes de activarla.` } : { error: true, text: act.error || "No se pudo importar" });
  };
  const action = tab === "habilidades"
    ? <button type="button" onClick={importSkill} disabled={act.busy} style={{ height: "44px", padding: "0 18px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "15px", fontWeight: "500", cursor: "pointer" }}>{"Importar una habilidad"}</button>
    : tab === "memoria"
      ? <button type="button" onClick={() => setImporting(true)} style={{ height: "44px", padding: "0 18px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "15px", fontWeight: "500", cursor: "pointer" }}>{"Importar de ChatGPT"}</button>
      : null;

  return (
    <Shell active="biblioteca">
      <main style={{ maxWidth: WIDTH[tab], margin: "0 auto", padding: "44px clamp(20px, 4vw, 48px) 64px", display: "flex", flexDirection: "column", gap: "22px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h1 style={{ margin: "0", font: "600 44px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{"Biblioteca"}</h1>
            <p style={{ margin: "0", fontSize: "16px", color: "#4A4D57" }}>{"Lo que producen tus bots y lo que saben: archivos, habilidades y memoria."}</p>
          </div>
          {action}
        </header>
        <nav aria-label="Partes de la Biblioteca" style={{ display: "flex", flexWrap: "wrap", gap: "4px", borderBottom: "1px solid rgba(18,19,26,.1)" }}>
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              <a key={t.id} href={`/biblioteca/${t.id}`} aria-current={on ? "page" : undefined} style={{ height: "44px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", borderBottom: on ? "2px solid #12131A" : undefined, marginBottom: on ? "-1px" : undefined, color: on ? "#12131A" : "#4A4D57", fontSize: "15px", fontWeight: on ? "600" : "500" }}>
                {t.label}
                {t.id === "habilidades" && pending ? <span aria-label={`${pending} por revisar`} style={{ minWidth: "20px", height: "20px", padding: "0 6px", display: "grid", placeItems: "center", borderRadius: "10px", background: "#FFC93C", color: "#12131A", fontSize: "11.5px", fontWeight: "600" }}>{String(pending)}</span> : null}
                {t.sub ? <span style={{ fontSize: "12.5px", color: "#5C606C" }}>{t.sub}</span> : null}
              </a>
            );
          })}
        </nav>
        {tab === "archivos" ? <Files artifacts={artifacts} bots={bots} missions={missions} ready={ready} expert={expert} initial={query.abrir || query.archivo || query.artefacto || null} /> : null}
        {tab === "habilidades" ? <Skills skills={skills} bots={bots} expert={expert} note={note} /> : null}
        {tab === "memoria" ? <Memory memories={memories} bots={bots} missions={missions} expert={expert} /> : null}
      </main>
      {importing ? <MemoryImport onClose={() => setImporting(false)} /> : null}
    </Shell>
  );
}

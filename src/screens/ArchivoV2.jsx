import { useEffect, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import MemoryImport from "../components/library/MemoryImport.jsx";
import Files from "../components/v3/library/Files.jsx";
import Skills from "../components/v3/library/Skills.jsx";
import Memory from "../components/v3/library/Memory.jsx";
import Notes, { NotesActions } from "../components/v3/library/Notes.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { pickTextFiles, post } from "../lib/api.js";
import { useExpert } from "../lib/expert.js";

// Colmena 3 · Biblioteca (design/V3Archivos, V3Habilidades, V3Memoria .dc.html): what the bots
// produce and what they know, in four tabs that each answer one question — Archivos (what
// they deliver), Notas (what you all keep written: the shared wiki), Habilidades (what they
// learned to do) and Memoria (what they know about you).
// /biblioteca/<tab>, and /biblioteca/notas/<slug> for one note; the old /archivo?tab=… and ?archivo=<id> addresses still land here; ?abrir=<id> opens that file.

const TABS = [
  { id: "archivos", label: "Archivos", sub: "lo que entregan" },
  { id: "notas", label: "Notas", sub: "lo que sabéis todos" },
  { id: "habilidades", label: "Habilidades" },
  { id: "memoria", label: "Memoria", sub: "lo que saben de ti" },
];
const ALIAS = { done: "archivos", skills: "habilidades", mem: "memoria", "saben-de-ti": "memoria", wiki: "notas" };
const tabOf = (v) => (TABS.some((t) => t.id === v) ? v : ALIAS[v] || "archivos");
// One column for the four tabs: the left edge of the text stays put when you switch.
const WIDTH = "1180px";

export default function ArchivoV2({ params = {}, query = {} }) {
  const { artifacts = [], bots = [], missions = [], skills = [], memories = [], ready } = useStore();
  const [expert] = useExpert();
  // /biblioteca/notas/<slug> has no :tab: a note is always in «Notas».
  const tab = params.slug !== undefined ? "notas" : tabOf(params.tab || query.pestana || query.tab || (query.abrir || query.archivo || query.artefacto ? "archivos" : null));
  const [noteDialog, setNoteDialog] = useState(null); // "new" | "import"
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
    ? <button type="button" onClick={importSkill} disabled={act.busy} style={{ height: "36px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-sm)", background: "var(--c-card)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" }}>{"Importar una habilidad"}</button>
    : tab === "memoria"
      ? <button type="button" onClick={() => setImporting(true)} style={{ height: "36px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-sm)", background: "var(--c-card)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" }}>{"Importar de ChatGPT"}</button>
      : tab === "notas" && params.slug === undefined
        ? <NotesActions onNew={() => setNoteDialog("new")} onImport={() => setNoteDialog("import")} />
        : null;

  return (
    <Shell active="biblioteca" background="var(--c-app)">
      <main style={{ maxWidth: WIDTH, margin: "0 auto", padding: "44px clamp(20px, 4vw, 48px) 64px", display: "flex", flexDirection: "column", gap: "22px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h1 style={{ margin: "0", font: "700 var(--t-headline)/1.15 'Bricolage Grotesque', 'Geist', sans-serif", letterSpacing: "-0.015em" }}>{"Biblioteca"}</h1>
            <p style={{ margin: "0", fontSize: "var(--t-read)", color: "var(--c-text-2)" }}>{"Lo que producen tus bots y lo que saben: archivos, notas, habilidades y memoria."}</p>
          </div>
          {action}
        </header>
        <nav aria-label="Partes de la Biblioteca" style={{ display: "flex", flexWrap: "wrap", gap: "4px", borderBottom: "1px solid rgb(var(--c-ink-rgb) / .1)" }}>
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              <a key={t.id} href={`/biblioteca/${t.id}`} aria-current={on ? "page" : undefined} style={{ height: "44px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", borderBottom: on ? "2px solid var(--c-text)" : undefined, marginBottom: on ? "-1px" : undefined, color: on ? "var(--c-text)" : "var(--c-text-2)", fontSize: "var(--t-body)", fontWeight: on ? "600" : "500" }}>
                {t.label}
                {t.id === "habilidades" && pending ? <span aria-label={`${pending} por revisar`} style={{ minWidth: "20px", height: "20px", padding: "0 6px", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .1)", color: "var(--c-text)", fontSize: "var(--t-caption)", fontWeight: "600" }}>{String(pending)}</span> : null}
                {t.sub ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{t.sub}</span> : null}
              </a>
            );
          })}
        </nav>
        {tab === "archivos" ? <Files artifacts={artifacts} bots={bots} missions={missions} ready={ready} expert={expert} initial={query.abrir || query.archivo || query.artefacto || null} /> : null}
        {tab === "notas" ? <Notes slug={params.slug ?? null} query={query} bots={bots} missions={missions} expert={expert} dialog={noteDialog} onDialog={setNoteDialog} /> : null}
        {tab === "habilidades" ? <Skills skills={skills} bots={bots} expert={expert} note={note} /> : null}
        {tab === "memoria" ? <Memory memories={memories} bots={bots} missions={missions} expert={expert} /> : null}
      </main>
      {importing ? <MemoryImport onClose={() => setImporting(false)} /> : null}
    </Shell>
  );
}

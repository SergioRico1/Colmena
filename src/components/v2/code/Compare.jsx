import { useEffect, useMemo, useState } from "react";
import { get, post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { useStore } from "../../../lib/store.jsx";
import { reversible } from "../../../lib/undoToast.js";
import { C, HEAD, MONO, BTN, EFFORT_LABEL } from "./parts.jsx";
import { ENGINE_NAME } from "./EngineModels.jsx";
import { recommendOf, durationLabel } from "./model.js";

// «Comparar motores» (design/V3CodigoComparar.dc.html; T3 Code does not have it): the same
// request done by several engines at once, each in its copy, side by side: whether the project's
// tests pass, what it changed, how long it took and what it said. Choosing one keeps its branch
// as the task; the others are archived (not deleted) and come back with «Deshacer».

const WORDS = ["", "un", "dos", "tres", "cuatro"];
/** Bruno's last words without Markdown marks, for a short preview. */
const plain = (text) => String(text || "").replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
const TESTS = { passed: ["Pasan", "var(--c-ok-soft)", C.greenText], failed: ["Fallan", C.redSoft, C.red], running: ["Probando…", C.card, C.text2], queued: ["En cola…", C.card, C.text2] };
const tokens = (n) => (n >= 1000 ? Math.round(n / 1000) + " k" : String(n));

function Stat({ label, value, bg = C.card, ink = C.ink, mono = false }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: bg }}>
      <span style={{ display: "block", fontSize: "var(--t-caption)", color: C.text2 }}>{label}</span>
      <span style={mono ? { font: `600 var(--t-ui)/1.4 ${MONO}` } : { fontSize: "var(--t-ui)", fontWeight: 600, color: ink }}>{value}</span>
    </div>
  );
}

export default function Compare({ group, projects = [] }) {
  const { bots } = useStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [picked, setPicked] = useState(null);
  // The tasks' records come live with the project list: refetch what each changed when they move.
  const live = useMemo(() => projects.flatMap((p) => p.tasks).filter((t) => t.group === group), [projects, group]);
  const key = live.map((t) => t.id + t.updatedAt + t.status + (t.tests?.status || "") + (t.archived ? "a" : "")).join("|");
  useEffect(() => {
    let alive = true;
    get("/code/compare/" + group).then((d) => alive && setData(d), (e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [group, key]);
  if (error && !data) return <section style={{ flex: 1, display: "grid", placeItems: "center", color: C.faint }}>{error}</section>;
  if (!data) return <section style={{ flex: 1 }} />;
  const tasks = data.tasks.map((t) => ({ ...t, ...(live.find((x) => x.id === t.id) || {}), files: t.files, said: t.said, asked: t.asked }));
  const project = projects.find((p) => p.id === tasks[0]?.projectId) || null;
  const title = tasks[0]?.title.replace(/ · [^·]+(?: · [^·]+)?$/, "") || "Comparar";
  const asked = tasks[0]?.asked || title;
  const open = tasks.filter((t) => !t.archived);
  // Chosen: the one you picked here, or the only one left open after choosing.
  const chosen = picked || (tasks.length > 1 && open.length === 1 ? open[0].id : null);
  const working = tasks.some((t) => t.running || t.status === "working");
  const testing = tasks.some((t) => ["running", "queued"].includes(t.tests?.status));
  const tested = tasks.some((t) => ["passed", "failed"].includes(t.tests?.status));
  const rec = recommendOf(tasks);
  const recTask = rec ? tasks.find((t) => t.id === rec.id) : null;
  const engineOf = (t) => ENGINE_NAME[t.engine] || t.engine;
  const atlas = (bots || []).find((b) => b.id === "atlas");
  const act = async (name, fn) => { setBusy(name); setError(null); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); } };
  const testAll = () => act("tests", () => post("/code/compare/" + group + "/tests", {}));
  const choose = (t) => act("pick:" + t.id, async () => {
    const others = tasks.filter((x) => x.id !== t.id && !x.archived);
    if (t.archived) await post("/code/tasks/" + t.id + "/archive", { archived: false });
    for (const x of others) await post("/code/tasks/" + x.id + "/archive", { archived: true });
    setPicked(t.id);
    reversible({ id: "compare:" + group, text: others.length === 1 ? "La otra propuesta está archivada" : `Las otras ${others.length} propuestas están archivadas`,
      undo: async () => { for (const x of others) await post("/code/tasks/" + x.id + "/archive", { archived: false }); setPicked(null); } });
  });
  const n = tasks.length;
  const band = working ? { text: `Los ${WORDS[n] || n} trabajan a la vez, cada uno en su copia. Cuando acaben, pruébalos y elige uno.` }
    : testing ? { text: "Probando cada copia con «" + data.testCommand + "»…" }
      : rec ? { strong: (atlas?.name || "Colmena") + " recomienda " + engineOf(recTask) + ":", text: " " + rec.why, button: chosen === rec.id ? null : ["Seguir su consejo", () => choose(recTask)] }
        : tested ? { text: "Ninguno pasa los tests todavía. Abre el que esté más cerca y pide a Bruno que lo arregle.", button: data.testCommand ? ["Volver a probar", testAll] : null }
          : data.testCommand ? { text: `Antes de elegir, prueba los ${WORDS[n] || n} con «${data.testCommand}», cada uno en su copia.`, button: ["Probar todos", testAll] }
            : { text: "Este proyecto no tiene un script «test» (en package.json o colmena.json): compara los cambios y elige." };
  const chosenTask = tasks.find((t) => t.id === chosen);
  const rest = n - 1;
  const bar = chosenTask ? `Elegiste ${chosenTask.label || engineOf(chosenTask)}. Su rama pasa a ser la tarea; ${rest === 1 ? "la otra queda archivada" : "las otras " + (WORDS[rest] || rest) + " quedan archivadas"}, por si cambias de idea.`
    : `Al elegir uno, su rama pasa a ser la tarea. ${rest === 1 ? "El otro se archiva; no se borra." : "Los otros " + (WORDS[rest] || rest) + " se archivan; no se borran."}`;
  return (
    <section aria-label="Comparar motores" style={{ flex: 1, minWidth: 0, height: "100%", overflowY: "auto", overscrollBehavior: "contain", animation: "fade .3s ease-out" }}>
      <main style={{ maxWidth: "1180px", margin: "0 auto", padding: "36px clamp(20px, 4vw, 44px) 56px", display: "flex", flexDirection: "column", gap: "24px" }}>
        <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", color: C.muted }}>
          <a href="/codigo" style={{ color: C.muted }}>Código</a><span aria-hidden="true">›</span>
          {project ? <><a href={"/codigo?proyecto=" + project.id} style={{ fontFamily: MONO, color: C.muted }}>{project.name}</a><span aria-hidden="true">›</span></> : null}
          <span style={{ color: C.ink, fontWeight: 500 }}>Comparar</span>
        </nav>
        <header style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h1 style={{ margin: 0, font: `700 var(--t-headline)/1.15 ${HEAD}`, letterSpacing: "-0.015em" }}>{title}</h1>
          <p style={{ margin: 0, fontSize: "var(--t-read)", color: C.text2 }}>La misma petición a {WORDS[n] || n} motores, cada uno en su copia del proyecto. Elige el que se queda; los otros se archivan, no se borran.</p>
          <p style={{ margin: "4px 0 0", padding: "14px 18px", borderRadius: "var(--r-lg)", background: C.white, fontSize: "var(--t-body)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>«{asked.trim()}»</p>
        </header>

        <section aria-label="Recomendación" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 22px", padding: "18px 22px", borderRadius: "var(--r-2xl)", background: C.ink, color: C.white }}>
          <span aria-hidden="true" style={{ flex: "none", width: "28px", height: "28px", background: C.white, clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" }} />
          <p style={{ flex: "1 1 420px", margin: 0, fontSize: "var(--t-read)", lineHeight: 1.55, color: "var(--c-line)" }}>{band.strong ? <strong style={{ color: C.white, fontWeight: 600 }}>{band.strong}</strong> : null}{band.text}</p>
          {band.button ? <button type="button" onClick={band.button[1]} disabled={!!busy} style={{ height: "36px", padding: "0 14px", border: 0, borderRadius: "var(--r-sm)", background: C.white, color: C.ink, fontSize: "var(--t-ui)", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>{busy === "tests" ? "Lanzando…" : band.button[0]}</button> : null}
        </section>
        {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: C.red }}>{error}</p> : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "14px" }}>
          {tasks.map((t) => {
            const on = chosen === t.id;
            const files = t.files || [];
            const test = t.tests ? TESTS[t.tests.status] : null;
            const effort = EFFORT_LABEL[t.effort] ? " · esfuerzo " + EFFORT_LABEL[t.effort].toLowerCase() : "";
            const label = t.label ? t.label.split(" · ")[0] : engineOf(t);
            return (
              <article key={t.id} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px", borderRadius: "var(--r-2xl)", background: C.white, boxShadow: "0 0 0 2px " + (on ? C.ink : "transparent"), opacity: t.archived && !on ? 0.7 : 1 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>{label}</span>
                    <span style={{ font: `400 var(--t-meta)/1.3 ${MONO}`, color: C.muted }}>{t.model}{effort}</span>
                  </div>
                  {rec?.id === t.id ? <span style={{ flex: "none", height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: C.ink, color: C.white, fontSize: "var(--t-caption)", fontWeight: 600 }}>Recomendado</span>
                    : t.running || t.status === "working" ? <span style={{ flex: "none", height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-chip)", color: C.blue, fontSize: "var(--t-caption)", fontWeight: 600 }}>Trabajando</span>
                      : t.archived && !on ? <span style={{ flex: "none", height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: C.track, color: C.text2, fontSize: "var(--t-caption)", fontWeight: 600 }}>Archivada</span> : null}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                  <Stat label="Tests" value={test ? test[0] : "Sin probar"} bg={test ? test[1] : C.card} ink={test ? test[2] : C.text2} />
                  <div style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: C.card }}><span style={{ display: "block", fontSize: "var(--t-caption)", color: C.text2 }}>Cambios</span><span style={{ font: `600 var(--t-ui)/1.4 ${MONO}` }}>{t.add || t.del ? <><span style={{ color: C.greenText }}>+{t.add || 0}</span> <span style={{ color: C.red }}>−{t.del || 0}</span></> : "—"}</span></div>
                  <Stat label="Tiempo" value={durationLabel(t.workMs) || "—"} />
                  <Stat label="Contexto" value={t.usage?.used ? tokens(t.usage.used) + " tokens" : "—"} />
                </div>
                <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: C.text, minHeight: "63px", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.said ? plain(t.said) : t.running ? "Aún trabajando…" : "Sin resumen."}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", paddingTop: "10px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .07)" }}>
                  {files.slice(0, 6).map((f) => (
                    <div key={f.path} style={{ display: "flex", justifyContent: "space-between", gap: "10px", font: `400 var(--t-meta)/1.8 ${MONO}` }}>
                      <span title={f.path} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path.split("/").pop()}</span>
                      <span style={{ flex: "none", color: C.greenText }}>{[f.add ? "+" + f.add : "", f.del ? "−" + f.del : ""].filter(Boolean).join(" ")}</span>
                    </div>
                  ))}
                  {files.length > 6 ? <span style={{ fontSize: "var(--t-caption)", color: C.faint }}>y {files.length - 6} más</span> : null}
                  {t.files === null ? <span style={{ fontSize: "var(--t-meta)", color: C.faint }}>Aún trabajando…</span> : !files.length ? <span style={{ fontSize: "var(--t-meta)", color: C.faint }}>No cambió archivos.</span> : null}
                </div>
                <span style={{ flex: 1 }} />
                <div style={{ display: "flex", gap: "8px" }}>
                  <a href={"/codigo/" + t.id} onClick={(e) => { e.preventDefault(); navigate("/codigo/" + t.id); }} style={{ ...BTN.outline, height: "42px", padding: "0 16px", fontWeight: 500 }}>Ver cambios</a>
                  <button type="button" onClick={() => !on && choose(t)} disabled={!!busy || t.running || !files.length}
                    style={{ flex: 1, height: "36px", border: 0, borderRadius: "var(--r-sm)", background: on ? "var(--c-ok-ink)" : C.ink, color: C.white, fontSize: "var(--t-ui)", fontWeight: 600, cursor: busy || t.running || !files.length || on ? "default" : "pointer", opacity: !on && (t.running || !files.length) ? 0.45 : 1 }}>
                    {busy === "pick:" + t.id ? "Eligiendo…" : on ? "Elegido ✓" : "Elegir este"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "14px 18px", borderRadius: "var(--r-xl)", background: C.white, fontSize: "var(--t-body)" }}>
          <span style={{ flex: "1 1 300px", color: C.text }}>{bar}</span>
          {chosenTask ? <a href={"/codigo/" + chosenTask.id} onClick={(e) => { e.preventDefault(); navigate("/codigo/" + chosenTask.id); }} style={{ fontSize: "var(--t-ui)", fontWeight: 500, color: C.blue }}>Abrir la tarea</a> : null}
          <a href="/ajustes/ia" onClick={(e) => { e.preventDefault(); navigate("/ajustes/ia"); }} style={{ fontSize: "var(--t-ui)", color: C.blue }}>Motores y modelos por defecto</a>
        </div>
      </main>
    </section>
  );
}

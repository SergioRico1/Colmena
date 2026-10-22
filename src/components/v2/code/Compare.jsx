import { useEffect, useMemo, useState } from "react";
import { FlaskConical, ArrowUpRight, GitMerge, Trash2, Check, X } from "lucide-react";
import { get, post, del } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { C, HEAD, MONO, CARD, BrunoMark, Stat } from "./parts.jsx";
import { taskStatus } from "./ProjectList.jsx";

// «Comparar» (Colmena's own; T3 Code does not have it): the same request done by several engines
// at once, side by side: what each one changed, what it said and whether the project's tests
// pass in its copy. You pick the best one and save it into the base; the others can go.

const TESTS = {
  passed: { text: "Pasan los tests", bg: C.greenSoft, fg: "#0B5A3E" },
  failed: { text: "Fallan los tests", bg: "#FCEEEB", fg: "#7A2A1F" },
  running: { text: "Probando…", bg: "rgba(255,122,26,.1)", fg: "#9A4A0A" },
  queued: { text: "En cola…", bg: C.soft, fg: C.muted },
};

/** Bruno's last words without Markdown marks, for a short preview. */
const plain = (text) => String(text || "").replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();

export default function Compare({ group, projects = [] }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [chosen, setChosen] = useState(null);
  // The tasks' records come live with the project list: refetch what each changed when they move.
  const live = useMemo(() => projects.flatMap((p) => p.tasks).filter((t) => t.group === group), [projects, group]);
  const key = live.map((t) => t.id + t.updatedAt + t.status + (t.tests?.status || "")).join("|");
  useEffect(() => {
    let alive = true;
    get("/code/compare/" + group).then((d) => alive && setData(d), (e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [group, key]);
  if (error && !data) return <section style={{ flex: 1, display: "grid", placeItems: "center", color: C.faint }}>{error}</section>;
  if (!data) return <section style={{ flex: 1 }} />;
  const tasks = data.tasks.map((t) => ({ ...t, ...(live.find((x) => x.id === t.id) || {}), files: t.files, said: t.said }));
  const title = tasks[0]?.title.replace(/ · [^·]+ · [^·]+$/, "") || "Comparar";
  const act = async (name, fn) => { setBusy(name); setError(null); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); } };
  const testAll = () => act("tests", () => post("/code/compare/" + group + "/tests", {}));
  const choose = (t) => act("save:" + t.id, async () => {
    const r = await post("/code/tasks/" + t.id + "/save", { to: "base" });
    if (r?.resolving) throw Error("Hay cambios que chocan con " + (t.base || "main") + ": Bruno los está resolviendo en esa tarea. Guarda cuando acabe.");
    setChosen(t.id);
  });
  const dropOthers = () => act("drop", async () => { for (const t of tasks.filter((x) => x.id !== chosen)) await del("/code/tasks/" + t.id); navigate("/codigo/" + chosen); });
  const working = tasks.some((t) => t.running || t.status === "working");
  return (
    <section aria-label="Comparar" style={{ flex: 1, minWidth: 0, height: "100%", overflowY: "auto", overscrollBehavior: "contain", animation: "fade .3s ease-out" }}>
      <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "34px clamp(20px, 3vw, 40px) 40px", display: "flex", flexDirection: "column", gap: "22px" }}>
        <header style={{ display: "flex", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>Comparar · {tasks.length} motores con la misma petición</span>
            <h1 style={{ margin: 0, font: `600 28px/1.1 ${HEAD}`, letterSpacing: "-0.025em" }}>{title}</h1>
          </div>
          <button type="button" onClick={testAll} disabled={!data.testCommand || !!busy || working} title={data.testCommand ? "Ejecuta «" + data.testCommand + "» en la copia de cada uno" : "Este proyecto no tiene un script «test»"}
            style={{ display: "flex", alignItems: "center", gap: "8px", height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: C.ink, color: C.white, cursor: !data.testCommand || busy || working ? "default" : "pointer", fontSize: "14px", fontWeight: 600, opacity: !data.testCommand || busy || working ? 0.5 : 1 }}>
            <FlaskConical size={15} strokeWidth={2.2} aria-hidden="true" />{busy === "tests" ? "Lanzando…" : "Probar todos"}
          </button>
        </header>
        {!data.testCommand ? <p style={{ margin: 0, fontSize: "13px", color: C.faint }}>Este proyecto no tiene un script «test» (en package.json o colmena.json): se comparan solo los cambios.</p> : null}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: C.red }}>{error}</p> : null}
        {chosen ? (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "18px", background: C.greenSoft, color: "#0B5A3E", fontSize: "14px", animation: "rise .25s ease-out" }}>
            <Check size={16} strokeWidth={2.6} aria-hidden="true" />
            <span style={{ flex: 1 }}>Guardado en {tasks.find((t) => t.id === chosen)?.base || "main"} el de {tasks.find((t) => t.id === chosen)?.label}. ¿Borramos las demás copias?</span>
            <button type="button" onClick={dropOthers} disabled={!!busy} style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: C.ink, color: C.white, cursor: "pointer", fontSize: "13px", fontWeight: 600 }}><Trash2 size={13} strokeWidth={2.2} aria-hidden="true" />Borrar las demás</button>
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${tasks.length > 3 ? 250 : 300}px, 1fr))`, gap: "16px", alignItems: "start" }}>
          {tasks.map((t) => {
            const s = taskStatus(t);
            const test = t.tests ? TESTS[t.tests.status] : null;
            const files = t.files || [];
            const isChosen = chosen === t.id;
            return (
              <article key={t.id} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px", borderRadius: "24px", background: C.white, boxShadow: isChosen ? `0 0 0 2px ${C.green}, ${CARD}` : CARD }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <BrunoMark size={26} state={t.running ? "work" : s.state} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                    <strong style={{ fontSize: "15px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label || t.engine}</strong>
                    <span style={{ fontSize: "12px", color: s.fg }}>{t.running ? "Trabajando" : s.text}</span>
                  </span>
                  <Stat add={t.add} del={t.del} />
                </div>
                {test ? (
                  <span title={t.tests.status === "failed" ? "Mira la terminal de esa tarea para ver el error" : undefined} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", padding: "5px 11px", borderRadius: "999px", background: test.bg, color: test.fg, fontSize: "12px", fontWeight: 600 }}>
                    {t.tests.status === "passed" ? <Check size={12} strokeWidth={2.8} aria-hidden="true" /> : t.tests.status === "failed" ? <X size={12} strokeWidth={2.8} aria-hidden="true" /> : null}
                    {test.text}{t.tests.durationMs ? " · " + Math.max(1, Math.round(t.tests.durationMs / 1000)) + " s" : ""}
                  </span>
                ) : <span style={{ fontSize: "12px", color: C.quiet }}>Tests sin probar</span>}
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "8px", borderRadius: "14px", background: "#FAFAF8", minHeight: "60px" }}>
                  {files === null ? <span style={{ padding: "6px", fontSize: "12px", color: C.faint }}>Aún trabajando…</span>
                    : files.length ? files.slice(0, 6).map((f) => (
                      <span key={f.path} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 6px", font: `400 12px/1.3 ${MONO}` }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: C.quiet }}>{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : ""}</span>{f.path.split("/").pop()}</span>
                        <Stat add={f.add} del={f.del} size={11} />
                      </span>
                    )) : <span style={{ padding: "6px", fontSize: "12px", color: C.faint }}>No cambió archivos.</span>}
                  {files && files.length > 6 ? <span style={{ padding: "2px 6px", fontSize: "12px", color: C.faint }}>y {files.length - 6} más</span> : null}
                </div>
                {t.said ? <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.55, color: C.text, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{plain(t.said)}</p> : null}
                <div style={{ display: "flex", gap: "6px", marginTop: "auto" }}>
                  <button type="button" onClick={() => navigate("/codigo/" + t.id)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}><ArrowUpRight size={13} strokeWidth={2.2} aria-hidden="true" />Abrir</button>
                  {t.isolated && !t.saved ? (
                    <button type="button" onClick={() => choose(t)} disabled={!!busy || !!chosen || t.running || !files?.length} title={"Guarda esta versión en " + (t.base || "main")}
                      style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: C.ink, color: C.white, cursor: busy || chosen || t.running || !files?.length ? "default" : "pointer", fontSize: "13px", fontWeight: 600, opacity: busy || chosen || t.running || !files?.length ? 0.45 : 1 }}>
                      <GitMerge size={13} strokeWidth={2.2} aria-hidden="true" />{busy === "save:" + t.id ? "Guardando…" : "Elegir este"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

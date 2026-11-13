import { useState } from "react";
import BotFace from "../../BotFace.jsx";
import { UsersThree } from "../../Icon.js";
import { useAction, useResource } from "../../../lib/store.jsx";
import { patch } from "../../../lib/api.js";
import { later } from "../../../lib/undoToast.js";
import { VerdictMark, VerdictNote } from "../../v2/team/Verdict.jsx";
import MoreMenu from "./MoreMenu.jsx";
import { C } from "../../../lib/theme.js";

// Biblioteca › Habilidades (design/V3Habilidades.dc.html): the recipes the bots learned. What
// waits for your review goes first, honey-ringed, with its steps; then the active ones, each
// with «···» (see the steps, pin it so it is never archived, switch it off, archive it); the
// switched-off and archived ones last, ready to come back.

const UNDO_MS = 10000;
/** Numbered steps of a SKILL.md («1. Haz esto»). */
const stepsOf = (content) => String(content || "").split(/\r?\n/).map((l) => /^\s*\d+[.)]\s+(.+)$/.exec(l)?.[1]?.trim()).filter(Boolean);
const ORIGIN = { imported: "importada", learned: "aprendida", shared: "compartida" };
const usedText = (n) => (n ? `usada ${n} ${n === 1 ? "vez" : "veces"}` : "aún sin usar");

function Mark({ bot, size }) {
  if (bot) return <BotFace bot={bot} size={size} decorative />;
  // A skill of the whole team: the team's mark on a chip, not a bot.
  return <span aria-hidden="true" title="Todo el equipo" style={{ flex: "none", width: size + "px", height: size + "px", display: "grid", placeItems: "center", background: "var(--c-chip)", color: "var(--c-text-2)", borderRadius: "var(--r-sm)" }}><UsersThree size={Math.round(size * 0.7)} /></span>;
}

/** The steps as the board draws them: numbered rows on a soft background; new ones in honey. */
function Steps({ skill, compare = false }) {
  const detail = useResource(`/skills/${encodeURIComponent(skill.id)}`);
  const steps = stepsOf(detail.data?.content);
  const before = new Set(stepsOf(detail.data?.previous?.content));
  if (detail.loading && !detail.data) return <p style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"Cargando los pasos…"}</p>;
  if (detail.error) return <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{detail.error}</p>;
  if (!steps.length) return <p style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"Esta habilidad no tiene pasos numerados."}</p>;
  return (
    <ol style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px", animation: "rise .25s ease-out" }}>
      {steps.map((t, i) => {
        const added = compare && before.size > 0 && !before.has(t);
        return (
          <li key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "10px 12px", borderRadius: "var(--r-md)", background: added ? "var(--c-ok-soft)" : "var(--c-hover)" }}>
            <span style={{ flex: "none", width: "24px", height: "24px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: C.card, fontSize: "var(--t-caption)", fontWeight: "600" }}>{String(i + 1)}</span>
            <span style={{ flex: "1", fontSize: "var(--t-body)", lineHeight: "1.5" }}>
              {t}
              {added ? <span style={{ display: "block", fontSize: "var(--t-meta)", color: "var(--c-honey-text)" }}>{"Paso nuevo en esta versión"}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PendingCard({ s, bot, open: startOpen, onApproved }) {
  const [open, setOpen] = useState(startOpen);
  const act = useAction();
  const improved = s.version > 1;
  const who = bot?.name || "El equipo";
  const meta = improved
    ? `${who} propone una versión mejorada (v${s.version}). Revisa qué cambia antes de usarla.`
    : s.origin === "imported" ? "La importaste · nueva" : s.origin === "shared" ? "Te la compartieron · nueva" : [`${who} la aprendió${s.learnedFrom ? " " + s.learnedFrom : ""}`, "nueva"].join(" · ");
  const approve = async () => {
    const r = await act.act(() => patch(`/skills/${encodeURIComponent(s.id)}`, { status: "active" }));
    if (r !== undefined) onApproved(s);
  };
  const discard = () => later({ id: "skill:" + s.id, keys: ["skill:" + s.id], ms: UNDO_MS, text: `«${s.name}» descartada`, error: "No se pudo descartar", run: () => act.act(() => patch(`/skills/${encodeURIComponent(s.id)}`, { status: "disabled" })) });
  if (!open) {
    return (
      <article style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", padding: "18px 22px", borderRadius: "var(--r-lg)", background: "var(--c-card)", boxShadow: "0 0 0 1px rgb(var(--c-ink-rgb) / .14)" }}>
        <Mark bot={bot} size={22} />
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <h3 style={{ margin: "0", fontSize: "var(--t-read)", fontWeight: "600" }}>{improved ? `${s.name} · versión mejorada` : s.name}</h3>
          <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{meta}</span>
        </div>
        <button type="button" onClick={() => setOpen(true)} style={{ height: "36px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-sm)", background: "var(--c-card)", fontSize: "var(--t-ui)", cursor: "pointer" }}>{improved ? "Ver los cambios" : "Ver los pasos"}</button>
      </article>
    );
  }
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "22px 24px", borderRadius: "var(--r-lg)", background: "var(--c-card)", boxShadow: "0 0 0 1px rgb(var(--c-ink-rgb) / .14)", animation: "fade .25s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <Mark bot={bot} size={22} />
        <div style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
          <h3 style={{ margin: "0", fontSize: "var(--t-lead)", fontWeight: "600" }}>{improved ? `${s.name} · versión mejorada` : s.name}</h3>
          <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{meta}</span>
        </div>
      </div>
      {s.description ? <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-2)" }}>{s.description}</p> : null}
      <Steps skill={s} compare={improved} />
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{act.error}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <button type="button" disabled={act.busy} onClick={approve} style={{ height: "36px", padding: "0 14px", border: "0", borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "600", cursor: "pointer" }}>{improved ? "Usar la nueva versión" : "Aprobar y activar"}</button>
        <button type="button" disabled={act.busy} onClick={discard} style={{ height: "42px", padding: "0 12px", border: "0", background: "transparent", fontSize: "var(--t-body)", color: "var(--c-text-2)", cursor: "pointer" }}>{"Descartar"}</button>
      </div>
    </article>
  );
}

function SkillTile({ s, bot, expert, onCurate }) {
  const [open, setOpen] = useState(false);
  const act = useAction();
  const off = s.status !== "active";
  const stateText = { disabled: "desactivada", stale: "sin usar desde hace un mes", archived: "archivada" }[s.status];
  const meta = [bot?.name || "Todo el equipo", usedText(s.uses), stateText, s.pinned ? "fijada" : null, s.automation ? "la usa una rutina" : null, expert ? `v${s.version} · ${ORIGIN[s.origin] || s.origin}${s.lastUsedAt ? " · última vez " + new Date(s.lastUsedAt).toLocaleDateString("es-ES") : ""}` : null].filter(Boolean).join(" · ");
  const curate = (body) => act.act(async () => onCurate(await patch(`/skills/${encodeURIComponent(s.id)}/curation`, body)));
  const items = [
    { label: open ? "Ocultar los pasos" : "Ver los pasos", run: () => setOpen((x) => !x) },
    s.curated ? { label: s.pinned ? "Dejar de fijar" : "Fijar: no se archiva nunca", run: () => curate({ pinned: !s.pinned }) } : null,
    off
      ? { label: "Activar", run: () => (s.curated ? curate({ status: "active" }) : act.act(() => patch(`/skills/${encodeURIComponent(s.id)}`, { status: "active" }))) }
      : { label: "Desactivar", run: () => later({ id: "skill-off:" + s.id, keys: ["skill:" + s.id], ms: UNDO_MS, text: `«${s.name}» desactivada`, error: "No se pudo desactivar", run: () => act.act(() => patch(`/skills/${encodeURIComponent(s.id)}`, { status: "disabled" })) }) },
    !off || s.status === "disabled" || s.status === "stale" ? (s.curated ? { label: "Archivar", run: () => later({ id: "skill-arch:" + s.id, keys: ["skill:" + s.id], ms: UNDO_MS, text: `«${s.name}» archivada`, error: "No se pudo archivar", run: () => curate({ status: "archived" }) }) } : null) : null,
  ];
  return (
    <div style={{ gridColumn: open ? "1 / -1" : undefined, display: "flex", flexDirection: "column", gap: "12px", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "var(--c-card)", opacity: off && !open ? 0.75 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <Mark bot={bot} size={18} />
        <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-body)", fontWeight: "600" }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
            {s.verdict && s.verdict.value !== "dudoso" ? <VerdictMark verdict={s.verdict} compact consolidated={s.consolidated} /> : null}
          </span>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{meta}</span>
        </span>
        <MoreMenu label={`Más opciones de ${s.name}`} items={items} />
      </div>
      {open ? (
        <>
          {s.description ? <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: 1.5, color: "var(--c-text-2)" }}>{s.description}</p> : null}
          <Steps skill={s} />
          <VerdictNote verdict={s.verdict} style={{ padding: "0 4px" }} />
        </>
      ) : null}
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{act.error}</p> : null}
    </div>
  );
}

export default function Skills({ skills, bots, expert, note = null }) {
  const curated = useResource("/learning/skills");
  const [approved, setApproved] = useState([]);
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const extra = new Map((Array.isArray(curated.data) ? curated.data : []).map((s) => [s.id, s]));
  const all = skills.map((s) => (extra.has(s.id) ? { ...s, ...extra.get(s.id), status: s.status, curated: true } : s));
  const onCurate = (r) => { if (r?.id) curated.setData((d) => (Array.isArray(d) ? d.map((x) => (x.id === r.id ? r : x)) : d)); };
  const pending = all.filter((s) => s.status === "pending");
  const active = all.filter((s) => s.status === "active").sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.uses || 0) - (a.uses || 0));
  const off = all.filter((s) => !["pending", "active"].includes(s.status)).sort((a, b) => (b.uses || 0) - (a.uses || 0));
  const done = approved.filter((s) => !pending.some((p) => p.id === s.id));
  return (
    <>
      <p style={{ margin: "0", maxWidth: "760px", fontSize: "var(--t-body)", lineHeight: "1.5", color: "var(--c-text-2)" }}>
        {"Una habilidad es una receta paso a paso que un bot aprende al repetir un trabajo. "}
        <strong style={{ color: "var(--c-text)", fontWeight: "600" }}>{"Las que esperan tu revisión no se usan hasta que revisas sus pasos."}</strong>
      </p>
      {note ? <p role="status" style={{ margin: 0, fontSize: "var(--t-ui)", color: note.error ? "var(--c-error)" : "var(--c-ok-ink)" }}>{note.text}</p> : null}
      {pending.length || done.length ? (
        <section aria-labelledby="rev-t" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <h2 id="rev-t" style={{ margin: "0", display: "flex", alignItems: "center", gap: "10px", font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}>
            {"Por revisar"}
            {pending.length ? <span style={{ minWidth: "24px", height: "24px", padding: "0 8px", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .1)", font: "600 var(--t-meta)/1 'Geist', sans-serif" }}>{String(pending.length)}</span> : null}
          </h2>
          {pending.map((s, i) => <PendingCard key={s.id} s={s} bot={botOf(s.botId)} open={i === 0} onApproved={(x) => setApproved((list) => [...list, x])} />)}
          {done.map((s) => (
            <article key={s.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", padding: "18px 22px", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid var(--c-line)", animation: "fade .25s ease-out" }}>
              <Mark bot={botOf(s.botId)} size={22} />
              <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "2px" }}>
                <h3 style={{ margin: "0", fontSize: "var(--t-read)", fontWeight: "600" }}>{s.name}</h3>
                <span role="status" style={{ fontSize: "var(--t-body)", fontWeight: "500", color: "var(--c-ok-ink)" }}>{`✓ Activada. ${botOf(s.botId)?.name || "El equipo"} la usará la próxima vez que haga algo parecido.`}</span>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      <section aria-labelledby="act-t" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 id="act-t" style={{ margin: "0", font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}>{`Activas · ${active.length}`}</h2>
        {!active.length ? <p style={{ margin: 0, fontSize: "var(--t-body)", color: "var(--c-text-3)" }}>{"Aún no han aprendido nada. Cuando un bot repita una tarea, guardará cómo la hace como habilidad."}</p> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "10px" }}>
          {active.map((s) => <SkillTile key={s.id} s={s} bot={botOf(s.botId)} expert={expert} onCurate={onCurate} />)}
        </div>
      </section>
      {off.length ? (
        <section aria-labelledby="off-t" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2 id="off-t" style={{ margin: "0", font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}>{`Desactivadas y archivadas · ${off.length}`}</h2>
            <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"Las que no se usan en un mes dejan de ofrecerse y a los tres se archivan; nunca se borran. Fija las que quieras conservar."}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "10px" }}>
            {off.map((s) => <SkillTile key={s.id} s={s} bot={botOf(s.botId)} expert={expert} onCurate={onCurate} />)}
          </div>
        </section>
      ) : null}
    </>
  );
}

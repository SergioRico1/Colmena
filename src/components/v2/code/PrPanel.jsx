import { GitPullRequest, GitMerge, GitBranch, ExternalLink, CircleX, Check, LoaderCircle, Eye, EyeOff, GitPullRequestArrow, CircleAlert } from "../../Icon.js";
import { C, MONO } from "./parts.jsx";
import { ciOf } from "./flow.js";

// «PR» (GitHub's PR header, Conductor's checks): the task's pull request at a glance — its state,
// the CI, the review and whether it merges cleanly — with what you can do from here. Pushing and
// merging stay your click (red lines); the one primary action of the task lives in its header.

const ROW = { display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", alignItems: "center", gap: "12px", minHeight: "44px", padding: "6px 0", borderTop: "1px solid var(--c-line)" };
const KEY = { fontSize: "var(--t-meta)", color: C.muted };
const VALUE = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", color: C.ink };
const BTN = { display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-raised)", color: C.ink, fontSize: "var(--t-meta)", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" };
const mark = (Icon, color) => <Icon size={16} weight="bold" aria-hidden="true" style={{ flex: "none", color }} />;

/**
 * `onSaveTo(to)` runs a save ("pr"); `onPrAction(kind)` merges or marks ready; `onFix()` hands the
 * failing CI to Bruno. `mergeWhy` / `ghOff` say why something cannot be done now.
 */
export default function PrPanel({ task, name = "Bruno", running = false, ghOff = null, mergeWhy = null, busy = null, onSaveTo, onPrAction, onFix }) {
  const pr = task.pr?.number ? task.pr : null;
  const base = task.base || "main";
  const wrap = { flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px 28px", display: "flex", flexDirection: "column", gap: "16px", animation: "fade .2s ease-out" };
  if (!pr) {
    const nothing = !(task.add || task.del || task.lastChanged);
    const why = running ? name + " está trabajando: espera a que acabe." : nothing ? "Aún no hay cambios que subir." : ghOff;
    return (
      <div style={wrap}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "560px" }}>
          <h2 style={{ margin: 0, fontSize: "var(--t-read)", fontWeight: 600 }}>Sin pull request todavía</h2>
          <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.55, color: C.text2 }}>
            {task.pr?.watching ? "Esperando a que GitHub muestre la PR de " + (task.branch || "la rama") + "…" : `Guarda los cambios en ${task.branch ? "su rama" : "una rama"}, súbelos y abre una PR para que el equipo la revise. Subir a GitHub siempre te pide el OK.`}
          </p>
          <span style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
            <button type="button" disabled={!!why || !!busy} onClick={() => onSaveTo("pr")} title={why || undefined} style={{ ...BTN, opacity: why || busy ? 0.55 : 1, cursor: why || busy ? "default" : "pointer" }}>
              <GitPullRequest size={16} aria-hidden="true" />{busy === "pr" ? "Preparando PR…" : "Guardar, subir y abrir PR"}
            </button>
            {why ? <span style={{ fontSize: "var(--t-meta)", color: C.muted }}>{why}</span> : null}
          </span>
        </div>
      </div>
    );
  }
  const open = pr.state === "OPEN";
  const ci = ciOf(task);
  const state = pr.state === "MERGED" ? ["Fusionada", "var(--c-ok-soft)", "var(--c-ok-ink)", GitMerge] : pr.state === "CLOSED" ? ["Cerrada", C.track, C.text2, CircleX] : pr.isDraft ? ["Borrador", C.track, C.text2, GitPullRequest] : ["Abierta", "var(--c-accent-soft)", "var(--c-accent-ink)", GitPullRequest];
  const StateIcon = state[3];
  return (
    <div style={wrap}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-read)", fontWeight: 600 }}>
          <GitPullRequest size={20} aria-hidden="true" />PR #{pr.number}
        </h2>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", height: "24px", padding: "0 9px", borderRadius: "var(--r-pill)", background: state[1], color: state[2], fontSize: "var(--t-caption)", fontWeight: 600 }}><StateIcon size={12} aria-hidden="true" />{state[0]}</span>
        <span style={{ flex: 1 }} />
        {pr.url ? <a href={pr.url} target="_blank" rel="noreferrer" style={BTN}><ExternalLink size={16} aria-hidden="true" />Abrir en GitHub</a> : null}
      </header>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={ROW}>
          <span style={KEY}>Rama</span>
          <span style={{ ...VALUE, font: `400 var(--t-meta)/1.3 ${MONO}` }}><GitBranch size={16} aria-hidden="true" />{task.branch || pr.branch} → {base}</span>
        </div>
        {open || ci ? (
          <div style={ROW}>
            <span style={KEY}>Comprobaciones</span>
            <span style={VALUE}>
              {!ci ? <span style={{ color: C.muted }}>Sin comprobaciones en esta PR</span>
                : ci.state === "failing" ? <>{mark(CircleX, "var(--c-error)")}<span style={{ color: "var(--c-error)", fontWeight: 600 }}>Fallan</span>
                  {onFix && !running ? <button type="button" onClick={onFix} style={BTN}>Que {name} lo arregle</button> : null}
                  <span style={{ flexBasis: "100%", fontSize: "var(--t-meta)", color: C.muted }}>{name} lee el registro del fallo en GitHub y lo corrige en su copia; volver a subir te pide el OK.</span></>
                  : ci.state === "passing" ? <>{mark(Check, "var(--c-ok-ink)")}<span style={{ color: "var(--c-ok-ink)", fontWeight: 600 }}>Pasan</span></>
                    : <>{mark(LoaderCircle, C.muted)}<span>En curso</span></>}
            </span>
          </div>
        ) : null}
        {open ? (
          <div style={ROW}>
            <span style={KEY}>Revisión</span>
            <span style={VALUE}>
              {pr.reviewDecision === "APPROVED" ? <>{mark(Check, "var(--c-ok-ink)")}Aprobada</>
                : pr.reviewDecision === "CHANGES_REQUESTED" ? <>{mark(CircleAlert, "var(--c-warn)")}Piden cambios: {name} se pone con ellos</>
                  : pr.isDraft ? <span style={{ color: C.muted }}>Nadie la revisa mientras sea un borrador</span> : <span style={{ color: C.muted }}>Aún sin revisión</span>}
            </span>
          </div>
        ) : null}
        {open ? (
          <div style={ROW}>
            <span style={KEY}>Fusión</span>
            <span style={VALUE}>
              {pr.mergeable === "CONFLICTING" ? <>{mark(CircleAlert, "var(--c-warn)")}Tiene conflictos con {base}</> : pr.mergeable === "MERGEABLE" ? <>{mark(Check, "var(--c-ok-ink)")}Se puede fusionar sin conflictos</> : <span style={{ color: C.muted }}>GitHub aún lo está calculando</span>}
            </span>
          </div>
        ) : null}
        <div style={ROW}>
          <span style={KEY}>Seguimiento</span>
          <span style={{ ...VALUE, fontSize: "var(--t-meta)", color: C.text2 }}>
            {pr.watching ? <>{mark(Eye, C.muted)}Colmena sigue la PR: si falla el CI, hay conflictos o comentan, {name} se pone con ello.</> : <>{mark(EyeOff, C.muted)}Colmena no la está siguiendo.</>}
          </span>
        </div>
      </div>
      {open ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", paddingTop: "4px" }}>
          {pr.isDraft ? <button type="button" disabled={!!busy || running} onClick={() => onPrAction("ready")} style={{ ...BTN, opacity: busy || running ? 0.55 : 1 }}><GitPullRequestArrow size={16} aria-hidden="true" />{busy === "ready" ? "Marcando…" : "Marcar como lista"}</button> : null}
          <button type="button" disabled={!!mergeWhy || !!busy || running} onClick={() => onPrAction("merge")} title={mergeWhy || "Fusiona en GitHub el último commit que has visto. Si alguien sube algo después, GitHub no la fusiona."}
            style={{ ...BTN, opacity: mergeWhy || busy || running ? 0.55 : 1, cursor: mergeWhy || busy || running ? "default" : "pointer" }}>
            <GitMerge size={16} aria-hidden="true" />{busy === "merge" ? "Fusionando en GitHub…" : "Fusionar en GitHub"}
          </button>
          {mergeWhy ? <span style={{ fontSize: "var(--t-meta)", color: C.muted }}>{mergeWhy}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

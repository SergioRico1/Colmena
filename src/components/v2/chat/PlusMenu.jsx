import { useEffect, useMemo, useRef, useState } from "react";
import { AppWindow, Brain, Check, Crop, Globe, Monitor, Paperclip, Plus, Repeat, SquareTerminal, Target } from "lucide-react";
import AppLogo from "../../settings/AppLogo.jsx";
import WindowPicker, { captureFile } from "../../interaction/WindowPicker.jsx";
import { APPS, appName, loadAccounts } from "../../settings/connections.jsx";
import { useStore } from "../../../lib/store.jsx";
import { navigate } from "../../../lib/router.jsx";

// «+» in the composer (Codex's «Añadir» menu): add files, choose what the bot should use for
// this message (think harder, the web, the browser, the terminal, one of your apps) or turn
// what you wrote into a goal or a routine. Choices show as chips in the composer and go
// with the message (server/turnoptions.mjs).

// The desktop app's screenshots (desktop/background.cjs «colmena-main-capture»).
const CAPTURE = typeof window !== "undefined" ? window.colmenaWindow?.capture || null : null;

let appsCache = null;
function useConnectedApps(open) {
  const [apps, setApps] = useState(appsCache || []);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    loadAccounts().then((items) => {
      const slugs = [...new Set(items.filter((a) => a.status === "ACTIVE").map((a) => String(a.toolkit || "").toLowerCase()).filter(Boolean))];
      appsCache = slugs.map((slug) => ({ slug, name: appName(slug), hint: APPS.find((x) => x.slug === slug)?.description || "", logo: items.find((a) => String(a.toolkit).toLowerCase() === slug)?.logo || null }));
      if (alive) setApps(appsCache);
    }).catch(() => {});
    return () => { alive = false; };
  }, [open]);
  return apps;
}

const TOOL_ITEMS = [
  { key: "deep", label: "Pensar a fondo", hint: "Razona más antes de responder", Icon: Brain },
  { key: "web", label: "Buscar en la web", hint: "Con fuentes actuales", Icon: Globe },
  { key: "navegador", label: "Usar el navegador", hint: "Abre páginas y las usa por ti", Icon: AppWindow, desktop: true },
  { key: "terminal", label: "Usar la terminal", hint: "Comandos en tu ordenador, con tu permiso", Icon: SquareTerminal },
];

/** Chips for what was chosen: [{key, label}] (the composer shows them above the text). */
export function chosenChips(chosen, apps = []) {
  return chosen.map((key) => {
    const tool = TOOL_ITEMS.find((t) => t.key === key);
    return { key, label: tool ? tool.label : appName(key) || apps.find((a) => a.slug === key)?.name || key };
  });
}

/** What goes with the message: {use, deep}. */
export function turnBody(chosen) {
  const use = chosen.filter((k) => k !== "deep");
  return { ...(use.length ? { use } : {}), ...(chosen.includes("deep") ? { deep: true } : {}) };
}

export default function PlusMenu({ open, onClose, onFiles, onCapture = null, onError = null, chosen = [], onToggle, text = "", botId = null }) {
  const { computer } = useStore();
  const [view, setView] = useState("menu");
  const shoot = async (take, label) => {
    try {
      const shot = await take();
      if (shot) onCapture(captureFile(shot, label));
    } catch (e) {
      onError?.(e.message || "No pude hacer la captura.");
    }
  };
  const apps = useConnectedApps(open);
  const box = useRef(null);
  const [at, setAt] = useState(0);
  const sections = useMemo(() => {
    const draft = text.trim();
    const list = [
      {
        title: "Añadir",
        items: [
          { key: "files", label: "Archivos y carpetas", hint: "Hasta 5, de 10 MB", Icon: Paperclip, run: onFiles },
          // The desktop app only: Colmena steps aside for the shot and comes back.
          ...(CAPTURE && onCapture ? [
            { key: "shot-screen", label: "Captura de pantalla", hint: "Toda la pantalla", Icon: Monitor, run: () => shoot(() => CAPTURE.screen(), "pantalla") },
            { key: "shot-area", label: "Captura de una zona", hint: "Arrastra para elegirla · Esc cancela", Icon: Crop, run: () => shoot(() => CAPTURE.area(), "zona") },
            { key: "shot-window", label: "Captura de una ventana", hint: "De otra app abierta", Icon: AppWindow, keep: true, run: () => setView("windows") },
          ] : []),
        ],
      },
      { title: "Para este mensaje", items: TOOL_ITEMS.filter((t) => !t.desktop || computer?.available).map((t) => ({ ...t, toggle: true })) },
      {
        title: "Convertir en",
        items: [
          { key: "goal", label: "Objetivo", hint: "Que siga avanzando hasta lograrlo", Icon: Target, run: () => navigate("/objetivos?nuevo=" + encodeURIComponent(draft)) },
          { key: "routine", label: "Rutina", hint: "Que se repita sola", Icon: Repeat, run: () => navigate("/rutinas?nueva=1" + (draft ? "&texto=" + encodeURIComponent(draft) : "") + (botId ? "&bot=" + encodeURIComponent(botId) : "")) },
        ],
      },
      {
        title: "Tus apps",
        items: [
          ...apps.map((a) => ({ key: a.slug, label: a.name, hint: a.hint, logo: a, toggle: true })),
          { key: "connect", label: apps.length ? "Conectar otra app" : "Conectar una app", hint: apps.length ? "" : "Gmail, Calendar, Slack, Notion…", Icon: Plus, run: () => navigate("/ajustes/conexiones") },
        ],
      },
    ];
    return list;
  }, [apps, computer?.available, onFiles, onCapture, onError, text, botId]); // eslint-disable-line react-hooks/exhaustive-deps
  const flat = sections.flatMap((s) => s.items);
  useEffect(() => { if (open) { setAt(0); requestAnimationFrame(() => box.current?.focus()); } }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.("[data-plus-toggle]")) onClose(); };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open, onClose]);
  if (!open) return null;
  if (view === "windows") {
    return (
      <div ref={box} style={{ position: "absolute", left: "0", bottom: "calc(100% + 10px)", zIndex: 40, width: "min(520px, 100%)" }}>
        <WindowPicker load={CAPTURE.windows} onClose={() => setView("menu")}
          onPick={(w) => { onClose(); void shoot(() => CAPTURE.window(w.id), w.name.split(" - ").pop()); }} />
      </div>
    );
  }
  const choose = (item) => {
    if (item.toggle) onToggle(item.key);
    else if (item.keep) item.run?.();
    else { onClose(); item.run?.(); }
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => (i + 1) % flat.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => (i - 1 + flat.length) % flat.length); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (flat[at]) choose(flat[at]); }
  };
  let n = -1;
  return (
    <div ref={box} role="menu" aria-label="Añadir" tabIndex={-1} onKeyDown={onKeyDown}
      style={{ position: "absolute", left: "0", bottom: "calc(100% + 10px)", zIndex: 40, width: "min(420px, 100%)", maxHeight: "min(440px, 60vh)", overflowY: "auto", padding: "6px", borderRadius: "22px", background: "#FFFFFF", boxShadow: "0 24px 50px -24px rgba(18,19,26,.4), 0 0 0 1px rgba(18,19,26,.06)", outline: "none", animation: "rise .2s ease-out" }}>
      {sections.map((s) => (
        <div key={s.title} role="group" aria-label={s.title} style={{ display: "flex", flexDirection: "column", paddingBottom: "4px" }}>
          <span style={{ padding: "10px 12px 4px", fontSize: "12px", color: "#6B6F7A" }}>{s.title}</span>
          {s.items.map((item) => {
            n += 1;
            const i = n;
            const on = item.toggle && chosen.includes(item.key);
            const Icon = item.Icon;
            return (
              <button key={item.key} type="button" role={item.toggle ? "menuitemcheckbox" : "menuitem"} aria-checked={item.toggle ? (on ? "true" : "false") : undefined}
                onMouseEnter={() => setAt(i)} onClick={() => choose(item)}
                style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", padding: "0 12px", border: 0, borderRadius: "12px", cursor: "pointer", textAlign: "left", background: at === i ? "rgba(18,19,26,.05)" : "transparent", color: "#12131A", fontSize: "14px" }}>
                <span aria-hidden="true" style={{ width: "20px", flex: "none", display: "grid", placeItems: "center", color: "#3D404A" }}>
                  {item.logo ? <AppLogo id={item.logo.slug} name={item.logo.name} logo={item.logo.logo} size={18} /> : <Icon size={16} strokeWidth={2.2} />}
                </span>
                <span style={{ flex: "1", minWidth: 0, display: "flex", alignItems: "baseline", gap: "8px", overflow: "hidden", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 500 }}>{item.label}</span>
                  {item.hint ? <span style={{ fontSize: "13px", color: "#6B6F7A", overflow: "hidden", textOverflow: "ellipsis" }}>{item.hint}</span> : null}
                </span>
                {on ? <Check size={16} strokeWidth={2.6} aria-hidden="true" style={{ flex: "none", color: "#0B8A5F" }} /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

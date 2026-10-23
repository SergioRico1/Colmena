import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { useAction, useResource } from "../../../lib/store.jsx";
import { post } from "../../../lib/api.js";
import { dateTime } from "../../../lib/format.js";

// Versions of a bot's SOUL.md or of your USER.md (doc-history.mjs): every change keeps the
// text it replaced, so any earlier one can be seen and brought back. Restoring is one more
// version: nothing is lost.

const FAINT = "#6B6F7A";
const INK = "#12131A";

/** `doc` 'soul' (needs `botId`) or 'user'. `limit` versions are shown until «Ver todas». */
export default function DocHistory({ doc, botId = null, limit = 4, empty = "Aún no ha cambiado." }) {
  const url = doc === "soul" ? `/bots/${encodeURIComponent(botId)}/soul/versions` : "/user-profile/versions";
  const { data, setData, loading } = useResource(url);
  const { act, busy, error } = useAction();
  const [open, setOpen] = useState(null);
  const [all, setAll] = useState(false);
  const list = Array.isArray(data) ? data : [];
  if (loading && !list.length) return <p style={{ margin: 0, padding: "14px 20px", fontSize: "14px", color: FAINT }}>Cargando el historial…</p>;
  if (!list.length) return <p style={{ margin: 0, padding: "14px 20px", fontSize: "14px", color: FAINT }}>{empty}</p>;
  const shown = all ? list : list.slice(0, limit);
  const restore = (v) => act(async () => { setData(await post(`${url}/${encodeURIComponent(v.id)}/restore`)); setOpen(null); });
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {shown.map((v, i) => (
        <div key={v.id} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 20px", borderTop: i ? "1px solid rgba(18,19,26,.06)" : 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
            <History size={15} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: v.current ? "#0B8A5F" : "#9A9DA6" }} />
            <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "15px", color: INK }}>{v.sourceLabel}{v.current ? <span style={{ marginLeft: "8px", fontSize: "13px", fontWeight: 600, color: "#0B5A3E" }}>En uso</span> : null}</span>
              <span style={{ fontSize: "13px", color: FAINT }}>{[dateTime(v.createdAt), v.reason].filter(Boolean).join(" · ")}</span>
            </span>
            <button type="button" aria-expanded={open === v.id} onClick={() => setOpen((x) => (x === v.id ? null : v.id))} style={{ height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.05)", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: INK }}>
              {open === v.id ? "Ocultar" : "Ver"}
            </button>
            {v.current ? null : (
              <button type="button" disabled={busy} onClick={() => restore(v)} style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                <RotateCcw size={13} strokeWidth={2.4} aria-hidden="true" />Restaurar
              </button>
            )}
          </div>
          {open === v.id ? (
            <pre style={{ margin: 0, maxHeight: "260px", overflow: "auto", padding: "12px 14px", borderRadius: "14px", background: "#F6F6F3", fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: "12.5px", lineHeight: 1.55, color: "#3D404A", whiteSpace: "pre-wrap", overflowWrap: "anywhere", animation: "rise .25s ease-out" }}>{v.content}</pre>
          ) : null}
        </div>
      ))}
      {list.length > limit ? (
        <button type="button" onClick={() => setAll((x) => !x)} style={{ alignSelf: "flex-start", margin: "4px 20px 12px", padding: 0, border: 0, background: "transparent", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#1F4FD1" }}>
          {all ? "Ver menos" : `Ver las ${list.length} versiones`}
        </button>
      ) : null}
      {error ? <p role="alert" style={{ margin: "0 20px 12px", fontSize: "13px", color: "#B4372A" }}>{error}</p> : null}
    </div>
  );
}

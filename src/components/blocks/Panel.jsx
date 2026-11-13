import { useState } from "react";
import BlockCard from "./BlockCard.jsx";
import RowBoundary from "../RowBoundary.jsx";
import { sectionTitle, srOnly } from "../v3/dia/parts.jsx";
import { post } from "../../lib/api.js";
import { useResource, useStore } from "../../lib/store.jsx";
import { useHidden } from "../../lib/undoToast.js";
import { moveOptions, movedIds } from "../../lib/blocks.js";

// «Panel» on Inicio: the live blocks you pinned (server/blocks.mjs), in a simple grid that
// reflows with the window. Order by hand from each block's menu («Subir», «Bajar»): the
// keyboard way, announced to a screen reader. /api/state brings only which blocks are pinned
// (ids, titles, when they changed); their values come from /api/blocks?pinned=1, asked again
// whenever the server says something changed.

const EMPTY = "Pide a un bot que te deje un dato aquí: «déjame en el panel las ventas de ayer y actualízalas cada mañana».";

/** `page`: on its own page (/panel) the title is the page's heading and says what the panel is. */
export default function Panel({ page = false }) {
  const { blocks: pinned = [], run } = useStore();
  const { data, setData } = useResource("/blocks?pinned=1");
  const hidden = useHidden("block");
  const [said, setSaid] = useState("");
  const [error, setError] = useState(null);
  const loaded = Array.isArray(data?.blocks) ? data.blocks : null;
  // The state knows first what is pinned and in which order; the values follow.
  const known = new Map((loaded || []).map((b) => [b.id, b]));
  const order = (loaded && !pinned.length ? loaded : pinned).map((b) => b.id).filter((id) => !hidden(id));
  const titles = new Map([...pinned, ...(loaded || [])].map((b) => [b.id, b.title]));

  const move = async (id, direction) => {
    const next = movedIds(order, id, direction);
    if (next === order) return;
    setError(null);
    // At once on screen; the server's answer is the order that stays.
    if (loaded) setData({ ...data, blocks: next.map((x) => known.get(x)).filter(Boolean) });
    setSaid(`«${titles.get(id) || "El dato"}» ahora es el ${next.indexOf(id) + 1}.º de ${next.length}`);
    try {
      const answer = await run(() => post("/blocks/" + encodeURIComponent(id) + "/move", { direction }));
      if (Array.isArray(answer?.blocks)) setData({ ...data, blocks: answer.blocks });
    } catch (e) {
      if (loaded) setData(data);
      setSaid("");
      setError(e?.message || "No se pudo mover. Vuelve a intentarlo.");
    }
  };

  return (
    <section aria-labelledby="panel-t" data-panel="" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {page ? (
        <header style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
          <h1 id="panel-t" style={{ margin: "0", font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{"Panel"}</h1>
          <p style={{ margin: "0", fontSize: "var(--t-read)", color: "var(--c-text-2)" }}>{"Los datos que tus bots mantienen al día para ti."}</p>
        </header>
      ) : <h2 id="panel-t" style={sectionTitle}>{"Panel"}</h2>}
      {order.length ? (
        <div data-panel-grid="" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))", alignItems: "start", gap: "14px" }}>
          {order.map((id) => {
            const block = known.get(id);
            return (
              <RowBoundary key={id} label="No se ha podido mostrar este dato" resetKey={id + ":" + (block?.updatedAt || "")}>
                {block
                  ? <BlockCard block={block} where="panel" move={moveOptions(order, id)} onMove={(direction) => move(id, direction)} />
                  : <div aria-busy="true" style={{ minHeight: "132px", padding: "16px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)", display: "flex", flexDirection: "column", gap: "12px" }}>
                      <span style={{ fontSize: "var(--t-read)", fontWeight: "600" }}>{titles.get(id) || ""}</span>
                      <span className="colmena-skeleton" style={{ width: "55%", height: "30px", borderRadius: "var(--r-sm)" }} />
                    </div>}
              </RowBoundary>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: 0, padding: "18px", background: "var(--c-card)", borderRadius: "var(--r-xl)", fontSize: "var(--t-body)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{EMPTY}</p>
      )}
      <span role="status" aria-live="polite" style={srOnly}>{said}</span>
      {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", fontWeight: "600", color: "var(--c-error)" }}>{error}</span> : null}
    </section>
  );
}

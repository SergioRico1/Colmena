import { useSlidingPill } from "../../lib/useSlidingPill.js";
import { createContext, useContext, useMemo, useState } from "react";
import { Check } from "lucide-react";

// Interactive answers (OpenMuse / CopilotKit «generative UI»): a bot writes a fenced block
//   ```colmena
//   {"tipo": "grafico" | "tabla" | "opciones" | "formulario", ...}
//   ```
// and Colmena draws it with its own components. Choices and forms answer back as a message
// from the person, through InteractiveContext (rooms and chats provide `send`).
export const InteractiveContext = createContext({ send: null, after: [], botName: null });

const PALETTE = ["#2F6BFF", "#FFC93C", "#0B8A5F", "#FF5CA8", "#7B4DFF", "#FF7A1A", "#0E7C86"];
const card = { background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "14px", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px", maxWidth: "680px" };
const titleStyle = { margin: 0, font: "700 15px/1.3 'Bricolage Grotesque', sans-serif", color: "#12131A" };
const num = (v) => (typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", ".")));
const fmt = (v) => (Number.isFinite(v) ? v.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : String(v));

/** Splits Markdown into text and ```colmena blocks; an unclosed block (still streaming) is «pending». */
export function splitInteractive(text) {
  const parts = [];
  const re = /```colmena[^\n]*\n([\s\S]*?)(```|$)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: "md", text: text.slice(last, m.index) });
    if (m[2] !== "```") { parts.push({ kind: "pending" }); last = text.length; break; }
    let spec = null;
    try { spec = JSON.parse(m[1]); } catch { spec = null; }
    parts.push(spec && typeof spec === "object" ? { kind: "ui", spec } : { kind: "md", text: "```\n" + m[1] + "```" });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ kind: "md", text: text.slice(last) });
  return parts;
}

// ---------------------------------------------------------------- chart
function Chart({ spec, bare, noTitle }) {
  // A new answer's chart grows once; the history's charts stay still.
  const { entering = false } = useContext(InteractiveContext) || {};
  const labels = (spec.etiquetas || spec.labels || []).map(String).slice(0, 24);
  const series = (spec.series || []).slice(0, 6).map((s, i) => ({ name: String(s.nombre || s.name || `Serie ${i + 1}`), values: (s.valores || s.values || []).map(num), color: PALETTE[i % PALETTE.length] }));
  const unit = spec.unidad || spec.unit || "";
  const type = ["barras", "lineas", "tarta", "bar", "line", "pie"].includes(spec.forma || spec.chart) ? (spec.forma || spec.chart) : "barras";
  if (!labels.length || !series.length) return null;
  const W = 640, H = 260, L = 46, B = 34, T = 12, R = 12;
  const all = series.flatMap((s) => s.values.filter(Number.isFinite));
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v) => T + (H - T - B) * (1 - (v - min) / span);
  const step = (W - L - R) / labels.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + span * f);
  let body;
  if (type === "tarta" || type === "pie") {
    const values = series[0].values.map((v) => Math.max(0, Number.isFinite(v) ? v : 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let angle = -Math.PI / 2;
    const cx = 130, cy = H / 2, r = 100;
    body = (
      <>
        {values.map((v, i) => {
          const a2 = angle + (v / total) * Math.PI * 2;
          const large = a2 - angle > Math.PI ? 1 : 0;
          const d = `M${cx},${cy} L${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a2)},${cy + r * Math.sin(a2)} Z`;
          angle = a2;
          return <path key={i} data-slice="" style={{ animationDelay: i * 40 + "ms" }} d={d} fill={PALETTE[i % PALETTE.length]} stroke="#FFFFFF" strokeWidth="2"><title>{`${labels[i]}: ${fmt(v)} ${unit} (${Math.round((v / total) * 100)} %)`}</title></path>;
        })}
        {labels.map((l, i) => (
          <g key={l + i} transform={`translate(270, ${24 + i * 22})`}>
            <rect width="12" height="12" rx="3" fill={PALETTE[i % PALETTE.length]} />
            <text x="20" y="11" fontSize="13" fill="#2B2D36">{`${l} · ${fmt(values[i])} ${unit} (${Math.round((values[i] / total) * 100)} %)`}</text>
          </g>
        ))}
      </>
    );
  } else {
    body = (
      <>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#E6E8EE" />
            <text x={L - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="#555A68">{fmt(Math.round(t * 100) / 100)}</text>
          </g>
        ))}
        {labels.map((l, i) => <text key={l + i} x={L + step * i + step / 2} y={H - 12} fontSize="11" textAnchor="middle" fill="#4A4F5C">{l.length > Math.max(6, Math.floor(step / 7)) ? l.slice(0, Math.max(5, Math.floor(step / 7) - 1)) + "…" : l}</text>)}
        {type === "lineas" || type === "line"
          ? series.map((s) => (
            <g key={s.name}>
              <polyline fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" points={s.values.map((v, i) => `${L + step * i + step / 2},${y(Number.isFinite(v) ? v : 0)}`).join(" ")} />
              {s.values.map((v, i) => <circle key={i} cx={L + step * i + step / 2} cy={y(Number.isFinite(v) ? v : 0)} r="3.5" fill={s.color}><title>{`${s.name} · ${labels[i]}: ${fmt(v)} ${unit}`}</title></circle>)}
            </g>
          ))
          : series.map((s, k) => {
            const w = Math.max(4, (step * 0.7) / series.length);
            return s.values.map((v, i) => {
              const val = Number.isFinite(v) ? v : 0;
              const x = L + step * i + (step - w * series.length) / 2 + w * k;
              return <rect key={s.name + i} data-bar="" style={{ animationDelay: i * 35 + "ms" }} x={x} width={w - 2} y={Math.min(y(val), y(0))} height={Math.abs(y(val) - y(0))} rx="3" fill={s.color}><title>{`${s.name} · ${labels[i]}: ${fmt(v)} ${unit}`}</title></rect>;
            });
          })}
      </>
    );
  }
  return (
    <figure style={bare ? { margin: 0, display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 } : { ...card, margin: 0 }}>
      {!noTitle && (spec.titulo || spec.title) ? <figcaption style={titleStyle}>{spec.titulo || spec.title}</figcaption> : null}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.titulo || "Gráfico"} className={entering ? "c-chart-in" : undefined} style={{ width: "100%", height: "auto", font: "12px 'Geist', sans-serif" }}>{body}</svg>
      {type !== "tarta" && type !== "pie" && series.length > 1 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "13px", color: "#2B2D36" }}>
          {series.map((s) => <span key={s.name} style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "10px", height: "10px", borderRadius: "3px", background: s.color }} />{s.name}</span>)}
        </div>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------- table
function Table({ spec, bare, noTitle }) {
  const columns = (spec.columnas || spec.columns || []).map(String);
  const rows = (spec.filas || spec.rows || []).filter(Array.isArray).slice(0, 200);
  const [sort, setSort] = useState(null); // { i, dir }
  const [copied, setCopied] = useState(false);
  // A column is numeric when every filled cell is a number: header and cells align right.
  const numeric = useMemo(() => columns.map((_, i) => rows.every((r) => r[i] === "" || r[i] == null || (typeof r[i] !== "boolean" && Number.isFinite(num(r[i]))))), [columns, rows]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => sort.dir * (numeric[sort.i] ? num(a[sort.i]) - num(b[sort.i]) : String(a[sort.i] ?? "").localeCompare(String(b[sort.i] ?? ""), "es")));
  }, [rows, sort, numeric]);
  if (!columns.length) return null;
  const csv = [columns, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const copy = (
    <button type="button" className="rm-focus" onClick={() => navigator.clipboard?.writeText(csv).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })} style={{ flex: "none", height: "30px", padding: "0 10px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "8px", cursor: "pointer", fontSize: "12px" }}>{copied ? <span className="c-ok"><Check size={13} strokeWidth={2.6} aria-hidden="true" />Copiada</span> : "Copiar para Excel"}</button>
  );
  return (
    <div style={bare ? { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 } : { ...card, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        {!noTitle && (spec.titulo || spec.title) ? <strong style={titleStyle}>{spec.titulo || spec.title}</strong> : <span />}
        {copy}
      </div>
      <div style={{ overflowX: "auto", margin: "0 -4px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c + i} scope="col" aria-sort={sort?.i === i ? (sort.dir > 0 ? "ascending" : "descending") : "none"} style={{ textAlign: numeric[i] ? "right" : "left", padding: "8px 10px", borderBottom: "1.5px solid #12131A", whiteSpace: "nowrap" }}>
                  <button type="button" onClick={() => setSort(sort?.i === i ? { i, dir: -sort.dir } : { i, dir: 1 })} title="Ordenar" style={{ padding: 0, background: "transparent", border: 0, cursor: "pointer", font: "inherit", fontWeight: "700" }}>
                    {c}{sort?.i === i ? (sort.dir > 0 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, k) => (
              <tr key={k} style={{ background: k % 2 ? "#F7F8FA" : "#FFFFFF" }}>
                {columns.map((_, i) => (
                  <td key={i} style={{ padding: "7px 10px", borderBottom: "1px solid #E6E8EE", textAlign: numeric[i] ? "right" : "left", fontVariantNumeric: "tabular-nums", whiteSpace: numeric[i] ? "nowrap" : "normal" }}>
                    {numeric[i] && r[i] !== "" && r[i] != null ? fmt(num(r[i])) : String(r[i] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- evidence
const isEvidence = (spec) => ["grafico", "gráfico", "chart", "tabla", "table"].includes(String(spec?.tipo || spec?.type || "").toLowerCase());
const isAsk = (spec) => ["opciones", "choices", "formulario", "form"].includes(String(spec?.tipo || spec?.type || "").toLowerCase());
const evidenceLabel = (spec) => (["tabla", "table"].includes(String(spec.tipo || spec.type).toLowerCase()) ? "Tabla" : "Gráfico");

/** The supporting data, once: a single card; with several blocks, tabs («Gráfico · Tabla»). */
function Evidence({ blocks }) {
  const [tab, setTab] = useState(0);
  const [evRef, evPill] = useSlidingPill(tab);
  if (!blocks.length) return null;
  const current = blocks[Math.min(tab, blocks.length - 1)].spec;
  // With tabs the tab already names the block: no second title inside.
  const tabs = blocks.length > 1;
  const body = (spec) => (["tabla", "table"].includes(String(spec.tipo || spec.type).toLowerCase()) ? <Table spec={spec} bare noTitle={tabs} /> : <Chart spec={spec} bare noTitle={tabs} />);
  return (
    <section aria-label="Datos de apoyo" style={{ ...card, maxWidth: "720px", minWidth: 0 }}>
      {blocks.length > 1 ? (
        <div ref={evRef} role="tablist" aria-label="Ver los datos como" className="c-seg" style={{ display: "flex", gap: "4px", padding: "3px", background: "#EEF0F4", borderRadius: "10px", alignSelf: "flex-start" }}>
          {evPill ? <span aria-hidden="true" className="c-seg-pill" style={{ ...evPill, background: "#FFFFFF", borderRadius: "8px", boxShadow: "0 1px 2px rgba(18,19,26,0.12)" }} /> : null}
          {blocks.map((b, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === tab ? "true" : "false"} data-seg-active={i === tab ? "true" : undefined} onClick={() => setTab(i)}
              style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600", ...(i === tab ? { background: evPill ? "transparent" : "#FFFFFF", color: "#12131A", boxShadow: evPill ? "none" : "0 1px 2px rgba(18,19,26,0.12)" } : { background: "transparent", color: "#4A4F5C" }) }}>
              {b.spec.titulo || b.spec.title ? `${evidenceLabel(b.spec)} · ${b.spec.titulo || b.spec.title}` : evidenceLabel(b.spec)}
            </button>
          ))}
        </div>
      ) : null}
      {body(current)}
    </section>
  );
}

// ---------------------------------------------------------------- the ask
// Same look as Colmena's question card (QuestionCard): ink border + honey shadow while it
// waits for you; muted with «Respondiste: …» once answered (also after reopening the room).
const askCard = { maxWidth: "600px", background: "#FFFFFF", border: "0", borderRadius: "24px", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "12px" };
const answeredCard = { ...askCard, border: "1px solid #DCE0E8", boxShadow: "none" };
const doneChip = (text) => (
  <span role="status" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "4px 10px", background: "#E1F4EC", border: "1px solid #9ED4BC", borderRadius: "15px", fontSize: "13px", fontWeight: "600", color: "#0B5E41" }}>
    <Check size={14} strokeWidth={2.6} aria-hidden="true" />
    {text}
  </span>
);

function AskChoices({ spec, next }) {
  const { send, after = [], botName } = useContext(InteractiveContext);
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState(null);
  const options = (spec.opciones || spec.options || []).slice(0, 6).map((o, i) => {
    const o2 = typeof o === "string" ? { etiqueta: o } : o;
    const label = String(o2.etiqueta || o2.label || o2.valor || `Opción ${i + 1}`);
    return { label, message: String(o2.mensaje || label), detail: o2.detalle || o2.description || "", recommended: o2.recomendado === true || o2.recommended === true };
  });
  if (!options.length) return null;
  const earlier = options.find((o) => after.some((t) => t.trim() === o.message.trim() || t.trim() === o.label.trim()));
  const chosen = picked || earlier?.label || null;
  const choose = async (o) => {
    setPicked(o.label);
    setError(null);
    try { await send(o.message); } catch (e) { setPicked(null); setError(e.message); }
  };
  return (
    <div style={chosen ? answeredCard : askCard}>
      <p style={{ margin: 0, fontSize: "15px", lineHeight: "1.55", fontWeight: "600" }}>{spec.pregunta || spec.titulo || "¿Qué prefieres?"}</p>
      {chosen ? doneChip(`Respondiste: ${chosen}`) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {options.map((o) => (
              <button key={o.label} type="button" className="rm-focus" disabled={!send} onClick={() => choose(o)} title={o.detail || undefined}
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: "2px", minHeight: "44px", padding: "6px 14px", borderRadius: "10px", cursor: send ? "pointer" : "default", fontSize: "14px", fontWeight: "600", textAlign: "left", ...(o.recommended ? { background: "#12131A", color: "#FFFFFF", border: "0" } : { background: "#FFFFFF", color: "#12131A", border: "1px solid #12131A" }) }}>
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {o.label}
                  {o.recommended ? <span style={{ font: "600 10px/1 'Geist Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase", padding: "3px 6px", borderRadius: "5px", background: "#FFC93C", color: "#12131A" }}>Recomendada</span> : null}
                </span>
                {o.detail ? <span style={{ fontSize: "12px", fontWeight: "400", color: o.recommended ? "#C9CCD6" : "#4A4F5C" }}>{o.detail}</span> : null}
              </button>
            ))}
          </div>
          <span style={{ fontSize: "12px", color: "#555A68" }}>
            {!send ? "Responde desde la sala o el chat." : `Tu respuesta le llega a ${botName || "el bot"} y sigue con ello.`}
            {next ? ` Después te pedirá: ${next.titulo || "unos datos"}.` : ""}
          </span>
        </>
      )}
      {error ? <span role="alert" style={{ fontSize: "13px", fontWeight: "600", color: "#B4372A" }}>{error}</span> : null}
    </div>
  );
}

function AskForm({ spec }) {
  const { send, after = [], botName } = useContext(InteractiveContext);
  const title = String(spec.titulo || "Formulario");
  const fields = (spec.campos || spec.fields || []).slice(0, 10).map((f, i) => ({ id: String(f.nombre || f.name || `campo${i}`), label: String(f.etiqueta || f.label || f.nombre || `Campo ${i + 1}`), type: f.tipo || f.type || "texto", options: f.opciones || f.options || [], required: f.obligatorio ?? f.required ?? false, placeholder: f.ejemplo || f.placeholder || "" }));
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.id, ""])));
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  if (!fields.length) return null;
  const done = sent || after.some((t) => t.startsWith(title + ":"));
  const submit = async (e) => {
    e.preventDefault();
    const missing = fields.filter((f) => f.required && !String(values[f.id] || "").trim());
    if (missing.length) return setError(`Falta: ${missing.map((f) => f.label).join(", ")}.`);
    setError(null);
    try {
      await send(`${title}:\n${fields.map((f) => `- ${f.label}: ${String(values[f.id] || "").trim() || "—"}`).join("\n")}`);
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
  };
  if (done) return <div style={answeredCard}><p style={{ margin: 0, fontSize: "15px", fontWeight: "600" }}>{title}</p>{doneChip("Enviado")}</div>;
  const input = { height: "40px", padding: "0 12px", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px", fontWeight: "400", background: "#FFFFFF", width: "100%", boxSizing: "border-box" };
  return (
    <form onSubmit={submit} style={askCard}>
      <p style={{ margin: 0, fontSize: "15px", lineHeight: "1.55", fontWeight: "600" }}>{title}</p>
      {spec.descripcion ? <span style={{ fontSize: "13px", color: "#4A4F5C", marginTop: "-6px" }}>{spec.descripcion}</span> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
        {fields.map((f) => (
          <label key={f.id} style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600", gridColumn: ["texto largo", "textarea"].includes(f.type) ? "1 / -1" : undefined }}>
            <span>{f.label}{f.required ? <span aria-hidden="true" style={{ color: "#B4372A" }}> *</span> : <span style={{ fontWeight: "400", color: "#555A68" }}> · opcional</span>}</span>
            {["opciones", "select"].includes(f.type) ? (
              <select value={values[f.id]} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} style={input}>
                <option value="">Elige…</option>
                {f.options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
              </select>
            ) : ["texto largo", "textarea"].includes(f.type) ? (
              <textarea rows="2" value={values[f.id]} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} style={{ ...input, height: "auto", padding: "8px 12px", resize: "vertical" }} />
            ) : (
              <input type={{ numero: "number", number: "number", fecha: "date", date: "date", correo: "email", email: "email" }[f.type] || "text"} value={values[f.id]} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} style={input} />
            )}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <button type="submit" disabled={!send} style={{ height: "44px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: send ? "pointer" : "default", fontWeight: "600", fontSize: "14px", opacity: send ? 1 : 0.6 }}>{spec.boton || "Enviar"}</button>
        {error ? <span role="alert" style={{ fontSize: "13px", fontWeight: "600", color: "#B4372A" }}>{error}</span>
          : <span style={{ fontSize: "12px", color: "#555A68" }}>{send ? `Se lo envías a ${botName || "el bot"} como respuesta.` : "Rellénalo desde la sala o el chat."}</span>}
      </div>
    </form>
  );
}

export function InteractiveBlock({ spec, next }) {
  const type = String(spec.tipo || spec.type || "").toLowerCase();
  if (["grafico", "gráfico", "chart"].includes(type)) return <Chart spec={spec} />;
  if (["tabla", "table"].includes(type)) return <Table spec={spec} />;
  if (["opciones", "choices"].includes(type)) return <AskChoices spec={spec} next={next} />;
  if (["formulario", "form"].includes(type)) return <AskForm spec={spec} />;
  return null;
}

export function PendingBlock() {
  return <div role="status" style={{ ...card, color: "#4A4F5C", fontSize: "13px" }}>Preparando…</div>;
}

/**
 * An answer with interactive blocks keeps one order, whatever the bot wrote:
 * 1) what it concludes (its text), 2) the supporting data, once, 3) ONE thing to do, last.
 * A second ask (a form after a choice) is announced, not shown: one decision at a time.
 */
export function AnswerLayout({ parts, renderText }) {
  const text = parts.filter((p) => p.kind === "md" && p.text.trim());
  const evidence = parts.filter((p) => p.kind === "ui" && isEvidence(p.spec));
  const asks = parts.filter((p) => p.kind === "ui" && isAsk(p.spec));
  const others = parts.filter((p) => p.kind === "ui" && !isEvidence(p.spec) && !isAsk(p.spec));
  const pending = parts.some((p) => p.kind === "pending");
  return (
    <>
      {text.map((p, i) => renderText(p.text, "t" + i))}
      {evidence.length ? <Evidence blocks={evidence} /> : null}
      {others.map((p, i) => <InteractiveBlock key={"o" + i} spec={p.spec} />)}
      {pending ? <PendingBlock /> : null}
      {/* The one thing to do gets air: apart from the text above, and its shadow clear of what follows. */}
      {asks.length ? <div style={{ marginTop: text.length || evidence.length ? "12px" : "0", marginBottom: "6px" }}><InteractiveBlock spec={asks[0].spec} next={asks[1]?.spec} /></div> : null}
    </>
  );
}

import { useExpert } from "../../../lib/expert.js";
import { reversible } from "../../../lib/undoToast.js";
import { Alert, Card, Go, Panel, Row, SwitchRow, TextInput, UNDO_MS, btn, useSettings } from "./v3.jsx";

// Ajustes › General (design/V3Ajustes.dc.html): your name, your space, how much detail you
// see (Modo experto) and the keyboard shortcuts. The board's language, appearance and start
// page are not settings Colmena has yet, so they are left out rather than drawn dead.

const ROLES = ["Administrador", "Dirección", "Responsable de equipo", "Ventas", "Marketing", "Finanzas", "Operaciones", "Atención al cliente", "Recursos humanos"];
// Only the shortcuts that exist (Sidebar.jsx, CommandPalette.jsx, the desktop app, Layout.jsx).
const KEYS = [
  ["Buscar o pedir", "Ctrl K"], ["Nuevo", "Ctrl N"],
  ["Ir a Inicio … Biblioteca", "Ctrl 1 – 6"], ["Plegar la barra", "Ctrl B"],
  ["Deshacer lo último", "Ctrl Z"], ["Modo experto", "Ctrl ⇧ E"],
  ["Pregunta rápida", "Alt Espacio"], ["Buscar un ajuste", "/"],
];

export default function GeneralSection() {
  const { settings, save, error } = useSettings();
  const [expert, setExpert] = useExpert();
  const flip = (key, label) => (v) => save({ [key]: v }, `${label}: ${v ? "sí" : "no"}`, { [key]: !v });
  const toggleExpert = (v) => {
    setExpert(v);
    reversible({ id: "setting:expert", text: v ? "Modo experto encendido" : "Modo experto apagado", ms: UNDO_MS, undo: () => setExpert(!v) });
  };
  return (
    <>
      <Alert>{error}</Alert>
      <Card label="General">
        <Row as="label" first anchor="tu-nombre" title="Tu nombre" sub="Así te llaman los bots y las personas.">
          <TextInput label="Tu nombre" value={settings.userName} onSave={(v) => save({ userName: v }, "Nombre cambiado")} />
        </Row>
        <Row as="label" anchor="tu-rol" title="Tu rol" sub="Les ayuda a saber qué te importa.">
          <TextInput label="Tu rol" value={settings.userRole} list="st-roles" onSave={(v) => save({ userRole: v }, "Rol cambiado")} />
          <datalist id="st-roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
        </Row>
        <Row as="label" anchor="nombre-espacio" title="Nombre del espacio" sub="El equipo, la empresa o el departamento que trabaja aquí.">
          <TextInput label="Nombre del espacio" value={settings.spaceName} onSave={(v) => save({ spaceName: v }, "Nombre del espacio cambiado")} />
        </Row>
        <SwitchRow anchor="modo-experto" strong min="76px" tint="#FAFAF8" title="Modo experto"
          sub="Muestra herramientas, tokens, modelo, registros y atajos. Añade la sección Avanzado. No quita nada."
          on={expert} onChange={toggleExpert} />
        <SwitchRow anchor="narracion" title="Te cuentan en qué están" sub="Una frase mientras trabajan: «Leyendo tus correos de hoy…»." on={settings.narration !== false} onChange={flip("narration", "Te cuentan en qué están")} />
        <SwitchRow anchor="sugerencias" title="Respuestas sugeridas" sub="Hasta tres respuestas listas para pulsar bajo la última pregunta." on={settings.suggestions !== false} onChange={flip("suggestions", "Respuestas sugeridas")} />
        <SwitchRow anchor="quien-responde" title="Elegir solo quién responde en las salas" sub="Si no nombras a nadie, responde el bot al que le toca. Apagado, responde siempre Atlas." on={settings.routing !== false} onChange={flip("routing", "Elegir solo quién responde")} />
        <Row anchor="quien-usa" title="Quién usa este ordenador" sub="Quién firma lo que se aprueba aquí y a quién se asignan tareas.">
          <Go to="/ajustes/quien-usa" style={btn("outline", 36)}>Ver la lista</Go>
        </Row>
        <Row anchor="personas" title="Personas" sub="Con quién hablas desde Colmena: invitaciones, tu estado y lo que pueden pedir a tus bots.">
          <Go to="/ajustes/contactos" style={btn("outline", 36)}>Abrir</Go>
        </Row>
      </Card>
      <Panel anchor="atajos" title="Atajos de teclado">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "6px 24px" }}>
          {KEYS.map(([a, k]) => (
            <div key={a} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", minHeight: "34px", fontSize: "var(--t-ui)" }}>
              <span>{a}</span>
              <kbd style={{ padding: "4px 8px", borderRadius: "var(--r-sm)", background: "#F1F1EC", font: "500 var(--t-caption)/1 'Geist Mono', monospace", whiteSpace: "nowrap" }}>{k}</kbd>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

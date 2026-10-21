import { css } from "../design/css/Disparadores.js";
import Disparador from "../components/Disparador.jsx";
import { useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { isRoom } from "../lib/format.js";

// Reference page: the 9 trigger forms, live (uncontrolled) with real folders/rooms/connectors.
// «Probar con lo último» hands the trigger to Automatizaciones as a new draft
// (sessionStorage 'colmena:trigger-draft' → /automatizaciones?desde=disparador).
export default function Disparadores() {
  const { folders, missions, connectors } = useStore();
  const rooms = missions.filter(isRoom).map((m) => ({ id: m.id, room: m.room })).filter((r, i, all) => r.room && all.findIndex((x) => x.room === r.room) === i);
  const probar = (tipo) => async (config, sentence) => {
    sessionStorage.setItem("colmena:trigger-draft", JSON.stringify({ type: tipo, config, sentence }));
    navigate("/automatizaciones?desde=disparador");
    return "Abriendo una automatización nueva con este disparador…";
  };
  const card = (n, label, tipo) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ font: "600 12px/1 'Geist Mono', monospace", color: "#4A4F5C" }}>{`${n} · ${label}`}</span>
      <Disparador tipo={tipo} folders={folders} rooms={rooms} connectors={connectors} onProbar={probar(tipo)} />
    </div>
  );
  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", background: "#EEF0F4" }}>
        <header style={{ background: "#12131A", color: "#FFFFFF", padding: "44px 20px 48px" }}>
          <div style={{ maxWidth: "1320px", margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", maxWidth: "760px" }}>
              <span style={{ font: "500 13px/1 'Geist Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase", color: "#C9CCD6" }}>{"Automatizaciones · «Cuando»"}</span>
              <h1 style={{ margin: "0", font: "800 clamp(34px, 4.6vw, 56px)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", textWrap: "balance" }}>{"Un formulario por disparador"}</h1>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.5", color: "#C9CCD6" }}>{"Eliges el tipo en el menú «Cuando» y aparece solo lo que hace falta para ese tipo. Todo lo que rellenas se convierte en una frase que cualquiera entiende."}</p>
            </div>
            <a href="/automatizaciones" style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 18px", background: "#FFC93C", color: "#12131A", borderRadius: "12px", fontWeight: "700", fontSize: "14px", textDecoration: "none" }}>{"Verlo en Automatizaciones"}</a>
          </div>
        </header>
        <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "36px 20px 64px", display: "flex", flexDirection: "column", gap: "36px" }}>
          <section aria-label="Reglas del formulario" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: "12px" }}>
            {[
              ["Valores por defecto sensatos", "Ningún campo empieza vacío salvo los opcionales. Se puede guardar sin tocar nada."],
              ["La frase manda", "El recuadro oscuro resume la regla y es lo que aparece en el botón «Cuando» y en la lista."],
              ["Comprobar antes de activar", "Las de hora muestran las 3 próximas veces; las de evento se prueban con lo que ya ha pasado."],
            ].map(([title, text]) => (
              <div key={title} style={{ padding: "16px 18px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <strong style={{ font: "700 17px/1.2 'Bricolage Grotesque', sans-serif" }}>{title}</strong>
                <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#4A4F5C" }}>{text}</span>
              </div>
            ))}
          </section>
          <section aria-labelledby="hora-t" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "14px" }}>
              <span style={{ font: "500 14px/1 'Geist Mono', monospace", color: "#555A68" }}>{"A"}</span>
              <h2 id="hora-t" style={{ margin: "0", font: "800 30px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"A una hora"}</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(560px, 100%), 1fr))", gap: "20px", alignItems: "start" }}>
              {card("01", "CADA DÍA", "dia")}
              {card("02", "CADA SEMANA", "semana")}
              {card("03", "UNA SOLA VEZ", "vez")}
            </div>
          </section>
          <section aria-labelledby="evento-t" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "14px" }}>
              <span style={{ font: "500 14px/1 'Geist Mono', monospace", color: "#555A68" }}>{"B"}</span>
              <h2 id="evento-t" style={{ margin: "0", font: "800 30px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Cuando pase algo"}</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(560px, 100%), 1fr))", gap: "20px", alignItems: "start" }}>
              {card("04", "LLEGUE UN CORREO · REMITENTE", "correo")}
              {card("05", "SE SUBA UN ARCHIVO · CARPETA", "archivo")}
              {card("06", "SE ACERQUE UN EVENTO", "evento")}
              {card("07", "ALGUIEN ESCRIBA EN UNA SALA", "sala")}
              {card("08", "CAMBIE UNA HOJA DE CÁLCULO", "hoja")}
              {card("09", "UNA PÁGINA WEB CAMBIE", "web")}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

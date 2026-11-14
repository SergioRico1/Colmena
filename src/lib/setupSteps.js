// Inicio › «Para empezar · 1 de 4»: the four things that make Colmena useful, each wired to the
// flow that already does it. Pure: no React, no network. `state` is the store (/api/state).
//   about  «Cuéntame sobre ti»  done once you told how you work (settings.role, from the welcome)
//   ai     «Conecta tu IA»      done with any AI account connected
//   apps   «Conecta tus apps»   done with any app connected (mail, calendar, a folder…)
//   invite «Invita a tu equipo» done once someone else is in your contacts or your team
// settings.setupHidden holds the steps you put off with «Ahora no» ("all" = the card is closed).
import { aiConnected } from "./aiAccount.js";

export const SETUP_IDS = ["about", "ai", "apps", "invite"];

/** {steps: [{id, title, text, done, hidden, action: {label, href}}], done, total, show}. */
export function setupSteps(state = {}) {
  const settings = state.settings || {};
  const hidden = new Set(Array.isArray(settings.setupHidden) ? settings.setupHidden : []);
  const ai = aiConnected(state);
  const engine = (state.ai?.engines || []).find((e) => e.connected);
  const apps = (state.connectors || []).filter((c) => c.connected);
  // Someone else: a contact (people you connect with), or a team of more than one person.
  const people = [...(state.peers?.contacts || []), ...(state.people || []).filter((p) => !p.self && !p.me && !p.you && p.id !== "me")];
  const team = (state.teams || []).some((t) => (t.people || 0) > 1);
  // Hosted Colmena (state.cloud): AI by API key only, and the company's people are invited from
  // /empresa (cloud.html, outside this app's router), not with the desktop's codes.
  const cloud = !!state.cloud;
  const steps = [
    { id: "ai", title: "Conecta tu IA", done: ai,
      text: ai ? (engine?.label || engine?.name || "Cuenta conectada") + ". Tus bots piensan con tu cuenta."
        : cloud ? "Pega tu clave de API de OpenAI, Anthropic u otra IA. Sin ella, tus bots no pueden trabajar para ti."
        : "Tus bots piensan con tu cuenta de IA: ChatGPT o Claude.",
      action: { label: "Conectar", href: "/ajustes/ia" } },
    { id: "about", title: "Cuéntame sobre ti", done: !!settings.role,
      text: "Qué haces y cómo te gusta trabajar. Lo leen todos tus bots.",
      action: { label: "Contar", href: "/bienvenida?paso=3" } },
    { id: "apps", title: "Conecta tus apps", done: apps.length > 0,
      text: apps.length ? apps.map((a) => a.name).join(", ") + "." : "Correo, calendario y archivos. Leer nunca cambia nada.",
      action: { label: "Elegir", href: "/ajustes/conexiones" }, optional: true },
    { id: "invite", title: "Invita a tu equipo", done: people.length > 0 || team,
      text: people.length ? `Ya ${people.length === 1 ? "está" : "están"} ${people.slice(0, 2).map((p) => p.name || "alguien").join(" y ")}${people.length > 2 ? " y más" : ""}.` : team ? "Tu equipo ya tiene más personas." : cloud ? "Por correo: cada persona entra con un enlace y llega a #general." : "Tus compañeros y sus bots, en las mismas salas.",
      action: cloud ? { label: "Invitar", href: "/empresa#personas", page: true } : { label: "Invitar", href: "/equipo?invitar=1" }, optional: true },
  ].map((s) => ({ ...s, hidden: !s.done && hidden.has(s.id) }));
  const done = steps.filter((s) => s.done).length;
  const open = steps.filter((s) => !s.done && !s.hidden).length;
  return { steps, done, total: steps.length, show: !hidden.has("all") && open > 0 };
}

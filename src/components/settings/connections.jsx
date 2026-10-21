import { get, post } from "../../lib/api.js";

// Shared data helpers for the connection screens (09b Connections / 09c Permissions).
// Endpoints: /api/connections/{status,accounts,catalogue,link,rename,disconnect,review/:id}.

export const APPS = [
  { slug: "gmail", name: "Gmail", mono: "G", description: "Busca correos y prepara respuestas." },
  { slug: "googlecalendar", name: "Google Calendar", mono: "C", description: "Consulta eventos y disponibilidad." },
  { slug: "googlesheets", name: "Google Sheets", mono: "S", description: "Trabaja con tus hojas de cálculo." },
  { slug: "notion", name: "Notion", mono: "N", description: "Consulta tus páginas y notas." },
  { slug: "slack", name: "Slack", mono: "S", description: "Consulta tus canales y mensajes." },
  { slug: "github", name: "GitHub", mono: "G", description: "Revisa issues y pull requests." },
  { slug: "supabase", name: "Supabase", mono: "S", description: "Conecta tu proyecto de datos." },
];
const names = new Map();
export const appName = (slug) => names.get(slug) || APPS.find((a) => a.slug === slug)?.name || slug || "";
export const rememberApps = (items) => items?.forEach((i) => i.slug && i.name && names.set(i.slug, i.name));

const PENDING = "colmena-pending-link";
export function pendingLink() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING) || "null");
  } catch {
    return null;
  }
}
export const setPendingLink = (value) => (value ? sessionStorage.setItem(PENDING, JSON.stringify(value)) : sessionStorage.removeItem(PENDING));

export async function loadStatus() {
  return Boolean((await get("/connections/status"))?.available);
}

export async function loadAccounts() {
  const items = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const page = await get("/connections/accounts?cursor=" + encodeURIComponent(cursor));
    items.push(...(page?.items || []));
    cursor = page?.next_cursor;
    if (!cursor) break;
  }
  return items;
}

export async function loadCatalogue({ category = "", query = "", cursor = "" }) {
  const page = await get("/connections/catalogue?" + new URLSearchParams({ category, query, cursor }));
  rememberApps(page?.items);
  return page;
}

/** Validates the authorization URL returned by the server before opening it. */
export async function linkUrl(toolkit) {
  const data = await post("/connections/link", { toolkit });
  const u = new URL(data.url);
  if (u.protocol !== "https:" || !["connect.composio.dev", "app.composio.dev"].includes(u.hostname) || u.username || u.password || u.port) {
    throw Error("Enlace de autorización no válido.");
  }
  return u.href;
}
